// RAC planner: spending limits based on successful months (C1 to C5).
//
// For each location and platform:
//   C3 Months considered: settled months from ceiling_first_month with at
//      least ceiling_min_spend of spend and ceiling_min_apps applications.
//   C1 A month is successful when its cost per application was at or below
//      what the model expected at that month's spend, and at or below the
//      location and platform's cost per application limit where one is set.
//   C2 A successful month is set aside when the location's screening pass
//      rate that month (every source, Eploy) was more than quality_test_drop
//      below its usual rate. The test applies only to months whose screening
//      has settled, and only where at least quality_test_min_expected
//      applications would normally have passed screening.
//   C4 Limit = largest successful month x the spending limit multiple. With
//      no successful month, the cell's usual monthly spend (or the platform's
//      typical month) x the multiple, flagged.
//   C5 The limit is a hard cap (applied in allocate.js).
(function (RAC) {
  'use strict';

  // The location's screening pass rate by month and its usual rate.
  function qualityByLocation(eploy, hireRates, role) {
    if (!eploy) return null;
    const settled = new Set(hireRates.screenMonths);
    const byMonth = RAC.rates.tally(eploy, role, [...new Set(eploy.cells.map(c => c[3]))], (reg, plat, mo) => reg + '|' + mo);
    return { settled, byMonth, norm: (region) => hireRates.location[region] ? hireRates.location[region].ownScreen : null };
  }

  function cell(ctx, pc, quality, opts) {
    const A = ctx.A;
    const first = RAC.assumptions.get(A, 'ceiling_first_month');
    const minSpend = RAC.assumptions.get(A, 'ceiling_min_spend');
    const minApps = RAC.assumptions.get(A, 'ceiling_min_apps');
    const drop = RAC.assumptions.get(A, 'quality_test_drop');
    const minExpected = RAC.assumptions.get(A, 'quality_test_min_expected');
    const multiple = opts.capMultiple;
    const cpaLimit = opts.cpaLimit > 0 ? opts.cpaLimit : null;
    const m = RAC.data.monthly(ctx.ds, pc.plat, pc.region, ctx.role);
    const months = [];
    let largestSuccessful = 0, largestMonth = 0;
    ctx.settled.filter(mo => mo >= first && m[mo]).forEach(mo => {
      const x = m[mo];
      largestMonth = Math.max(largestMonth, x.spend);
      if (!(x.spend >= minSpend && x.apps >= minApps)) return;
      const cpa = x.spend / x.apps;
      const expected = RAC.forecast.at(pc, x.spend).cpa;
      const passCost = cpa <= expected + 1e-9;
      const passLimit = cpaLimit === null || cpa <= cpaLimit + 1e-9;
      let q = { applied: false, pass: true, reason: '' };
      if (quality) {
        const t = quality.byMonth[pc.region + '|' + mo];
        const norm = quality.norm(pc.region);
        if (!quality.settled.has(mo)) q.reason = 'screening not settled';
        else if (!t || norm === null) q.reason = 'no Eploy applications';
        else if (t.apps * norm < minExpected) q.reason = `under ${minExpected} expected to pass screening`;
        else {
          const rate = t.passed / t.apps;
          q = { applied: true, pass: rate >= norm * (1 - drop) - 1e-12, rate, norm, reason: '' };
        }
      }
      const successful = passCost && passLimit && q.pass;
      if (successful) largestSuccessful = Math.max(largestSuccessful, x.spend);
      months.push({ month: mo, spend: x.spend, apps: x.apps, cpa, expected, passCost, passLimit, quality: q, successful });
    });
    let base, basis, flagged = false;
    if (largestSuccessful > 0) { base = largestSuccessful; basis = 'largest successful month'; }
    else {
      base = pc.spendUsual;
      basis = pc.spendBasis === 'own' ? 'no successful month: usual monthly spend' : 'no successful month: platform typical month';
      flagged = true;
    }
    return { ceiling: base * multiple, base, basis, flagged, multiple, largestSuccessful, largestMonth, cpaLimit, months };
  }

  // Spend at which planned cost per application reaches a limit (D6).
  function spendAtCpaLimit(pc, limit) {
    if (!(limit > 0)) return Infinity;
    const atUsual = pc.cpaUsual * pc.bias;
    if (pc.b >= 1 || !(pc.spendUsual > 0)) return atUsual <= limit ? Infinity : 0;
    // cost = atUsual x (S / usual spend) ^ (1 - b), solved for cost = limit.
    return pc.spendUsual * Math.pow(limit / atUsual, 1 / (1 - pc.b));
  }

  RAC.ceilings = { qualityByLocation, cell, spendAtCpaLimit };
})(window.RAC = window.RAC || {});
