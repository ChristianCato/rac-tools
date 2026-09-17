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

  // Two splits of the settled months: learn from the earlier months, predict
  // the three that follow. With screening settled to May 2026 these are
  // October to February predicting March to May, and October to December
  // predicting January to March.
  function splits(months) {
    const L = months.length;
    return [
      { train: months.slice(0, L - 3), test: months.slice(L - 3) },
      { train: months.slice(0, L - 5), test: months.slice(L - 5, L - 2) },
    ].filter(s => s.train.length && s.test.length);
  }

  // Blend strengths for the hire calculation, by predicting later months from
  // earlier ones and scoring with the binomial log-likelihood.
  function blendStrengths(eploy, A, role) {
    const screenMonths = RAC.rates.maturedMonths(eploy, RAC.assumptions.get(A, 'screening_maturity_months'));
    const hireMonths = RAC.rates.maturedMonths(eploy, RAC.assumptions.get(A, 'hire_maturity_months')).filter(m => screenMonths.includes(m));
    const sp = splits(screenMonths);
    const hp = splits(hireMonths);
    const regions = [...new Set(eploy.cells.map(c => c[1]))].filter(r => r !== 'Unknown');
    const score = (fn, parts) => GRID.map(v => ({ value: v, ll: parts.reduce((a, s) => a + fn(v, s), 0) }));

    const screen = score((N, s) => {
      const r = RAC.rates.build(eploy, A, role, { screenMonths: s.train, hireMonths: s.train, screen_blend_n: N });
      const test = RAC.rates.tally(eploy, role, s.test, (reg, plat) => plat);
      return ['indeed', 'appcast'].reduce((a, p) => a + logLik((test[p] || {}).passed || 0, (test[p] || {}).apps || 0, r.platform[p].used), 0);
    }, sp);

    const location = score((M, s) => {
      const r = RAC.rates.build(eploy, A, role, { screenMonths: s.train, hireMonths: s.train, location_screen_blend_n: M });
      const test = RAC.rates.tally(eploy, role, s.test, (reg) => reg === 'Unknown' ? null : reg);
      return regions.reduce((a, l) => a + (test[l] ? logLik(test[l].passed, test[l].apps, r.roleScreen * r.location[l].screenAdjustment) : 0), 0);
    }, sp);

    const hire = score((R, s) => {
      const r = RAC.rates.build(eploy, A, role, { screenMonths: s.train, hireMonths: s.train, region_hire_blend_n: R });
      const test = RAC.rates.tally(eploy, role, s.test, (reg) => reg === 'Unknown' ? null : reg);
      return regions.reduce((a, l) => a + (test[l] ? logLik(test[l].hires, test[l].passed, r.location[l].hireAfterScreening) : 0), 0);
    }, hp);

    const best = (rows) => rows.reduce((m, x) => (x.ll > m.ll + 1e-9 ? x : m), rows[0]);
    const describe = (s) => s.map(x => `${x.train[0]} to ${x.train[x.train.length - 1]} predicting ${x.test[0]} to ${x.test[x.test.length - 1]}`).join('; ');
    return {
      screen_blend_n: { ...best(screen), table: screen, splits: describe(sp) },
      location_screen_blend_n: { ...best(location), table: location, splits: describe(sp) },
      region_hire_blend_n: { ...best(hire), table: hire, splits: describe(hp) },
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
      otherLow: counts.length ? U.percentileInc(counts, RAC.assumptions.get(A, 'range_low_percentile')) : 0,
      otherHigh: counts.length ? U.percentileInc(counts, RAC.assumptions.get(A, 'range_high_percentile')) : 0,
      byPlatform: byPlat,
    };
  }

  RAC.testing = { GRID, splits, logLik, blendStrengths, reconciliation };
})(window.RAC = window.RAC || {});
