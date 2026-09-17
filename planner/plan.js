// RAC planner: the plan for one role. The one entry point the app, the
// exports and the checks use:
//
//   RAC.plan.build(role, inputs, env)
//     inputs  the Setup settings for the role (see INPUTS below)
//     env     { ds: RAC.data.snapshot(...), A: assumptions, eploy: rates file }
//
// Order of work:
//   1. Hold-backs off the top (Indeed Premium, Combined Activity, OneRAC).
//   2. Every location and platform: usual cost per application, diminishing
//      returns, screening and hire rates, spending limit (C1 to C5), and the
//      spend at which any cost per application limit binds (D6).
//   3. Deployable budget split between live locations by open roles, within
//      location minimums and maximums, spending limits and any cost per hire
//      limit. Money a location cannot take moves to locations with room, by
//      open roles; what none can take is reported as budget the plan could
//      not place efficiently.
//   4. Within each location, spend goes where the next hire costs least, up
//      to each platform's limit. Floors set on Setup and platform minimums
//      and maximums are then applied.
//   5. The forecast for every location and platform, totals and ranges.
//   6. Budget needed for the hire target, by running the plan at trial budgets.
//
// INPUTS (as the app's planParams builds them, plus the new settings):
//   budget, hireTarget, appTarget, liveRegions, vacancies, coveragePct,
//   premiumCampaigns, acReserve, platMin, platMax, coverage, comboMin,
//   regionMin, regionMax (-1 means no spend), daysInMonth, capMultiple,
//   bench (data window), limits: { cph: { region }, cpa: { region: { plat } } },
//   oneRacHoldback, overrides (per-plan assumption values)
(function (RAC) {
  'use strict';
  const U = RAC.util;
  const NO_SPEND = -1;
  const P = () => RAC.PLATFORMS;

  function envStamp(env) {
    const e = env.eploy || { dataset: {} };
    return [env.ds.stamp, env.A.fingerprint, e.dataset.file, e.dataset.file_date, e.mappings_sha256].join('|');
  }

  function assumptionsFor(env, inputs) {
    const o = inputs.overrides || {};
    return Object.keys(o).length ? RAC.assumptions.withValues(env.A, o) : env.A;
  }

  // Step 2: everything about each location and platform that does not depend
  // on the budget. Kept for the budget search, where only the money changes.
  function prepare(role, inputs, env) {
    const A = assumptionsFor(env, inputs);
    const get = (k) => RAC.assumptions.get(A, k, role);
    const ds = env.ds;
    const ctx = RAC.cost.context(ds, A, role, inputs.bench);
    const hireRates = RAC.rates.build(env.eploy, A, role, { regions: ds.regions });
    const d1 = RAC.forecast.rates(ds, A, role, ctx.settled);
    const factors = { bias: get('remaining_error_factor'), recon: get('hire_reconciliation_factor') };
    const m = Number(inputs.capMultiple);
    const capMultiple = Number.isFinite(m) && m >= 1 && m <= 3 ? m : get('cap_multiple_default');
    const quality = RAC.ceilings.qualityByLocation(env.eploy, hireRates, role);
    const cpaLimits = (inputs.limits && inputs.limits.cpa) || {};
    const cells = {};
    ds.regions.forEach(region => {
      cells[region] = {};
      P().forEach(plat => {
        const pc = RAC.forecast.prepare(ctx, hireRates, d1, factors, plat, region);
        const cpaLimit = (cpaLimits[region] || {})[plat] || null;
        const ceiling = RAC.ceilings.cell(ctx, pc, quality, { capMultiple, cpaLimit });
        const cpaCap = RAC.ceilings.spendAtCpaLimit(pc, cpaLimit);
        cells[region][plat] = { pc, ceiling, cpaLimit, cpaCap, cap: Math.max(0, Math.min(ceiling.ceiling, cpaCap)) };
      });
    });
    const ranges = {
      apps: { low: get('range_apps_low'), high: get('range_apps_high'), sigma: get('range_apps_sigma') },
      hires: { low: get('range_hires_low'), high: get('range_hires_high'), sigma: get('range_hires_sigma') },
      widen: get('row_widen_apps'),
      hireBlend: get('region_hire_blend_n'),
    };
    return { role, A, ds, ctx, hireRates, d1, factors, capMultiple, cells, ranges,
      premiumRate: RAC.assumptions.get(A, 'indeed_premium_rate') };
  }

  // Steps 1 and 3 to 5 for one budget.
  function allocate(base, p) {
    const role = base.role;
    const days = p.daysInMonth || 30;
    const premium = Math.round((p.premiumCampaigns || 0) * days * base.premiumRate);
    const combined = Math.max(0, Math.round(p.acReserve || 0));
    const oneRac = Math.max(0, Math.round(p.oneRacHoldback || 0));
    const budget = p.budget || 0;
    const deployable = Math.max(0, budget - premium - combined - oneRac);
    const coverageRate = (p.coveragePct >= 0 ? p.coveragePct : 0) / 100;
    const coverage = p.coverage || {};
    const regionMin = p.regionMin || {}, regionMax = p.regionMax || {};
    const cphLimits = (p.limits && p.limits.cph) || {};
    const steps = [];

    let locs = (p.liveRegions || []).map(region => {
      const vacancies = Math.max(0, Math.round((p.vacancies || {})[region] || 0));
      const on = P().filter(plat => !(coverage[region] && coverage[region][plat] === false));
      const cells = on.map(plat => ({ plat, pc: base.cells[region][plat].pc, cap: base.cells[region][plat].cap }));
      return { region, vacancies, cells, on };
    }).filter(l => l.vacancies > 0 && l.cells.length > 0);
    const totalVac = U.sum(locs.map(l => l.vacancies));
    const coverageReserve = deployable * coverageRate;
    const demandPool = deployable - coverageReserve;

    locs.forEach(l => {
      const ceilingSum = U.sum(l.on.map(plat => base.cells[l.region][plat].ceiling.ceiling));
      l.capacity = U.sum(l.cells.map(c => c.cap));
      l.cphLimit = cphLimits[l.region] > 0 ? cphLimits[l.region] : null;
      l.cphCap = RAC.allocate.spendAtCphLimit(l.cells, l.capacity, l.cphLimit);
      const maxCap = regionMax[l.region] === NO_SPEND ? 0 : (regionMax[l.region] > 0 ? regionMax[l.region] : Infinity);
      const options = [
        [maxCap, regionMax[l.region] === NO_SPEND ? 'location set to no spend' : 'location maximum'],
        [l.capacity, l.capacity < ceilingSum - 0.005 ? 'spending limits and cost per application limits' : 'spending limits (largest successful month x multiple)'],
        [l.cphCap, 'cost per hire limit'],
      ];
      const [cap, reason] = options.reduce((a, b) => (b[0] < a[0] ? b : a));
      l.cap = cap; l.capReason = reason;
      l.floor = regionMin[l.region] > 0 ? regionMin[l.region] : 0;
      if (l.floor > maxCap) {
        // Two instructions disagree. The minimum is applied, as before, and said.
        steps.push({ step: 'between locations', region: l.region, amount: 0, reason: `location minimum £${Math.round(l.floor)} is above its maximum; the minimum was applied` });
      }
      l.base = (locs.length ? coverageReserve / locs.length : 0) + (totalVac > 0 ? demandPool * l.vacancies / totalVac : 0);
      l.spend = l.base;
    });
    const settled = RAC.allocate.settle(locs);
    settled.steps.forEach(s => steps.push({ step: 'between locations', ...s }));
    let unplaced = settled.unplaced;
    const unplacedReasons = {};
    if (settled.unplaced > 0.005) {
      locs.filter(l => l.spend >= l.cap - 0.005).forEach(l => { unplacedReasons[l.capReason] = true; });
    }

    // Step 4: within each location.
    const comboMin = p.comboMin || {};
    const aboveByInstruction = {};
    locs.forEach(l => {
      const floors = {};
      l.cells.forEach(c => { const f = (comboMin[l.region] || {})[c.plat]; if (f > 0) floors[c.plat] = f; });
      l.fixed = {};
      let s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
      for (let i = 0; i < 5; i++) {
        const low = Object.keys(floors).filter(plat => (s.spend[plat] || 0) < floors[plat] - 0.005 && l.fixed[plat] === undefined);
        if (!low.length) break;
        low.forEach(plat => { l.fixed[plat] = floors[plat]; steps.push({ step: 'within location', region: l.region, platform: plat, amount: floors[plat] - (s.spend[plat] || 0), reason: 'floor set on Setup' }); });
        s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
      }
      l.split = s.spend;
      if (s.shortfall > 0.005) {
        // Floors asked for more than the location has: keep their proportions.
        const k = l.spend / (l.spend + s.shortfall);
        Object.keys(l.split).forEach(plat => { l.split[plat] *= k; });
        l.floorShortfall = s.shortfall;
      }
      if (s.leftover > 0.005) {
        // Only an instruction (a location minimum) can put more into a location
        // than its platforms' limits allow. Spread it by limit and record it.
        const capSum = U.sum(l.cells.map(c => c.cap)) || l.cells.length;
        l.cells.forEach(c => {
          const add = s.leftover * ((U.sum(l.cells.map(x => x.cap)) ? c.cap : 1) / capSum);
          l.split[c.plat] += add;
          aboveByInstruction[l.region + '|' + c.plat] = add;
        });
        steps.push({ step: 'within location', region: l.region, amount: s.leftover, reason: 'location minimum above its spending limits; spent above the limits as instructed' });
      }
    });

    // Platform minimums and maximums across the role.
    const platMin = p.platMin || {}, platMax = p.platMax || {};
    for (let iter = 0; iter < 8; iter++) {
      const totals = {};
      P().forEach(plat => { totals[plat] = U.sum(locs.map(l => l.split[plat] || 0)); });
      let worst = null;
      P().forEach(plat => {
        const hi = platMax[plat] > 0 ? platMax[plat] : Infinity, lo = platMin[plat] > 0 ? platMin[plat] : 0;
        const target = totals[plat] > hi ? hi : (totals[plat] < lo ? lo : totals[plat]);
        const gap = Math.abs(target - totals[plat]);
        if (gap > 1 && (!worst || gap > worst.gap)) worst = { plat, target, gap, total: totals[plat] };
      });
      if (!worst) break;
      const { plat, target, total } = worst;
      const holders = locs.filter(l => l.on.includes(plat));
      holders.forEach(l => {
        const cur = l.split[plat] || 0;
        const share = total > 0 ? cur / total : 1 / holders.length;
        l.fixed[plat] = target < total ? cur * (target / total) : cur + (target - total) * share;
        const s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
        l.split = s.spend;
        if (s.leftover > 0.005) {
          unplaced += s.leftover; unplacedReasons['platform maximum'] = true;
          l.spend -= s.leftover;
          steps.push({ step: 'platform limits', region: l.region, platform: plat, amount: -s.leftover, reason: 'platform maximum: no other platform here had room' });
        }
        if (s.shortfall > 0.005) {
          l.fixed[plat] -= s.shortfall; l.split[plat] -= s.shortfall;
        }
      });
      steps.push({ step: 'platform limits', platform: plat, amount: target - total, reason: target < total ? 'platform maximum' : 'platform minimum' });
    }

    // Step 5: forecast.
    const r = base.ranges;
    const rows = [];
    locs.forEach(l => {
      l.cellResults = {};
      P().forEach(plat => {
        const c = base.cells[l.region][plat];
        const S = l.split[plat] || 0;
        const f = RAC.forecast.at(c.pc, S);
        l.cellResults[plat] = cellResult(base, c, S, f, l.on.includes(plat), aboveByInstruction[l.region + '|' + plat] || 0);
        rows.push(l.cellResults[plat]);
      });
    });

    const locations = locs.map(l => {
      const cs = P().map(plat => l.cellResults[plat]);
      const out = rollUp(base, cs, { region: l.region, vacancies: l.vacancies });
      return { ...out, cells: l.cellResults, cap: l.cap, capReason: l.capReason, cphLimit: l.cphLimit,
        capacity: l.capacity, base: l.base, floor: l.floor, floorShortfall: l.floorShortfall || 0, fixed: l.fixed,
        hireEvidence: hireEvidence(base, l.region) };
    });
    locations.forEach(loc => { loc.range = rowRanges(base, loc.cellsList, loc.hireEvidence); });
    const platforms = {};
    P().forEach(plat => {
      const cs = locations.map(l => l.cells[plat]);
      platforms[plat] = rollUp(base, cs, { platform: plat });
      platforms[plat].range = rowRanges(base, cs, U.sum(locations.map(l => l.hireEvidence)) / Math.max(1, locations.length));
    });
    const all = locations.flatMap(l => l.cellsList);
    const totals = rollUp(base, all, {});
    totals.range = {
      apps: { low: totals.apps * (1 + r.apps.low), high: totals.apps * (1 + r.apps.high), lowPct: r.apps.low, highPct: r.apps.high },
      hires: { low: totals.hires * (1 + r.hires.low), high: totals.hires * (1 + r.hires.high), lowPct: r.hires.low, highPct: r.hires.high },
    };
    const aboveLargestSuccessful = U.sum(all.map(c => c.aboveLargestSuccessful));
    const aboveLargestMonth = U.sum(all.map(c => c.aboveLargestMonth));
    const placed = U.sum(locations.map(l => l.spend));

    return {
      role, budget, daysInMonth: days,
      holdbacks: { premium, combined, oneRac, total: premium + combined + oneRac },
      deployable, coverageReserve, demandPool, totalVac, liveCount: locations.length,
      locations, platforms, totals,
      placed,
      unplaced: { total: unplaced, reasons: Object.keys(unplacedReasons) },
      aboveLargestSuccessful: { total: aboveLargestSuccessful, share: placed > 0 ? aboveLargestSuccessful / placed : 0 },
      aboveLargestMonth: { total: aboveLargestMonth, share: placed > 0 ? aboveLargestMonth / placed : 0 },
      platMin, platMax, regionMin, regionMax,
      steps,
    };
  }

  function cellResult(base, c, S, f, on, aboveByInstruction) {
    const pc = c.pc;
    const r = base.ranges;
    const u = pc.usual;
    const w = RAC.backtest.widen(r.apps, r.widen, u.apps, S, pc.spendUsual, base.d1[pc.plat].seUsed);
    const apps = RAC.backtest.band(r.apps, w);
    return {
      region: pc.region, platform: pc.plat, on, spend: S,
      apps: f.apps, passed: f.passed, hires: f.hires,
      cpa: f.apps > 0 ? f.cpa : null,
      cph: f.hires > 0 ? S / f.hires : null,
      // Cost per application build-up.
      historicCpa: u.rawCpa, historicApps: u.apps, historicSpend: u.spend, windowMonths: base.ctx.windowMonths,
      platformCpa: u.platform.cpa, thinAdjustment: u.thinAdjustment, usualCpa: u.cpa, cpaSource: u.source,
      spendUsual: pc.spendUsual, spendBasis: pc.spendBasis, diminishingRate: pc.b,
      spendAdjustment: f.spendAdjustment, remainingError: pc.bias, plannedCpa: f.cpa,
      // Screening and hires build-up.
      screenRate: pc.screen, platformScreen: pc.rates.platformScreen, screenBasis: pc.rates.platformBasis,
      screenAdjustment: pc.rates.screenAdjustment, hireAfterScreening: pc.hireAfterScreening,
      reconciliation: pc.recon, hirePerApplication: pc.hirePerApplication,
      // Spending limit.
      ceiling: c.ceiling.ceiling, ceilingBase: c.ceiling.base, ceilingBasis: c.ceiling.basis, ceilingFlagged: c.ceiling.flagged,
      largestSuccessful: c.ceiling.largestSuccessful, largestMonth: c.ceiling.largestMonth, ceilingMonths: c.ceiling.months,
      cpaLimit: c.cpaLimit, cpaLimitSpend: Number.isFinite(c.cpaCap) ? c.cpaCap : null, cap: c.cap,
      aboveLimitByInstruction: aboveByInstruction,
      aboveLargestSuccessful: Math.max(0, S - c.ceiling.base),
      aboveLargestMonth: Math.max(0, S - c.ceiling.largestMonth),
      // Range.
      widen: w,
      range: S > 0 ? {
        apps: { low: f.apps * (1 + apps.low), high: f.apps * (1 + apps.high), lowPct: apps.low, highPct: apps.high },
        hires: hireBand(base, f.hires, w, hireEvidence(base, pc.region)),
      } : null,
    };
  }

  // Hires behind a location's hire rate after screening, allowing for the
  // blend with the role figure.
  function hireEvidence(base, region) {
    const loc = base.hireRates.location[region];
    const role = base.hireRates.totals.hire.hires;
    const R = base.ranges.hireBlend;
    if (!loc) return role;
    const P_ = loc.hirePassed;
    return loc.hires * (P_ / (P_ + R || 1)) + role * (R / (P_ + R || 1));
  }

  function hireBand(base, hires, w, evidence) {
    const r = base.ranges.hires;
    const rateTerm = 1 / (Math.max(evidence, 1) * Math.max(r.sigma, 1e-6) ** 2);
    const wh = Math.sqrt(w * w + rateTerm);
    const b = RAC.backtest.band(r, wh);
    return { low: hires * (1 + b.low), high: hires * (1 + b.high), lowPct: b.low, highPct: b.high };
  }

  function rollUp(base, cells, extra) {
    const spend = U.sum(cells.map(c => c.spend));
    const apps = U.sum(cells.map(c => c.apps));
    const passed = U.sum(cells.map(c => c.passed));
    const hires = U.sum(cells.map(c => c.hires));
    return {
      ...extra, spend, apps, passed, hires,
      cpa: apps > 0 ? spend / apps : null,
      cph: hires > 0 ? spend / hires : null,
      screenRate: apps > 0 ? passed / apps : null,
      hirePerApplication: apps > 0 ? hires / apps : null,
      cellsList: cells,
    };
  }

  // A row's range: widened for the evidence behind all its cells together.
  function rowRanges(base, cells, hireEv) {
    const r = base.ranges;
    const funded = cells.filter(c => c.spend > 0);
    const spend = U.sum(funded.map(c => c.spend));
    if (!(spend > 0)) return null;
    const apps = U.sum(funded.map(c => c.apps));
    const hires = U.sum(funded.map(c => c.hires));
    const evidence = U.sum(funded.map(c => c.historicApps || 0));
    const usual = U.sum(funded.map(c => c.spendUsual || 0));
    const se = U.sum(funded.map(c => c.spend * (base.d1[c.platform].seUsed || 0))) / spend;
    const w = RAC.backtest.widen(r.apps, r.widen, evidence, spend, usual, se);
    const a = RAC.backtest.band(r.apps, w);
    return {
      widen: w,
      apps: { low: apps * (1 + a.low), high: apps * (1 + a.high), lowPct: a.low, highPct: a.high },
      hires: hireBand(base, hires, w, hireEv),
    };
  }

  // Step 6: budget for the hire target.
  function budgetForTarget(base, p, plan) {
    const target = p.hireTarget > 0 ? p.hireTarget : 0;
    const appTarget = p.appTarget > 0 ? p.appTarget : 0;
    const solveOnHires = target > 0;
    const goal = solveOnHires ? target : appTarget;
    const out = { goal, solveOnHires, budgetForTarget: 0, pinned: false, unreachable: false, maxAchievable: null };
    if (!(goal > 0)) return out;
    const holdbacks = plan.holdbacks.total;
    const minTotal = U.sum(plan.locations.map(l => l.floor || 0));
    if (plan.locations.length && minTotal >= plan.deployable - 1) {
      out.pinned = true;
      out.budgetForTarget = Math.ceil((minTotal + holdbacks) / 50) * 50;
      return out;
    }
    const at = (b) => { const q = allocate(base, { ...p, budget: b }); return solveOnHires ? q.totals.hires : q.totals.apps; };
    let lo = holdbacks, hi = lo + 500000;
    for (let i = 0; i < 8 && at(hi) < goal; i++) hi *= 1.6;
    const most = at(hi);
    if (most < goal) {
      out.unreachable = true;
      out.maxAchievable = most;
      return out;
    }
    for (let i = 0; i < 60 && hi - lo > 2; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < goal) lo = mid; else hi = mid;
    }
    out.budgetForTarget = Math.ceil(hi / 50) * 50;
    return out;
  }

  function build(role, inputs, env) {
    if (!env || !env.A || !env.A.ok) throw new Error('The assumptions file has not loaded or is invalid, so the planner cannot run.');
    if (!env.eploy) throw new Error('The Eploy rates file has not loaded, so the planner cannot run.');
    const key = role + '|' + U.stableKey(inputs) + '|' + envStamp(env);
    const hit = RAC.cache.get(key);
    if (hit) return hit;
    const baseKey = 'base|' + role + '|' + U.stableKey({ bench: inputs.bench, capMultiple: inputs.capMultiple,
      cpa: inputs.limits && inputs.limits.cpa, overrides: inputs.overrides }) + '|' + envStamp(env);
    let base = RAC.cache.get(baseKey);
    if (!base) base = RAC.cache.set(baseKey, prepare(role, inputs, env));
    const plan = allocate(base, inputs);
    const target = budgetForTarget(base, inputs, plan);
    const A = base.A;
    const status = base.ctx.status;
    const result = {
      ...plan,
      ...target,
      hireTarget: inputs.hireTarget || 0,
      appTarget: inputs.appTarget || 0,
      capMultiple: base.capMultiple,
      window: base.ctx.window,
      windowMonths: base.ctx.windowMonths,
      weights: base.ctx.weights,
      factors: base.factors,
      diminishingReturns: base.d1,
      rates: base.hireRates,
      ranges: base.ranges,
      months: status,
      stamps: {
        assumptions: { date: A.date, fingerprint: A.fingerprint, overrides: inputs.overrides || {} },
        data: { stamp: env.ds.stamp, settledTo: base.ctx.settled[base.ctx.settled.length - 1] || null,
          repoFileGenerated: env.ds.repo.generated_at, uploadTakenOn: env.ds.bench ? env.ds.bench.at : null },
        eploy: { file: env.eploy.dataset.file, fileDate: env.eploy.dataset.file_date },
      },
      inputs,
    };
    return RAC.cache.set(key, result);
  }

  function invalidate() { RAC.cache.clear(); }

  RAC.plan = { NO_SPEND, prepare, allocate, budgetForTarget, build, invalidate };
})(window.RAC = window.RAC || {});
