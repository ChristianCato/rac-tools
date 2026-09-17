// RAC planner: the new plan in the shape the existing screens read.
//
// The Setup, Plan, Platforms and Compare screens and the pacing tool were
// written against the previous engine's result. This maps the new plan onto
// those field names so the screens work unchanged. The full new plan is kept
// on the result as `v2` for the new exports and the Method text.
//
// Field notes:
//   beyondProven     spend above each cell's largest successful month (x1)
//   unplacedBudget   budget the plan could not place efficiently
//   mostHires, saturationBudget  where the target is out of reach within the
//                    spending caps: the most hires and the budget where they stop rising
//   aggBandPct       half the width of the plan range, for screens that show
//                    one figure; predLow and predHigh carry the real range
//   appSubTarget     the application target shared by predicted applications,
//                    so it follows the budget (D8)
//   predictedHires   paid-media hires plus expected hires from other sources,
//                    the figure set against the hire target; location and
//                    platform rows, and paidHires, are paid media only
//   otherSourcesHires  the fixed line "Expected hires from other sources"
(function (RAC) {
  'use strict';
  const U = RAC.util;
  const P = () => RAC.PLATFORMS;
  const pct = (r) => (r ? Math.round(((r.highPct - r.lowPct) / 2) * 100) : 0);

  function cellRow(c) {
    const r = c.range;
    return {
      region: c.region, live: true, spend: c.spend, mediaSpend: c.media, fee: c.fee, predApps: c.apps,
      cvr: c.applyRate || 0, hireCvr: c.hirePerApplication,
      predHires: c.hires,
      predHiresLow: r ? r.hires.low : 0, predHiresHigh: r ? r.hires.high : 0,
      cph: c.spend > 0 && c.hires > 0 ? c.spend / c.hires : null,
      cpa: c.apps > 0 ? c.spend / c.apps : 0,
      predLow: r ? r.apps.low : 0, predHigh: r ? r.apps.high : 0,
      bandPct: pct(r && r.apps),
      cpaLow: r && r.apps.high > 0 ? c.spend / r.apps.high : 0,
      cpaHigh: r && r.apps.low > 0 ? c.spend / r.apps.low : 0,
      cvrLow: 0, cvrHigh: 0,
    };
  }

  function toLegacy(plan) {
    const appTarget = plan.appTarget || 0;
    const totalApps = plan.totals.apps;
    const locations = plan.locations.map(l => {
      const platSpend = {}, platShare = {}, platApps = {}, platHires = {}, platCpa = {}, onPlat = {}, peaks = {}, beyond = {};
      P().forEach(p => {
        const c = l.cells[p];
        platSpend[p] = c.spend;
        platShare[p] = l.spend > 0 ? c.spend / l.spend : 0;
        platApps[p] = c.apps;
        platHires[p] = c.hires;
        platCpa[p] = c.plannedCpa;
        onPlat[p] = c.on;
        peaks[p] = c.largestMonth;
        beyond[p] = c.aboveLargestSuccessful;
      });
      const thin = P().some(p => l.cells[p].spend > 0 && l.cells[p].cpaSource !== 'own');
      const adjusted = P().some(p => l.cells[p].spend > 0 && l.cells[p].thinAdjustment && Math.abs(l.cells[p].thinAdjustment - 1) > 0.01);
      return {
        region: l.region, vacancies: l.vacancies,
        cpa: l.cpa || 0, rawCpa: null,
        cpaSource: thin ? 'benchmark' : adjusted ? 'shrunk' : 'measured',
        cvr: 0,
        bandPct: pct(l.range && l.range.apps), bandBasis: 'tested',
        coverageSlice: 0, demandShare: l.base, spend: l.spend,
        predApps: l.apps,
        predLow: l.range ? l.range.apps.low : 0, predHigh: l.range ? l.range.apps.high : 0,
        predHires: l.hires,
        predHiresLow: l.range ? l.range.hires.low : 0, predHiresHigh: l.range ? l.range.hires.high : 0,
        appSubTarget: totalApps > 0 ? appTarget * (l.apps / totalApps) : 0,
        platShare, platShareSource: 'marginal cost per hire', platSpend, onPlat,
        coveredCount: P().filter(p => onPlat[p]).length,
        curves: {}, caps: Object.fromEntries(P().map(p => [p, l.cells[p].cap])), peaks,
        marginal: null, platCpa, platCpaSource: {},
        overCap: 0, beyondProven: beyond, beyondProvenTotal: U.sum(Object.values(beyond)),
        floorShortfall: l.floorShortfall, platApps, platHires,
        hireCvr: l.apps > 0 ? l.hires / l.apps : 0,
        cph: l.hires > 0 ? l.spend / l.hires : null,
      };
    });
    const platformTotals = {};
    P().forEach(p => { platformTotals[p] = plan.platforms[p].spend; });
    const summaryRow = (x, extra) => ({
      ...extra, spend: x.spend,
      share: plan.deployable > 0 ? x.spend / plan.deployable : 0,
      cvr: 0, cvrLow: 0, cvrHigh: 0,
      hireCvr: x.apps > 0 ? x.hires / x.apps : 0,
      predHires: x.hires,
      predHiresLow: x.range ? x.range.hires.low : 0, predHiresHigh: x.range ? x.range.hires.high : 0,
      cph: x.hires > 0 ? x.spend / x.hires : null,
      cpa: x.apps > 0 ? x.spend / x.apps : 0,
      predApps: x.apps,
      predLow: x.range ? x.range.apps.low : 0, predHigh: x.range ? x.range.apps.high : 0,
      bandPct: pct(x.range && x.range.apps),
      cpaLow: x.range && x.range.apps.high > 0 ? x.spend / x.range.apps.high : 0,
      cpaHigh: x.range && x.range.apps.low > 0 ? x.spend / x.range.apps.low : 0,
    });
    const channelSummary = P().map(p => summaryRow(plan.platforms[p], { platform: p }));
    const regionSummary = plan.locations.map(l => summaryRow(l, { region: l.region, vacancies: l.vacancies }));
    const regionChannel = {};
    P().forEach(p => {
      regionChannel[p] = plan.allRegions.map(region => {
        const loc = plan.locations.find(l => l.region === region);
        if (loc) return cellRow(loc.cells[p]);
        const c = plan.idleCells[region][p];
        return { ...cellRow(c), live: false, spend: 0, mediaSpend: 0, fee: 0, predApps: 0, predHires: 0, cph: null, cpa: 0 };
      });
    });
    const t = plan.totals;
    const platBreaches = {};
    P().forEach(p => {
      const hi = plan.platMax[p] > 0 ? plan.platMax[p] : Infinity, lo = plan.platMin[p] > 0 ? plan.platMin[p] : 0;
      if (platformTotals[p] > hi + 1) platBreaches[p] = { kind: 'over', limit: hi, total: platformTotals[p] };
      else if (platformTotals[p] < lo - 1) platBreaches[p] = { kind: 'under', limit: lo, total: platformTotals[p] };
    });
    return {
      unplaceable: 0,
      beyondProven: plan.aboveLargestSuccessful.total,
      role: plan.role, daysInMonth: plan.daysInMonth, coverageRate: plan.inputs.coveragePct > 0 ? plan.inputs.coveragePct / 100 : 0,
      premiumHoldback: plan.holdbacks.premium, fees: plan.fees, acHoldback: plan.holdbacks.combined, oneRacHoldback: plan.holdbacks.oneRac,
      deployable: plan.deployable, coverageReserve: plan.coverageReserve, demandPool: plan.demandPool,
      locations, totalVac: plan.totalVac, totalCount: plan.liveCount, platformTotals,
      channelSummary, regionSummary, regionChannel,
      platBreaches, platClamped: {}, platMin: plan.platMin, platMax: plan.platMax,
      regionMin: plan.regionMin, regionMax: plan.regionMax, regionClamped: {},
      unplacedBudget: plan.unplaced.total,
      appTarget, predictedApps: t.apps,
      predLow: t.range.apps.low, predHigh: t.range.apps.high,
      aggBandPct: Math.round(((t.range.apps.highPct - t.range.apps.lowPct) / 2) * 100),
      aggBandMonths: plan.ranges.months || 0,
      predictedHires: t.allHires,
      predictedHiresLow: t.range.allHires.low, predictedHiresHigh: t.range.allHires.high,
      paidHires: t.paidHires, paidHiresLow: t.range.hires.low, paidHiresHigh: t.range.hires.high,
      otherSourcesHires: t.otherHires, otherSourcesLow: t.range.otherHires.low, otherSourcesHigh: t.range.otherHires.high,
      otherHiresShare: plan.otherHiresShare, otherSourcesMeetTarget: plan.otherSourcesMeetTarget,
      onTarget: appTarget > 0 && t.apps >= appTarget,
      pctOfTarget: appTarget > 0 ? t.apps / appTarget : (t.apps > 0 ? 1 : 0),
      budgetForTarget: plan.budgetForTarget, budgetPinned: plan.pinned,
      capsBinding: plan.unplaced.total > 1, solveOnHires: plan.solveOnHires,
      targetUnreachable: plan.unreachable,
      mostHires: plan.maxAchievable, saturationBudget: plan.saturationBudget,
      budget: plan.budget,
      v2: plan,
    };
  }

  RAC.legacyShape = { toLegacy };
})(window.RAC = window.RAC || {});
