// RAC planner: testing the forecast on past months (D1, D2, D5).
//
// Protocol (HANDOVER 5.4). For each test month M (a settled month with at
// least test_min_history_months settled months before it):
//   1. Use only settled months before M.
//   2. Use the settings the plan uses (d1_role_rate and d1_prior_strength from
//      assumptions.csv), and the remaining-error rule below applied to the
//      test months before M only.
//   3. Predict M at the spend each location and platform actually had.
//   4. Miss = actual / predicted - 1.
// The ranges and row widening come from these misses, so they describe the
// model as used.
//
// Remaining-error rule (user decisions, 17 September 2026): each test month is
// predicted from the months before it with no adjustment. The tested figure is
// what those predictions missed overall (predicted over actual applications,
// latest remaining_error_months months, 0 meaning all). It applies only when
// it stays on the same side of 1 with any one test month left out (and with
// none left out); otherwise the adjustment is 1.00.
//
// Tested figures (shown beside the agreed values): the shared rate and its
// strength that predicted the test months best (Poisson deviance on location
// and platform applications), searched over a grid. A platform's own rate
// (strength below 100000) counts only when it predicted clearly better than
// the shared rate: by own_figure_min_gain log-likelihood units (half the
// deviance), after dividing by the dispersion of the monthly figures under
// the shared rate. An agreed value may switch to its tested figure once there
// are switch_min_test_months test months and it is stable (below).
// Applications are tested on months from backtest_first_month. Hires are
// tested on months whose Eploy outcomes have settled, against the hires Eploy
// credited to Indeed, Meta, Google and Appcast in the month. The hire test is
// reported as a check only; hire ranges come from the counts behind the rates
// (planner/plan.js).
//
// Stability: each tested figure is chosen again with each test month left out
// in turn (leaveOneOut), and flagged unstable when the shared rate moves by
// more than 0.1, the strength switches between own and shared rates or moves
// more than two steps, or the adjustment (at the rate in use) moves by more
// than 5% or the same-direction rule gives a different answer.
//
// Ranges (D5, addendum 2.4): the plan total runs from the 10th to the 90th
// percentile of the misses (Excel PERCENTILE.INC). Rows start from the same
// figure and widen where there is less evidence behind them and where spend
// sits further from the level the cost was measured at.
(function (RAC) {
  'use strict';
  const U = RAC.util;
  const B_GRID = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const K_GRID = [0, 5, 10, 20, 50, 100, 100000];
  const C_GRID = [0, 1, 2, 5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400];
  const RECENT_CHOICES = [3, 6, 0];   // months the adjustment is learned from; 0 means all
  const SHARED = 100000;               // strength at which every platform takes the shared rate

  function deviance(y, mu) {
    const m = Math.max(mu, 1e-9);
    return 2 * ((y > 0 ? y * Math.log(y / m) : 0) - (y - m));
  }

  // A store shared across one test run: data contexts and fits per month.
  function makeCache(ds, A, role, window) {
    const ctxs = new Map(), fits = new Map();
    return {
      ctx(M) {
        if (!ctxs.has(M)) ctxs.set(M, RAC.cost.context(ds, A, role, window, { before: M }));
        return ctxs.get(M);
      },
      fits(M) {
        if (!fits.has(M)) {
          const c = this.ctx(M);
          const f = {};
          RAC.PLATFORMS.forEach(p => { f[p] = RAC.forecast.fitRate(ds, A, role, p, c.settled); });
          fits.set(M, f);
        }
        return fits.get(M);
      },
    };
  }

  // Predictions for every location and platform that spent in month M,
  // learned from the months before it. Cells whose platform had no earlier
  // applications at all are left out: there was nothing to predict from.
  function predictMonth(ds, A, role, M, params, cache, hireRates) {
    const ctx = cache.ctx(M);
    const d1 = RAC.forecast.rates(ds, A, role, ctx.settled, { roleRate: params.bRole, k: params.k, fits: cache.fits(M) });
    const cells = [];
    ds.regions.forEach(r => RAC.PLATFORMS.forEach(p => {
      const x = RAC.data.monthly(ds, p, r, role)[M];
      if (!x || !(x.spend > 0)) return;
      const pc = RAC.forecast.prepare(ctx, hireRates || null, d1, { bias: 1, recon: 1 }, p, r);
      if (pc.usual.platform.source === 'benchmark') return;
      const f = RAC.forecast.at(pc, x.spend);
      cells.push({
        region: r, plat: p, spend: x.spend, actual: x.apps, predicted: f.apps,
        hirePerApplication: pc.rates.hirePerApplication,
        evidence: widenEvidence(ctx, pc.usual.apps), spendUsual: pc.spendUsual, se: d1[p].seUsed,
      });
    }));
    return cells;
  }

  // Best rate, strength and adjustment for predicting the given months. The
  // adjustment is learned from the latest `recent` of those months (all of
  // them when recent is 0), so it follows where costs have been lately.
  function choose(ds, A, role, months, cache, recent) {
    const minGain = RAC.assumptions.get(A, 'own_figure_min_gain');
    const table = [];
    let best = null, shared = null;
    B_GRID.forEach(bRole => K_GRID.forEach(k => {
      const per = months.map(L => predictMonth(ds, A, role, L, { bRole, k }, cache));
      const cells = per.flat();
      const forBias = (recent ? per.slice(-recent) : per).flat();
      const sp = U.sum(forBias.map(c => c.predicted)), sa = U.sum(forBias.map(c => c.actual));
      if (!(sp > 0 && sa > 0)) return;
      const bias = sp / sa;   // multiplier on cost per application
      const dev = U.sum(cells.map(c => deviance(c.actual, c.predicted / bias)));
      const pearson = U.sum(cells.map(c => { const mu = Math.max(c.predicted / bias, 1e-9); return (c.actual - mu) ** 2 / mu; }));
      const row = { bRole, k, bias, dev, pearson, cells: cells.length };
      table.push(row);
      if (!best || dev < best.dev - 1e-9) best = row;
      if (k >= SHARED && (!shared || dev < shared.dev - 1e-9)) shared = row;
    }));
    if (!best) return null;
    const phi = shared ? Math.max(1, shared.pearson / Math.max(1, shared.cells)) : 1;
    const gain = shared ? (shared.dev - best.dev) / 2 / phi : Infinity;
    const pick = !shared || best.k >= SHARED || gain >= minGain ? best : shared;
    return { ...pick, best: { bRole: best.bRole, k: best.k }, gain, phi, months, table };
  }

  // The remaining-error rule at given settings (see the note at the top).
  // Each month's prediction depends only on the months before it, so the
  // figure with a month left out is a sum over the others.
  //   tested: predicted over actual applications
  //   leftOut: the same with each month left out in turn
  //   same: every one of them on the same side of 1
  //   bias: tested where the rule applies, otherwise 1
  function errorRule(ds, A, role, months, cache, params, recent) {
    const per = months.map(L => {
      const cells = predictMonth(ds, A, role, L, params, cache);
      const predicted = U.sum(cells.map(c => c.predicted)), actual = U.sum(cells.map(c => c.actual));
      return { month: L, predicted, actual, costMiss: actual > 0 ? predicted / actual - 1 : null };
    }).filter(m => m.predicted > 0 && m.actual > 0);
    const ratio = (list) => {
      const use = recent ? list.slice(-recent) : list;
      const sp = U.sum(use.map(m => m.predicted)), sa = U.sum(use.map(m => m.actual));
      return sp > 0 && sa > 0 ? sp / sa : 1;
    };
    const tested = ratio(per);
    const leftOut = per.length > 1 ? per.map(m => ({ month: m.month, value: ratio(per.filter(x => x !== m)) })) : [];
    const all = [tested, ...leftOut.map(x => x.value)];
    const same = per.length > 1 && (all.every(v => v > 1) || all.every(v => v < 1));
    return { months: per, tested, leftOut, same, bias: same ? tested : 1 };
  }

  // The values chosen with each of the months left out in turn, and whether
  // any of them moved enough to call the value unstable.
  //   full: the grid choice on every month; used: the settings in use;
  //   rule: errorRule on every month at those settings.
  function leaveOneOut(ds, A, role, months, cache, recent, full, used, rule) {
    const idx = (k) => K_GRID.indexOf(k);
    const loo = months.map(M => {
      const rest = months.filter(x => x !== M);
      const p = choose(ds, A, role, rest, cache, recent);
      const e = errorRule(ds, A, role, rest, cache, used, recent);
      return { month: M, bRole: p.bRole, k: p.k, bias: e.tested, same: e.same };
    });
    const flags = {
      bRole: loo.some(x => Math.abs(x.bRole - full.bRole) > 0.1 + 1e-9),
      k: loo.some(x => (x.k >= SHARED) !== (full.k >= SHARED) || Math.abs(idx(x.k) - idx(full.k)) > 2),
      bias: loo.some(x => Math.abs(x.bias / rule.tested - 1) > 0.05 || x.same !== rule.same),
    };
    return { loo, unstable: flags };
  }

  // Months that can be predicted: settled, with at least
  // test_min_history_months settled months before them.
  function testableMonths(ctxAll, A) {
    const n = RAC.assumptions.get(A, 'test_min_history_months');
    return ctxAll.settled.filter((mo, i) => i >= n);
  }

  //   opts.recent: months the adjustment is learned from (default: the
  //   assumptions file's remaining_error_months)
  function run(ds, A, role, window, eploy, opts = {}) {
    const recent = opts.recent !== undefined ? opts.recent : RAC.assumptions.get(A, 'remaining_error_months');
    const cache = makeCache(ds, A, role, window);
    const all = RAC.cost.context(ds, A, role, window);
    const testable = testableMonths(all, A);
    const first = RAC.assumptions.get(A, 'backtest_first_month');
    const low = RAC.assumptions.get(A, 'range_low_percentile');
    const high = RAC.assumptions.get(A, 'range_high_percentile');
    const used = { bRole: RAC.assumptions.get(A, 'd1_role_rate', role), k: RAC.assumptions.get(A, 'd1_prior_strength', role) };
    // The settings in use for month M, with the adjustment from the test
    // months before it.
    const settingsFor = (M) => {
      const inner = testable.filter(L => L < M);
      if (!inner.length) return null;
      const e = errorRule(ds, A, role, inner, cache, used, recent);
      return { ...used, bias: e.bias, inner };
    };

    // Applications.
    const outer = [];
    const cellMisses = [];
    testable.filter(M => M >= first).forEach(M => {
      const p = settingsFor(M);
      if (!p) return;
      const inner = p.inner;
      const cells = predictMonth(ds, A, role, M, p, cache);
      const predicted = U.sum(cells.map(c => c.predicted)) / p.bias;
      const actual = U.sum(cells.map(c => c.actual));
      outer.push({ month: M, learnedFrom: `${inner[0]} to ${inner[inner.length - 1]}`, bRole: p.bRole, k: p.k, bias: p.bias,
        spend: U.sum(cells.map(c => c.spend)), predicted, actual, miss: actual / predicted - 1 });
      cells.forEach(c => cellMisses.push({ ...c, month: M, predicted: c.predicted / p.bias }));
    });
    // Tested figures on every test month, and the rule for the plan's adjustment.
    const tested = choose(ds, A, role, testable, cache, recent);
    const rule = errorRule(ds, A, role, testable, cache, used, recent);
    const final = { ...tested, tested: { bRole: tested.bRole, k: tested.k, bias: rule.tested }, used: { ...used, bias: rule.bias }, rule };
    const stability = opts.stability === false ? null : leaveOneOut(ds, A, role, testable, cache, recent, tested, used, rule);

    // Hires: months whose outcomes have settled, learned from earlier months.
    const hires = [];
    if (eploy) {
      const matured = RAC.rates.maturedMonths(eploy, Math.max(
        RAC.assumptions.get(A, 'screening_maturity_months'), RAC.assumptions.get(A, 'hire_maturity_months')));
      const minHistory = RAC.assumptions.get(A, 'test_min_history_months');
      matured.filter((M, i) => i >= minHistory && testable.includes(M)).forEach(M => {
        const before = matured.filter(mo => mo < M);
        const hr = RAC.rates.build(eploy, A, role, { screenMonths: before, hireMonths: before });
        const p = settingsFor(M);
        if (!p) return;
        // Reconciliation to the hires Eploy credited to the four platforms,
        // learned from the same earlier months. Hires from other sources are
        // not tested here: the plan carries their own monthly spread.
        let model = 0;
        before.filter(mo => all.settled.includes(mo)).forEach(mo => ds.regions.forEach(r => RAC.PLATFORMS.forEach(pl => {
          const x = RAC.data.monthly(ds, pl, r, role)[mo];
          if (x) model += x.apps * RAC.rates.cell(hr, pl, r).hirePerApplication;
        })));
        const paidHires = (months) => (RAC.rates.tally(eploy, role, months, (reg, plat) => (plat === 'other' ? null : 'paid')).paid || { hires: 0 }).hires;
        const recorded = paidHires(before.filter(mo => all.settled.includes(mo)));
        const recon = model > 0 ? recorded / model : 1;
        const cells = predictMonth(ds, A, role, M, p, cache, hr);
        const predicted = U.sum(cells.map(c => c.predicted / p.bias * c.hirePerApplication)) * recon;
        const actual = paidHires([M]);
        hires.push({ month: M, learnedFrom: `${before[0]} to ${before[before.length - 1]}`, recon, predicted, actual, miss: actual / predicted - 1 });
      });
    }

    // Ranges.
    const pct = (xs, q) => U.percentileInc(xs, q);
    const logsd = (xs) => {
      const l = xs.map(x => Math.log(1 + x));
      const m = l.reduce((a, b) => a + b, 0) / l.length;
      return Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, l.length - 1));
    };
    const appsRange = outer.length ? { low: pct(outer.map(o => o.miss), low), high: pct(outer.map(o => o.miss), high), sigma: logsd(outer.map(o => o.miss)), months: outer.length } : null;
    const hireRange = hires.length ? { low: pct(hires.map(o => o.miss), low), high: pct(hires.map(o => o.miss), high), sigma: logsd(hires.map(o => o.miss)), months: hires.length } : null;

    // Row widening: the strength that makes location and platform rows hold
    // their share of past misses (the middle 80%) most closely.
    let rowWiden = null;
    if (appsRange && cellMisses.length) {
      const target = high - low;
      const table = C_GRID.map(c => {
        const inside = cellMisses.filter(x => {
          const w = widen(appsRange, c, x.evidence, x.spend, x.spendUsual, x.se);
          const band = band_(appsRange, w);
          const m = (x.actual + 0.5) / (x.predicted + 0.5) - 1;
          return m >= band.low && m <= band.high;
        }).length / cellMisses.length;
        return { c, coverage: inside };
      });
      rowWiden = table.reduce((b, r) => (Math.abs(r.coverage - target) < Math.abs(b.coverage - target) - 1e-12 ? r : b), table[0]);
      rowWiden = { ...rowWiden, table, cells: cellMisses.length };
    }
    const logs = outer.map(o => Math.log(1 + o.miss));
    const fit = logs.length ? { meanLog: U.sum(logs) / logs.length, rmsLog: Math.sqrt(U.sum(logs.map(x => x * x)) / logs.length) } : null;
    return { role, window, recent, testable, outer, final, stability, hires, appsRange, hireRange, rowWiden, cellMisses, fit };
  }

  // The evidence behind a location and platform's cost per application, as
  // the cost blend counts it: its own applications plus the cpa_prior_apps the
  // blend gives the platform figure. A cell with no applications of its own
  // rests on the platform figure alone (user decision, 17 September 2026:
  // counting it as one application gave ranges of thousands of applications).
  function widenEvidence(ctx, apps) {
    return (apps || 0) + ctx.K;
  }

  // How much wider a row's range is than the plan total's.
  //   c: row widening strength (row_widen_apps); n: evidence behind the
  //   row's cost (widenEvidence); S and Su: planned and usual media spend;
  //   se: uncertainty of the diminishing returns rate.
  function widen(range, c, n, S, Su, se) {
    const thin = c / Math.max(n || 0, 1);
    const reach = (S > 0 && Su > 0 && se) ? (Math.log(S / Su) * se) / Math.max(range.sigma, 1e-6) : 0;
    return Math.sqrt(1 + thin + reach * reach);
  }

  // A range widened around its centre, in log terms, so a range that sits
  // wholly above or below zero widens both ways.
  function band_(range, w) {
    const L = Math.log(1 + range.low), H = Math.log(1 + range.high);
    const mid = (L + H) / 2, half = (H - L) / 2;
    return { low: Math.exp(mid - half * w) - 1, high: Math.exp(mid + half * w) - 1 };
  }

  RAC.backtest = { B_GRID, K_GRID, C_GRID, RECENT_CHOICES, SHARED, deviance, makeCache, predictMonth, choose, errorRule, leaveOneOut, widenEvidence, testableMonths, run, widen, band: band_ };
})(window.RAC = window.RAC || {});
