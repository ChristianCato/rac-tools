// RAC planner: the tests that set tested values in assumptions.csv.
//
// tools/calibrate.mjs runs these and writes the results into the file. The
// Assumptions tab can run them again on current data and show where the file
// is out of date. Nothing here changes a value the planner uses.
(function (RAC) {
  'use strict';
  const U = RAC.util;

  const GRID = [0, 5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 100000];

  const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));
  const logLik = (k, n, p) => (n > 0 ? k * Math.log(clampP(p)) + (n - k) * Math.log(1 - clampP(p)) : 0);

  // Test months: settled months with at least minHistory settled months
  // before them. Each is predicted from every month before it.
  function testMonths(months, minHistory) {
    return months.map((mo, i) => ({ train: months.slice(0, i), test: [mo] })).filter(s => s.train.length >= minHistory);
  }

  // The rule for using a location's or platform's own figure (user decision,
  // 17 September 2026): the best strength replaces the average (strength
  // 100000) only when it predicted the test months clearly better. "Clearly"
  // is own_figure_min_gain log-likelihood units, after dividing by how much
  // more the test months varied than chance alone would explain (the Pearson
  // dispersion under the average, at least 1).
  const AVERAGE = 100000;
  function decide(perMonth, keep, minGain) {
    const used = perMonth.filter(m => keep(m.month));
    const rows = GRID.map(v => ({ value: v, ll: U.sum(used.map(m => m.ll[v])) }));
    const pearson = U.sum(used.map(m => m.pearson));
    const cells = U.sum(used.map(m => m.cells));
    const phi = Math.max(1, cells > 0 ? pearson / cells : 1);
    const best = rows.reduce((m, x) => (x.ll > m.ll + 1e-9 ? x : m), rows[0]);
    const avg = rows.find(x => x.value === AVERAGE);
    const gain = (best.ll - avg.ll) / phi;
    return { value: gain >= minGain ? best.value : AVERAGE, best: best.value, gain, phi, table: rows };
  }

  // Leave-one-out: the value chosen with each test month left out in turn.
  // Unstable when any of them switches between the own figure and the
  // average, or moves more than two steps along the grid.
  function leaveOneOut(perMonth, minGain, full) {
    const loo = perMonth.map(m => ({ month: m.month, value: decide(perMonth, mo => mo !== m.month, minGain).value }));
    const idx = (v) => GRID.indexOf(v);
    const unstable = loo.some(x => (x.value === AVERAGE) !== (full === AVERAGE) || Math.abs(idx(x.value) - idx(full)) > 2);
    return { loo, unstable };
  }

  // Blend strengths for the hire calculation, by predicting each test month
  // from the months before it and scoring with the binomial log-likelihood.
  function blendStrengths(eploy, A, role) {
    const minHistory = RAC.assumptions.get(A, 'test_min_history_months');
    const minGain = RAC.assumptions.get(A, 'own_figure_min_gain');
    const screenMonths = RAC.rates.maturedMonths(eploy, RAC.assumptions.get(A, 'screening_maturity_months'));
    const hireMonths = RAC.rates.maturedMonths(eploy, RAC.assumptions.get(A, 'hire_maturity_months')).filter(m => screenMonths.includes(m));
    const sp = testMonths(screenMonths, minHistory);
    const hp = testMonths(hireMonths, minHistory);
    const regions = [...new Set(eploy.cells.map(c => c[1]))].filter(r => r !== 'Unknown');
    const pearson = (k, n, p) => (n > 0 && p > 0 && p < 1 ? (k - n * p) ** 2 / (n * p * (1 - p)) : 0);

    // For one kind of rate: per test month, the log-likelihood at each
    // strength, and the Pearson statistic under the average.
    //   rateAt(v, s): rates learned from s.train at strength v
    //   observe(r, test): [{ k, n, p }] for the test month
    const score = (parts, rateAt, observe) => parts.map(s => {
      const ll = {};
      let X2 = 0, cells = 0;
      GRID.forEach(v => {
        const obs = observe(rateAt(v, s), s.test);
        ll[v] = U.sum(obs.map(o => logLik(o.k, o.n, o.p)));
        if (v === AVERAGE) obs.forEach(o => { if (o.n > 0) { X2 += pearson(o.k, o.n, o.p); cells += 1; } });
      });
      return { month: s.test[0], ll, pearson: X2, cells };
    });
    const build = (s, extra) => RAC.rates.build(eploy, A, role, { screenMonths: s.train, hireMonths: s.train, ...extra });

    const screen = score(sp, (N, s) => build(s, { screen_blend_n: N }), (r, test) => {
      const t = RAC.rates.tally(eploy, role, test, (reg, plat) => plat);
      return ['indeed', 'appcast'].map(p => ({ k: (t[p] || {}).passed || 0, n: (t[p] || {}).apps || 0, p: r.platform[p].used }));
    });
    const location = score(sp, (M, s) => build(s, { location_screen_blend_n: M }), (r, test) => {
      const t = RAC.rates.tally(eploy, role, test, (reg) => (reg === 'Unknown' ? null : reg));
      return regions.filter(l => t[l]).map(l => ({ k: t[l].passed, n: t[l].apps, p: r.roleScreen * r.location[l].screenAdjustment }));
    });
    const hire = score(hp, (R, s) => build(s, { region_hire_blend_n: R }), (r, test) => {
      const t = RAC.rates.tally(eploy, role, test, (reg) => (reg === 'Unknown' ? null : reg));
      return regions.filter(l => t[l]).map(l => ({ k: t[l].hires, n: t[l].passed, p: r.location[l].hireAfterScreening }));
    });

    const describe = (parts) => (parts.length
      ? `each of ${parts.map(x => x.test[0]).join(', ')} predicted from the months before it (from ${parts[0].train[0]}; at least ${minHistory} months of history)`
      : 'no month had enough history');
    const result = (perMonth, parts) => {
      const d = decide(perMonth, () => true, minGain);
      return { ...d, perMonth, splits: describe(parts), minGain, ...leaveOneOut(perMonth, minGain, d.value) };
    };
    return {
      screen_blend_n: result(screen, sp),
      location_screen_blend_n: result(location, sp),
      region_hire_blend_n: result(hire, hp),
    };
  }

  // Reconciliation (user decision, 17 September 2026). The model's hires on
  // past months, from the applications the platforms recorded, against the
  // hires Eploy recorded in those months:
  //   paidFactor    hires Eploy credited to Indeed, Meta, Google and Appcast
  //                 / the model's hires (paid_hire_reconciliation_factor)
  //   otherFactor   hires Eploy recorded under every other source (and rows
  //                 with no source) / the model's hires
  //                 (other_hires_credit_factor); a plan credits paid media
  //                 with a share of these
  //   otherMonthly  the other-source hires in each month; their average is the
  //                 plan's "Expected hires from other sources"
  // paidFactor + otherFactor is the earlier scaling to every hire Eploy
  // recorded (factor), kept for the check that a 100% share equals it.
  // Months: those whose hire outcomes have settled (the same rule as the hire
  // rates) and whose platform data is settled.
  function reconciliation(ds, eploy, A, role) {
    const hr = RAC.rates.build(eploy, A, role);
    const status = RAC.data.monthStatus(ds, A);
    const months = hr.hireMonths.filter(mo => status[mo] && status[mo].settled);
    let model = 0, apps = 0;
    const byPlat = {};
    RAC.PLATFORMS.forEach(p => { byPlat[p] = { apps: 0, hires: 0 }; });
    ds.regions.forEach(l => RAC.PLATFORMS.forEach(p => {
      const m = RAC.data.monthly(ds, p, l, role);
      const rate = RAC.rates.cell(hr, p, l).hirePerApplication;
      months.forEach(mo => {
        if (!m[mo]) return;
        model += m[mo].apps * rate; apps += m[mo].apps;
        byPlat[p].apps += m[mo].apps; byPlat[p].hires += m[mo].apps * rate;
      });
    }));
    const eployHires = Object.values(RAC.rates.tally(eploy, role, months, () => 'all'))[0] || { hires: 0, apps: 0 };
    const paid = RAC.rates.tally(eploy, role, months, (reg, plat) => plat === 'other' ? 'other' : 'paid');
    const eployPaidHires = (paid.paid || {}).hires || 0, eployOtherHires = (paid.other || {}).hires || 0;
    const perMonth = RAC.rates.tally(eploy, role, months, (reg, plat, mo) => plat === 'other' ? mo : null);
    const otherMonthly = months.map(mo => ({ month: mo, hires: (perMonth[mo] || {}).hires || 0 }));
    const counts = otherMonthly.map(x => x.hires);
    return {
      months, platformApps: apps, modelHires: model, eployHires: eployHires.hires,
      eployPaidHires, eployOtherHires,
      factor: model > 0 ? eployHires.hires / model : 1,
      paidFactor: model > 0 ? eployPaidHires / model : 1,
      otherFactor: model > 0 ? eployOtherHires / model : 0,
      otherMonthly,
      otherMean: counts.length ? U.sum(counts) / counts.length : 0,
      byPlatform: byPlat,
    };
  }

  // Other-source hires by month (the months the hire rates use), their
  // average, the average since other_hires_recent_from, and how much more they
  // varied than chance alone (variance over mean, at least 1), which the hire
  // ranges use.
  function otherSources(eploy, A, role, months) {
    const perMonth = RAC.rates.tally(eploy, role, months, (reg, plat, mo) => (plat === 'other' ? mo : null));
    const monthly = months.map(mo => ({ month: mo, hires: (perMonth[mo] || {}).hires || 0 }));
    const xs = monthly.map(m => m.hires);
    const mean = xs.length ? U.sum(xs) / xs.length : 0;
    const variance = xs.length > 1 ? U.sum(xs.map(x => (x - mean) ** 2)) / (xs.length - 1) : mean;
    const from = RAC.assumptions.get(A, 'other_hires_recent_from');
    const recent = monthly.filter(m => m.month >= from);
    return {
      monthly, mean, variance, dispersion: mean > 0 ? Math.max(1, variance / mean) : 1,
      recentFrom: from, recentMonths: recent,
      recentMean: recent.length ? U.sum(recent.map(m => m.hires)) / recent.length : null,
    };
  }

  RAC.testing = { GRID, AVERAGE, testMonths, decide, leaveOneOut, logLik, blendStrengths, reconciliation, otherSources };
})(window.RAC = window.RAC || {});
