// RAC planner: spending caps based on successful months (C1 to C5).
//
// For each location and platform:
//   C3 Months considered: settled months from ceiling_first_month with at
//      least ceiling_min_spend of spend and ceiling_min_apps applications.
//   C1 A month is successful when its cost per application was at or below
//      a fixed benchmark at that month's spend, and at or below the location
//      and platform's cost per application limit where one is set. The
//      benchmark is the location and platform's usual cost per application
//      over the same settled months from ceiling_first_month, each counted
//      once, with the spend-level adjustment for that month's spend and no
//      plan adjustment (user decisions, 18 September 2026), so the caps do
//      not move when the plan's data window or its remaining-error
//      adjustment changes. 2025 months were built differently and are not
//      comparable, so they are left out of the benchmark as well.
//   C2 A successful month is set aside when the location's quality rate that
//      month (every source, Eploy) was more than quality_test_drop below what
//      was expected: its usual rate x that month's rate across all locations
//      over their usual rate (user decision, 18 September 2026). A month when
//      quality was lower everywhere is not a weak month for one location. The
//      test applies only to months whose quality outcomes have settled, and
//      only where at least quality_test_min_expected applications would
//      normally have been quality.
//   C4 Cap = largest successful month x the spending cap multiple. With
//      no successful month, the cell's usual monthly spend over those months
//      (or the platform's typical month) x the multiple, flagged. The month
//      a cap rests on is held to cap_row_usual_limit x the row's usual
//      monthly spend, so a single unusual month cannot set a cap (user
//      decision, 18 September 2026).
//   Location cap: cap_location_month_limit x the most the location spent in
//      one of those months across all platforms, x the multiple. Row caps
//      are set separately and summed, so without it a location could be
//      allowed more than it has ever run in a month (user decision, 18
//      September 2026). No limit is set on the plan as a whole.
//   C5 The plan never spends above the cap (applied in allocate.js).
(function (RAC) {
  'use strict';

  // The location's quality rate by month, its usual rate, and how each month's
  // quality rate across all locations compared with usual (user decision, 18
  // September 2026). The test is meant to catch a location having a weak
  // month, not a month when quality was lower everywhere, so a location's
  // expected rate in a month is its usual rate x that month's factor:
  //   factor = (every location's quality applications / applications that month)
  //          / (the same over the months the usual rates use)
  // Applications with no region are left out of both, as they are from the
  // location rates.
  function qualityByLocation(eploy, hireRates, role) {
    if (!eploy) return null;
    const settled = new Set(hireRates.screenMonths);
    const all = [...new Set(eploy.cells.map(c => c[3]))];
    const byMonth = RAC.rates.tally(eploy, role, all, (reg, plat, mo) => reg + '|' + mo);
    const month = RAC.rates.tally(eploy, role, all, (reg, plat, mo) => (reg === 'Unknown' ? null : mo));
    const base = RAC.rates.tally(eploy, role, hireRates.screenMonths, (reg) => (reg === 'Unknown' ? null : 'all')).all || { apps: 0, passed: 0 };
    const baseRate = base.apps > 0 ? base.passed / base.apps : null;
    const monthRate = (mo) => (month[mo] && month[mo].apps > 0 ? month[mo].passed / month[mo].apps : null);
    const factor = (mo) => (baseRate > 0 && monthRate(mo) !== null ? monthRate(mo) / baseRate : 1);
    return {
      settled, byMonth, baseRate, monthRate, factor,
      norm: (region) => hireRates.location[region] ? hireRates.location[region].ownScreen : null,
    };
  }

  //   opts.benchmark: the location and platform prepared over every settled
  //   month (RAC.forecast.prepare on an all-months context); pc otherwise.
  function cell(ctx, pc, quality, opts) {
    const A = ctx.A;
    const first = RAC.assumptions.get(A, 'ceiling_first_month');
    const minSpend = RAC.assumptions.get(A, 'ceiling_min_spend');
    const minApps = RAC.assumptions.get(A, 'ceiling_min_apps');
    const drop = RAC.assumptions.get(A, 'quality_test_drop');
    const minExpected = RAC.assumptions.get(A, 'quality_test_min_expected');
    const rowLimit = RAC.assumptions.get(A, 'cap_row_usual_limit');
    const multiple = opts.capMultiple;
    const cpaLimit = opts.cpaLimit > 0 ? opts.cpaLimit : null;
    const m = RAC.data.monthly(ctx.ds, pc.plat, pc.region, ctx.role);
    const bench = { ...(opts.benchmark || pc), bias: opts.benchmark ? 1 : pc.bias };
    const months = [];
    let largestSuccessful = 0, largestMonth = 0;
    ctx.settled.filter(mo => mo >= first && m[mo]).forEach(mo => {
      const x = m[mo];
      largestMonth = Math.max(largestMonth, x.spend);
      if (!(x.spend >= minSpend && x.apps >= minApps)) return;
      const cpa = x.spend / x.apps;
      // Past spend was media only, so this compares media with media.
      const expected = RAC.forecast.mediaCpa(bench, x.spend);
      const passCost = cpa <= expected + 1e-9;
      const passLimit = cpaLimit === null || cpa <= cpaLimit + 1e-9;
      let q = { applied: false, pass: true, reason: '' };
      if (quality) {
        const t = quality.byMonth[pc.region + '|' + mo];
        const norm = quality.norm(pc.region);
        if (!quality.settled.has(mo)) q.reason = 'screening not settled';
        else if (!t || norm === null) q.reason = 'no Eploy applications';
        else if (t.apps * norm < minExpected) q.reason = `under ${minExpected} quality applications expected`;
        else {
          const rate = t.passed / t.apps;
          const factor = quality.factor ? quality.factor(mo) : 1;
          const expectedRate = norm * factor;
          q = { applied: true, pass: rate >= expectedRate * (1 - drop) - 1e-12, rate, norm, factor, expectedRate,
            monthRate: quality.monthRate ? quality.monthRate(mo) : null, reason: '' };
        }
      }
      const successful = passCost && passLimit && q.pass;
      if (successful) largestSuccessful = Math.max(largestSuccessful, x.spend);
      months.push({ month: mo, spend: x.spend, apps: x.apps, cpa, expected, passCost, passLimit, quality: q, successful });
    });
    let base, basis, flagged = false, rowLimited = false;
    const rowMax = rowLimit > 0 && bench.spendBasis === 'own' && bench.spendUsual > 0 ? rowLimit * bench.spendUsual : Infinity;
    if (largestSuccessful > rowMax + 1e-9) {
      base = rowMax; rowLimited = true;
      basis = `largest successful month held to ${rowLimit} x usual monthly spend`;
    } else if (largestSuccessful > 0) { base = largestSuccessful; basis = 'largest successful month'; }
    else {
      base = bench.spendUsual;
      basis = bench.spendBasis === 'own' ? 'no successful month: usual monthly spend' : 'no successful month: platform typical month';
      flagged = true;
    }
    return { ceiling: base * multiple, base, basis, flagged, rowLimited, rowLimit: Number.isFinite(rowMax) ? rowMax : null, multiple, largestSuccessful, largestMonth, cpaLimit, months,
      benchmark: { cpa: bench.cpaUsual, spend: bench.spendUsual, spendBasis: bench.spendBasis, b: bench.b } };
  }

  // The location spending cap: the most the location spent in one of the
  // months the caps consider, every platform together, x
  // cap_location_month_limit x the multiple. Past spend was media only; the
  // cap on planned spend adds each platform's fee to what it spent that month.
  //   fees: { plat: fee rate } for this plan
  function location(ctx, region, months, fees, multiple) {
    const limit = RAC.assumptions.get(ctx.A, 'cap_location_month_limit');
    let best = null;
    months.forEach(mo => {
      const byPlat = {};
      let media = 0, total = 0;
      RAC.PLATFORMS.forEach(plat => {
        const x = RAC.data.monthly(ctx.ds, plat, region, ctx.role)[mo];
        const s = x ? x.spend : 0;
        byPlat[plat] = s; media += s; total += s * (1 + (fees[plat] || 0));
      });
      if (!best || media > best.media) best = { month: mo, media, total, byPlat };
    });
    if (!(limit > 0) || !best || !(best.media > 0)) {
      return { on: false, limit, multiple, month: best ? best.month : null, media: best ? best.media : 0, byPlat: best ? best.byPlat : {}, cap: Infinity };
    }
    return { on: true, limit, multiple, month: best.month, media: best.media, byPlat: best.byPlat,
      capMedia: best.media * limit * multiple, cap: best.total * limit * multiple };
  }

  // Spend (including any fee) at which planned cost per application, on the
  // total cost, reaches a limit (D6).
  function spendAtCpaLimit(pc, limit) {
    if (!(limit > 0)) return Infinity;
    const g = 1 + (pc.fee || 0);
    const atUsual = pc.cpaUsual * pc.bias * g;
    if (pc.b >= 1 || !(pc.spendUsual > 0)) return atUsual <= limit ? Infinity : 0;
    // cost = atUsual x (media / usual spend) ^ (1 - b), solved for cost = limit.
    return g * pc.spendUsual * Math.pow(limit / atUsual, 1 / (1 - pc.b));
  }

  RAC.ceilings = { qualityByLocation, cell, location, spendAtCpaLimit };
})(window.RAC = window.RAC || {});
