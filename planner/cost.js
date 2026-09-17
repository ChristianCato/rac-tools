// RAC planner: cost per application.
//
// One method, used by the plan, the forecast, the testing, the Benchmarks tab
// and both exports.
//
// Usual cost per application for a location and platform (what it cost over
// the data window, before any spend-level or remaining-error adjustment):
//   1. Weighted spend and applications over the window's settled months.
//   2. The platform's figure for the role: every location's window figures
//      added up, pulled towards the role benchmark by cpa_prior_apps.
//   3. The location's own figure, pulled towards step 2 by cpa_prior_apps.
//      A location with no applications in the window takes step 2 as it is.
// This is the blend the previous version used for its predictions, with one
// change: a location with no window months no longer falls back to its
// all-time figures. The plan and the workings used to disagree because of that
// fallback.
(function (RAC) {
  'use strict';
  const U = RAC.util;

  // The data window. Same choices as the Benchmarks tab:
  //   all, ytd, last3, last3up (mult), custom (from, to)
  // Applied to settled months only, so "the last three months" means the last
  // three settled months.
  function normWindow(w) {
    if (!w) return { mode: 'all' };
    if (typeof w === 'string') return { mode: w };
    if (w.mode) return { ...w };
    if (w.from || w.to) return { mode: 'custom', from: w.from, to: w.to };
    return { mode: 'all' };
  }

  function weights(months, window) {
    const b = normWindow(window);
    const out = {};
    const last = months[months.length - 1];
    months.forEach((mo, i) => {
      const age = months.length - i;
      let w = 1;
      if (b.mode === 'ytd') w = mo.slice(0, 4) === last.slice(0, 4) ? 1 : 0;
      else if (b.mode === 'last3') w = age <= 3 ? 1 : 0;
      else if (b.mode === 'last3up') w = mo.slice(0, 4) !== last.slice(0, 4) ? 0 : (age <= 3 ? (b.mult || 3) : 1);
      else if (b.mode === 'custom') w = ((b.from && mo < b.from) || (b.to && mo > b.to)) ? 0 : 1;
      out[mo] = w;
    });
    return out;
  }

  // Everything one role's calculations share for one build. Built fresh each
  // time from its inputs; nothing is kept between builds.
  //   opts.before: only months before this one count (for testing)
  //   opts.includeSettling: complete months still inside the settle period
  //     count too (Setup option); they are listed in settlingUsed
  // `settled` is the list of months the calculations use.
  function context(ds, A, role, window, opts = {}) {
    const status = RAC.data.monthStatus(ds, A);
    const counts = (mo) => status[mo].settled || (!!opts.includeSettling && status[mo].settling);
    const settled = ds.months.filter(mo => counts(mo) && (!opts.before || mo < opts.before));
    const settlingUsed = settled.filter(mo => !status[mo].settled);
    const w = weights(settled, window);
    const windowMonths = settled.filter(mo => w[mo] > 0);
    return {
      ds, A, role, window: normWindow(window), status, settled, settlingUsed,
      weights: w, windowMonths, monthCount: windowMonths.length,
      K: RAC.assumptions.get(A, 'cpa_prior_apps'),
      benchmark: RAC.assumptions.get(A, 'role_cpa_benchmark', role),
      memo: new Map(),
    };
  }

  function memo(ctx, key, fn) {
    if (!ctx.memo.has(key)) ctx.memo.set(key, fn());
    return ctx.memo.get(key);
  }

  // Weighted window figures for one cell. Volumes are scaled back to a normal
  // number of months, so the blend sees the real amount of evidence.
  function windowStats(ctx, plat, region) {
    return memo(ctx, 'ws|' + plat + '|' + region, () => {
      const m = RAC.data.monthly(ctx.ds, plat, region, ctx.role);
      let spend = 0, apps = 0, clicks = 0, wsum = 0, wspendMonths = 0, spendSum = 0;
      const used = [];
      ctx.windowMonths.forEach(mo => {
        const x = m[mo];
        if (!x) return;
        const w = ctx.weights[mo];
        spend += w * x.spend; apps += w * x.apps; clicks += w * x.clicks; wsum += w;
        if (x.spend > 0) { wspendMonths += w; spendSum += w * x.spend; }
        used.push(mo);
      });
      const scale = wsum > 0 ? ctx.monthCount / wsum : 0;
      return {
        spend: spend * scale, apps: apps * scale, clicks: clicks * scale,
        rawCpa: apps > 0 ? spend / apps : null,
        months: used,
        // Weighted average monthly spend over the window months it ran.
        avgSpend: wspendMonths > 0 ? spendSum / wspendMonths : 0,
        // The weighted sums before scaling, so the workings export can show
        // the same arithmetic as a formula over the monthly rows.
        weighted: { spend, apps, clicks, wsum, scale, ranSpend: spendSum, ranWeight: wspendMonths },
      };
    });
  }

  // The platform's figure for the role, pulled towards the role benchmark.
  function platformCpa(ctx, plat) {
    return memo(ctx, 'pc|' + plat, () => {
      let spend = 0, apps = 0;
      ctx.ds.regions.forEach(r => {
        const s = windowStats(ctx, plat, r);
        if (s.apps > 0) { spend += s.spend; apps += s.apps; }
      });
      if (!(apps > 0)) return { cpa: ctx.benchmark, rawCpa: null, apps: 0, source: 'benchmark' };
      const raw = spend / apps;
      const cpa = (apps * raw + ctx.K * ctx.benchmark) / (apps + ctx.K);
      return { cpa, rawCpa: raw, apps, spend, source: 'platform' };
    });
  }

  // Usual cost per application for one location and platform.
  function usualCpa(ctx, plat, region) {
    return memo(ctx, 'uc|' + plat + '|' + region, () => {
      const pf = platformCpa(ctx, plat);
      const s = windowStats(ctx, plat, region);
      if (!(s.apps > 0)) {
        return { cpa: pf.cpa, rawCpa: null, apps: 0, spend: s.spend, platform: pf, thinAdjustment: null, source: 'platform' };
      }
      const raw = s.spend / s.apps;
      const cpa = (s.apps * raw + ctx.K * pf.cpa) / (s.apps + ctx.K);
      return {
        cpa, rawCpa: raw, apps: s.apps, spend: s.spend, platform: pf,
        // How far the thin-data pull moved the figure, as a multiplier.
        thinAdjustment: cpa / raw,
        source: 'own',
      };
    });
  }

  // A platform's typical month for the role: the median monthly spend across
  // every location's window months above typical_month_min_spend.
  function typicalMonth(ctx, plat) {
    return memo(ctx, 'tm|' + plat, () => {
      const min = RAC.assumptions.get(ctx.A, 'typical_month_min_spend');
      const all = [];
      ctx.ds.regions.forEach(r => {
        const m = RAC.data.monthly(ctx.ds, plat, r, ctx.role);
        ctx.windowMonths.forEach(mo => { if (m[mo] && m[mo].spend > min) all.push(m[mo].spend); });
      });
      all.sort((a, b) => a - b);
      return all.length ? all[Math.floor(all.length / 2)] : 0;
    });
  }

  // The spend level the usual cost per application was measured at: the
  // cell's weighted average monthly spend over the window, or the platform's
  // typical month where the cell did not run.
  function usualSpend(ctx, plat, region) {
    const s = windowStats(ctx, plat, region);
    if (s.avgSpend > 0) return { spend: s.avgSpend, basis: 'own' };
    return { spend: typicalMonth(ctx, plat), basis: 'typical month' };
  }

  RAC.cost = { normWindow, weights, context, windowStats, platformCpa, usualCpa, typicalMonth, usualSpend };
})(window.RAC = window.RAC || {});
