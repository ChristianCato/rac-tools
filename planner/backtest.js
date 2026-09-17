// RAC planner: testing the forecast on past months (D1, D2, D5).
//
// Protocol (HANDOVER 5.4). For each test month M:
//   1. Use only settled months before M.
//   2. Choose the shared diminishing returns rate (d1_role_rate), its
//      strength (d1_prior_strength) and the remaining-error adjustment by
//      predicting each earlier month from the months before it, and keeping
//      the values that predicted best (Poisson deviance on location and
//      platform applications). The adjustment is what those predictions still
//      missed overall.
//   3. Predict M at the spend each location and platform actually had.
//   4. Miss = actual / predicted - 1.
// Applications are tested on months from backtest_first_month. Hires are
// tested on months whose Eploy outcomes have settled, against the hires Eploy
// credited to Indeed, Meta, Google and Appcast in the month.
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
        evidence: pc.usual.apps, spendUsual: pc.spendUsual, se: d1[p].seUsed,
      });
    }));
    return cells;
  }

  // Best rate, strength and adjustment for predicting the given months. The
  // adjustment is learned from the latest `recent` of those months (all of
  // them when recent is 0), so it follows where costs have been lately.
  function choose(ds, A, role, months, cache, recent) {
    const table = [];
    let best = null;
    B_GRID.forEach(bRole => K_GRID.forEach(k => {
      const per = months.map(L => predictMonth(ds, A, role, L, { bRole, k }, cache));
      const cells = per.flat();
      const forBias = (recent ? per.slice(-recent) : per).flat();
      const sp = U.sum(forBias.map(c => c.predicted)), sa = U.sum(forBias.map(c => c.actual));
      if (!(sp > 0 && sa > 0)) return;
      const bias = sp / sa;   // multiplier on cost per application
      const dev = U.sum(cells.map(c => deviance(c.actual, c.predicted / bias)));
      const row = { bRole, k, bias, dev };
      table.push(row);
      if (!best || dev < best.dev - 1e-9) best = row;
    }));
    return best ? { ...best, months, table } : null;
  }

  // Months that can be predicted: settled, with at least three settled months before them.
  function testableMonths(ctxAll) {
    return ctxAll.settled.filter((mo, i) => i >= 3);
  }

  //   opts.recent: months the adjustment is learned from (default: the
  //   assumptions file's remaining_error_months)
  function run(ds, A, role, window, eploy, opts = {}) {
    const recent = opts.recent !== undefined ? opts.recent : RAC.assumptions.get(A, 'remaining_error_months');
    const cache = makeCache(ds, A, role, window);
    const all = RAC.cost.context(ds, A, role, window);
    const testable = testableMonths(all);
    const first = RAC.assumptions.get(A, 'backtest_first_month');
    const low = RAC.assumptions.get(A, 'range_low_percentile');
    const high = RAC.assumptions.get(A, 'range_high_percentile');

    // Applications.
    const outer = [];
    const cellMisses = [];
    testable.filter(M => M >= first).forEach(M => {
      const inner = testable.filter(L => L < M);
      const p = choose(ds, A, role, inner, cache, recent);
      if (!p) return;
      const cells = predictMonth(ds, A, role, M, p, cache);
      const predicted = U.sum(cells.map(c => c.predicted)) / p.bias;
      const actual = U.sum(cells.map(c => c.actual));
      outer.push({ month: M, learnedFrom: `${inner[0]} to ${inner[inner.length - 1]}`, bRole: p.bRole, k: p.k, bias: p.bias,
        spend: U.sum(cells.map(c => c.spend)), predicted, actual, miss: actual / predicted - 1 });
      cells.forEach(c => cellMisses.push({ ...c, month: M, predicted: c.predicted / p.bias }));
    });
    const final = choose(ds, A, role, testable, cache, recent);

    // Hires: months whose outcomes have settled, learned from earlier months.
    const hires = [];
    if (eploy) {
      const matured = RAC.rates.maturedMonths(eploy, Math.max(
        RAC.assumptions.get(A, 'screening_maturity_months'), RAC.assumptions.get(A, 'hire_maturity_months')));
      matured.filter((M, i) => i >= 3 && testable.includes(M)).forEach(M => {
        const before = matured.filter(mo => mo < M);
        const hr = RAC.rates.build(eploy, A, role, { screenMonths: before, hireMonths: before });
        const inner = testable.filter(L => L < M);
        const p = choose(ds, A, role, inner, cache, recent);
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
    return { role, window, recent, testable, outer, final, hires, appsRange, hireRange, rowWiden, cellMisses, fit };
  }

  // How much wider a row's range is than the plan total's.
  //   c: row widening strength (row_widen_apps); n: applications behind the
  //   row's cost; S and Su: planned and usual spend; se: uncertainty of the
  //   diminishing returns rate.
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

  RAC.backtest = { B_GRID, K_GRID, C_GRID, RECENT_CHOICES, deviance, makeCache, predictMonth, choose, run, widen, band: band_ };
})(window.RAC = window.RAC || {});
