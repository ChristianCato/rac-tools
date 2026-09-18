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
//      returns, screening and hire rates, spending cap (C1 to C5), and the
//      spend at which any cost per application limit binds (D6).
//   3. Deployable budget split between live locations by open roles, within
//      location minimums and maximums, spending caps and any cost per hire
//      limit. Money a location cannot take moves to locations with room, by
//      open roles; what none can take is reported as budget the plan could
//      not place efficiently.
//   4. Within each location, spend goes where the next hire costs least, up
//      to each platform's spending cap. Floors set on Setup and platform
//      minimums and maximums are then applied. No minimum or floor takes a
//      platform above its spending cap (user decision, 17 September 2026);
//      what a minimum could not get is listed in minimumShortfalls.
//   5. The forecast for every location and platform, totals and ranges.
//      Platform fees (plans from fees_first_month): Indeed, Meta and Google spend,
//      including the Indeed Premium hold-back, is media plus fee; forecasts
//      and spending caps work on media, costs are reported on the total.
//   6. Budget needed for the hire target, by running the plan at trial budgets.
//      Where the caps make the target unreachable, the plan reports the most
//      hires achievable, the budget at which extra spend stops adding hires,
//      and the same figures at cap multiples 1, 2 and 3 (reach).
//
// Hire ranges (user decision, 17 September 2026). Not from the hire test on
// past months (kept as a check only). Each range combines, in hire_range_draws
// simulated draws with a fixed seed:
//   - the application range (tested misses, widened for thin rows);
//   - the screening pass rates, location screening adjustments and hire
//     rates after screening, rebuilt from their Eploy counts redrawn within
//     their statistical uncertainty;
//   - the matching factor to platform hires, from the hires behind it;
//   - the expected hires from other sources, from the month-to-month spread
//     of their counts;
//   - chance variation in the number of hires itself (user decision,
//     17 September 2026): each draw's paid-media hires are a Poisson count
//     around its expected value; other-source hires are a count around their
//     expected value, varying as much as their monthly counts did.
// The range is the 10th to 90th percentile of the draws. A row is flagged low
// confidence where its hire rate uncertainty is above low_confidence_rate_sd
// or fewer than low_confidence_min_apps applications sat behind its cost per
// application.
//
// Hires from other sources (user decision, 17 September 2026). Eploy recorded
// hires outside the four platforms (organic, job alerts, agencies and so on).
//   - Paid-media hires are matched to the hires Eploy credited to the four
//     platforms (paid_hire_reconciliation_factor) at every share, 0% included.
//   - A share of them (otherHiresShare, Setup; default
//     other_hires_credited_share) is credited to paid media. That part scales
//     with paid spend: every location and platform's hires are multiplied by
//     paid_hire_reconciliation_factor + share x other_hires_credit_factor.
//   - The rest is a fixed line, "Expected hires from other sources":
//     (1 - share) x expected other-source hires a month (Setup; default
//     other_hires_monthly, the average of every settled month). It counts towards the hire target but
//     does not depend on the budget, so the budget solves for the remainder.
//     Location and platform rows show paid-media hires only.
// At a share of 100% the plan equals the earlier scaling to every hire Eploy
// recorded (checked in tests/checks/60_plan.mjs).
//
// INPUTS (as the app's planParams builds them, plus the new settings):
//   budget, hireTarget, appTarget, liveRegions, vacancies, coveragePct,
//   premiumCampaigns, acReserve, platMin, platMax, coverage, comboMin,
//   regionMin, regionMax (-1 means no spend), daysInMonth, capMultiple (spending cap multiple, 1 to 3),
//   otherHiresShare (0 to 1; blank uses the file default),
//   otherHiresMonthly (hires a month; blank uses the file default),
//   remainingError (0.5 to 2; blank uses the assumptions file's value),
//   includeSettling (count complete months still inside the settle period),
//   bench (data window), limits: { cph: { region }, cpa: { region: { plat } } },
//   oneRacHoldback, overrides (per-plan assumption values),
//   planMonth (YYYY-MM; platform fees apply from fees_first_month)
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
    const ctx = RAC.cost.context(ds, A, role, inputs.bench, { includeSettling: !!inputs.includeSettling });
    const hireRates = RAC.rates.build(env.eploy, A, role, { regions: ds.regions });
    const d1 = RAC.forecast.rates(ds, A, role, ctx.settled);
    // Core Setup fields: the plan's value where one is set and valid,
    // otherwise the assumptions file's.
    const pick = (v, lo, hi, fallback) => {
      const n = (v === null || v === undefined || v === '') ? NaN : Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
    };
    const share = pick(inputs.otherHiresShare, 0, 1, get('other_hires_credited_share'));
    const otherMonthly = pick(inputs.otherHiresMonthly, 0, 10000, get('other_hires_monthly'));
    const bias = pick(inputs.remainingError, 0.5, 2, get('remaining_error_factor'));
    // Comparison switches, used only by tools/stage2_report.mjs to show the
    // effect of each change against the previous version. No screen sets them.
    const cmp = inputs.compare || {};
    const paidFactor = get('paid_hire_reconciliation_factor'), creditFactor = get('other_hires_credit_factor');
    // Platform fees: plans for fees_first_month onwards (user decision,
    // 17 September 2026).
    const feeRates = { indeed: get('fee_rate_indeed'), meta: get('fee_rate_meta'), google: get('fee_rate_google') };
    const feesOn = !!inputs.planMonth && inputs.planMonth >= get('fees_first_month');
    const fees = Object.fromEntries(P().map(pl => [pl, feesOn ? (feeRates[pl] || 0) : 0]));
    // OneRAC only (planner/onerac.js): cost per application is blended to the
    // mix of open roles, and reduced by the self-competition assumption. Both
    // are 1 and 0 for a role plan, so nothing changes there.
    const roleMix = pick(inputs.roleMixAdjustment, 0.2, 5, 1);
    const selfCompetition = pick(inputs.selfCompetition, 0, 0.9, 0);
    const factors = { bias: bias * roleMix * (1 - selfCompetition), biasSet: bias, roleMix, selfCompetition,
      recon: paidFactor + share * creditFactor, paid: paidFactor, credit: creditFactor, share, fees };
    const keep = cmp.noOtherSources ? 0 : 1 - share;
    const other = RAC.testing.otherSources(env.eploy, A, role, hireRates.hireMonths);
    const baseline = {
      share, keep,
      hires: keep * otherMonthly,
      monthly: otherMonthly,
      tested: get('other_hires_monthly'),
      months: other.monthly, recentFrom: other.recentFrom, recentMean: other.recentMean, dispersion: other.dispersion,
      basis: 'monthly average of hires Eploy recorded outside Indeed, Meta, Google and Appcast',
    };
    const capMultiple = pick(inputs.capMultiple, 1, 3, get('cap_multiple_default'));
    const entry = (key) => A.entries.find(e => e.key === key && (e.role === role || e.role === 'all')) || {};
    const settings = [
      { key: 'capMultiple', name: 'Spending cap multiple', value: capMultiple, default: get('cap_multiple_default'), source: entry('cap_multiple_default').source, unit: 'multiple' },
      { key: 'otherHiresShare', name: 'Share of other-source hires credited to paid media', value: share, default: get('other_hires_credited_share'), source: entry('other_hires_credited_share').source, unit: 'share' },
      { key: 'otherHiresMonthly', name: 'Expected hires from other sources per month', value: otherMonthly, default: get('other_hires_monthly'), source: entry('other_hires_monthly').source, unit: 'hires' },
      { key: 'remainingError', name: 'Remaining-error adjustment', value: bias, default: get('remaining_error_factor'), source: entry('remaining_error_factor').source, unit: 'multiple' },
      { key: 'includeSettling', name: 'Include months still settling', value: !!inputs.includeSettling, default: false, source: 'agreed', unit: 'yes/no' },
    ].map(x => ({ ...x, tested: x.key === 'remainingError' ? entry('remaining_error_factor').testedValue : null, changed: x.value !== x.default }));
    const quality = RAC.ceilings.qualityByLocation(env.eploy, hireRates, role);
    // The spending caps judge a successful month against a fixed benchmark:
    // each location and platform over the settled months from
    // ceiling_first_month (2026), each counted once, whatever the plan's data
    // window. 2025 months were built differently and are not comparable, the
    // same reason C3 leaves them out of the months considered (user decisions,
    // 18 September 2026).
    const ctxCaps = RAC.cost.context(ds, A, role, { mode: 'custom', from: get('ceiling_first_month') }, { includeSettling: !!inputs.includeSettling });
    const cpaLimits = (inputs.limits && inputs.limits.cpa) || {};
    const cells = {};
    ds.regions.forEach(region => {
      cells[region] = {};
      P().forEach(plat => {
        const pc = RAC.forecast.prepare(ctx, hireRates, d1, factors, plat, region);
        if (cmp.previousHireRates) {
          // The previous version's static rate: hires per application from the data file.
          const c = (ds.DATA[plat] || {})[region + '__' + role];
          const rate = (c && c.all_time && c.all_time.hireCvr) || 0;
          Object.assign(pc, { screen: 1, hireAfterScreening: rate, recon: 1, hirePerApplication: rate,
            rates: { platformScreen: null, platformBasis: 'previous static hire rate', screenAdjustment: 1, screen: 1, hireAfterScreening: rate, hirePerApplication: rate } });
        }
        const cpaLimit = (cpaLimits[region] || {})[plat] || null;
        const benchmark = RAC.forecast.prepare(ctxCaps, null, d1, factors, plat, region);
        let ceiling = RAC.ceilings.cell(ctx, pc, quality, { capMultiple, cpaLimit, benchmark });
        if (cmp.previousCeilings) {
          // The previous version: the biggest month on record x the multiple, and
          // money above it spread anyway rather than moved or left unplaced.
          const m = RAC.data.monthly(ds, plat, region, role);
          const peak = Math.max(0, ...Object.keys(m).filter(mo => ctx.settled.includes(mo)).map(mo => m[mo].spend));
          const base_ = peak > 0 ? peak : RAC.cost.typicalMonth(ctx, plat);
          ceiling = { ...ceiling, ceiling: base_ * capMultiple, base: base_, basis: 'previous: biggest month', largestSuccessful: peak };
        }
        const cpaCap = RAC.ceilings.spendAtCpaLimit(pc, cpaLimit);
        // Caps come from past media spend; the plan's spend includes the fee.
        const capTotal = ceiling.ceiling * (1 + pc.fee);
        cells[region][plat] = { pc, ceiling, cpaLimit, cpaCap, cap: Math.max(0, Math.min(capTotal, cpaCap)) };
      });
    });
    // Location spending caps: the most each location spent in one of the
    // months the caps consider, every platform together (user decision, 18
    // September 2026). The previous version had none.
    const capMonthList = ctx.settled.filter(mo => mo >= get('ceiling_first_month'));
    const locationCaps = {};
    ds.regions.forEach(region => {
      locationCaps[region] = cmp.previousCeilings ? { on: false, cap: Infinity }
        : RAC.ceilings.location(ctx, region, capMonthList, fees, capMultiple);
    });
    const ranges = {
      apps: { low: get('range_apps_low'), high: get('range_apps_high'), sigma: get('range_apps_sigma') },
      widen: get('row_widen_apps'),
      lowConfidenceRateSd: get('low_confidence_rate_sd'),
      lowConfidenceMinApps: get('low_confidence_min_apps'),
      percentiles: [get('range_low_percentile'), get('range_high_percentile')],
    };
    const feeInfo = { on: feesOn, planMonth: inputs.planMonth || null, firstMonth: get('fees_first_month'), rates: fees, fileRates: feeRates,
      source: { indeed: entry('fee_rate_indeed').source, meta: entry('fee_rate_meta').source, google: entry('fee_rate_google').source } };
    const base = { role, A, ds, ctx, hireRates, d1, factors, baseline, capMultiple, settings, cells, locationCaps, ranges, softCaps: !!cmp.previousCeilings,
      premiumRate: RAC.assumptions.get(A, 'indeed_premium_rate'), feeInfo };
    base.draws = hireDraws(base, env, !!cmp.previousHireRates);
    return base;
  }

  // Simulated draws for the hire ranges (see the note at the top). For each
  // draw: a standard normal for the application range, a multiplier on each
  // location and platform's hires per application, and the other-source
  // baseline.
  function hireDraws(base, env, fixedRates) {
    const { A, role, ds, ctx, hireRates, factors, baseline } = base;
    const n = RAC.assumptions.get(A, 'hire_range_draws');
    const rand = U.rng(parseInt(U.fingerprint(role + '|hire ranges'), 16));
    const normal = U.normals(rand);
    const regions = ds.regions, K = regions.length * P().length;
    const index = {};
    regions.forEach((r, i) => P().forEach((p, j) => { index[r + '|' + p] = i * P().length + j; }));
    // Applications behind the matching factor: the months it was measured on.
    const months = hireRates.hireMonths.filter(mo => ctx.status[mo] && ctx.status[mo].settled);
    const past = new Float64Array(K);
    regions.forEach(r => P().forEach(p => {
      const m = RAC.data.monthly(ds, p, r, role);
      past[index[r + '|' + p]] = U.sum(months.map(mo => (m[mo] ? m[mo].apps : 0)));
    }));
    const hpaOf = (rates) => {
      const out = new Float64Array(K);
      regions.forEach(r => P().forEach(p => { out[index[r + '|' + p]] = RAC.rates.cell(rates, p, r).hirePerApplication; }));
      return out;
    };
    const hpa0 = hpaOf(hireRates);
    const model0 = past.reduce((a, x, i) => a + x * hpa0[i], 0);
    const credited = RAC.rates.tally(env.eploy, role, months, (reg, plat) => (plat === 'other' ? 'other' : 'paid'));
    const P0 = (credited.paid || {}).hires || 0, O0 = (credited.other || {}).hires || 0;
    const ratio = new Float64Array(n * K);
    const z = new Float64Array(n), other = new Float64Array(n);
    // Other sources: the monthly average is uncertain (spread over the months
    // behind it), and a month's count varies around its expected value by
    // chance and by more than chance (the dispersion of the monthly counts).
    const mo = Math.max(1, baseline.months.length), disp = baseline.dispersion;
    // A count redrawn within its uncertainty: mean x, variance x, never below
    // zero (log-normal).
    const draw = (x) => { const s2 = Math.log(1 + 1 / Math.max(x, 0.5)); return x * Math.exp(Math.sqrt(s2) * normal() - s2 / 2); };
    for (let d = 0; d < n; d++) {
      z[d] = normal();
      const mean = Math.max(0, baseline.monthly + normal() * Math.sqrt(disp * baseline.monthly / mo));
      other[d] = otherCount(rand, normal, baseline.keep * mean, baseline.keep * baseline.keep * mean * (disp - 1));
      if (fixedRates) { ratio.fill(1, d * K, (d + 1) * K); continue; }
      const r = RAC.rates.combine(RAC.rates.redraw(hireRates.counts, normal), hireRates.blend, regions);
      const hpa = hpaOf(r);
      const model = past.reduce((a, x, i) => a + x * hpa[i], 0);
      const scale = model > 0 ? model0 / model : 1;
      const recon = factors.paid * (P0 > 0 ? draw(P0) / P0 : 1) * scale
        + factors.share * factors.credit * (O0 > 0 ? draw(O0) / O0 : 1) * scale;
      for (let i = 0; i < K; i++) ratio[d * K + i] = hpa0[i] > 0 ? (hpa[i] * recon) / (hpa0[i] * factors.recon) : 1;
    }
    return { n, K, index, ratio, z, other, paidHires: P0, otherHires: O0, months };
  }

  // A month's count of hires from other sources: expected value e, with extra
  // variance v beyond chance carried by a log-normal multiplier of mean 1,
  // then chance variation (Poisson).
  function otherCount(rand, normal, e, v) {
    if (!(e > 0)) return 0;
    let lambda = e;
    if (v > 0) {
      const s2 = Math.log(1 + v / (e * e));
      lambda = e * Math.exp(Math.sqrt(s2) * normal() - s2 / 2);
    }
    return U.poisson(rand, normal, lambda);
  }

  // A hire range for a set of cells: the application range (widened by w)
  // combined with the rate draws, then chance variation in the count of hires
  // (Poisson around each draw's expected hires; user decision, 17 September
  // 2026). Returns the 10th and 90th percentiles (and, as expectedLow and
  // expectedHigh, the same without chance variation), the rate uncertainty
  // and whether the row is low confidence (evidence: the applications behind
  // the row's cost per application; none for the total).
  function hireRange(base, cells, w, evidence = Infinity) {
    const D = base.draws, r = base.ranges;
    const hires = U.sum(cells.map(c => c.hires));
    if (!(hires > 0)) return null;
    const band = RAC.backtest.band(r.apps, w);
    const L = Math.log(1 + band.low), H = Math.log(1 + band.high);
    const mid = (L + H) / 2, half = (H - L) / 2 / Z90;
    const idx = cells.map(c => D.index[c.region + '|' + c.platform]);
    // Its own seed, so a row's range does not depend on which rows came before.
    const rand = U.rng(parseInt(U.fingerprint(base.role + '|hire counts|' + idx.join(',')), 16));
    const normal = U.normals(rand);
    const expected = new Float64Array(D.n), total = new Float64Array(D.n), logRate = new Float64Array(D.n);
    for (let d = 0; d < D.n; d++) {
      let h = 0;
      for (let j = 0; j < cells.length; j++) h += cells[j].hires * D.ratio[d * D.K + idx[j]];
      logRate[d] = Math.log(Math.max(h, 1e-12) / hires);
      expected[d] = h * Math.exp(mid + half * D.z[d]);
      total[d] = U.poisson(rand, normal, expected[d]);
    }
    const [plo, phi] = r.percentiles;
    const q = (xs, p) => U.percentileInc(Array.from(xs), p);
    const low = q(total, plo), high = q(total, phi);
    const m = logRate.reduce((a, x) => a + x, 0) / D.n;
    const rateSd = Math.sqrt(logRate.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, D.n - 1));
    const reasons = [];
    if (rateSd > r.lowConfidenceRateSd) reasons.push('few hires behind the hire rate');
    if (evidence < r.lowConfidenceMinApps) reasons.push('few applications behind the cost per application');
    return { low, high, lowPct: low / hires - 1, highPct: high / hires - 1, expectedLow: q(expected, plo), expectedHigh: q(expected, phi),
      rateSd, lowConfidence: reasons.length > 0, reasons, draws: total };
  }

  // Steps 1 and 3 to 5 for one budget. Ranges are left out during the budget
  // search (withRanges false), where only the totals are read.
  function allocate(base, p, withRanges = true) {
    const role = base.role;
    const days = p.daysInMonth || 30;
    // Indeed Premium: media at the daily rate, plus the Indeed fee.
    const premiumMedia = Math.round((p.premiumCampaigns || 0) * days * base.premiumRate);
    const premiumFee = Math.round(premiumMedia * base.factors.fees.indeed * 100) / 100;
    const premium = premiumMedia + premiumFee;
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

    // Step 3a: each location's share of the money. By open roles, blended with
    // how cheaply each location turns money into hires where the efficiency
    // setting is above 0. At 0 nothing changes: the split is by open roles.
    const efficiency = p.efficiency > 0 ? Math.min(1, p.efficiency) : 0;
    const share = {};
    locs.forEach(l => { share[l.region] = totalVac > 0 ? l.vacancies / totalVac : (locs.length ? 1 / locs.length : 0); });
    const efficiencyRows = [];
    if (efficiency > 0 && locs.length > 1 && demandPool > 0) {
      let sum = 0;
      const inv = {};
      locs.forEach(l => {
        // What a hire would cost here at its share by open roles.
        const at = demandPool * share[l.region];
        const sp = RAC.allocate.splitLocation(l.cells, at, {});
        const hires = U.sum(l.cells.map(c => RAC.forecast.at(c.pc, sp.spend[c.plat] || 0).hires));
        const cph = hires > 0 ? at / hires : Infinity;
        inv[l.region] = Number.isFinite(cph) && cph > 0 ? 1 / cph : 0;
        sum += inv[l.region];
        efficiencyRows.push({ region: l.region, openRoles: share[l.region], cphAtOpenRoles: Number.isFinite(cph) ? cph : null });
      });
      if (sum > 0) {
        efficiencyRows.forEach(r => {
          r.byEfficiency = inv[r.region] / sum;
          r.share = (1 - efficiency) * r.openRoles + efficiency * r.byEfficiency;
          share[r.region] = r.share;
        });
        steps.push({ step: 'between locations', amount: 0,
          reason: `efficiency setting ${Math.round(efficiency * 100)}%: the split moved that far from open roles towards where hires cost least` });
      }
    }

    locs.forEach(l => {
      const ceilingSum = U.sum(l.on.map(plat => base.cells[l.region][plat].ceiling.ceiling));
      l.capacity = U.sum(l.cells.map(c => c.cap));
      l.cphLimit = cphLimits[l.region] > 0 ? cphLimits[l.region] : null;
      l.cphCap = RAC.allocate.spendAtCphLimit(l.cells, l.capacity, l.cphLimit);
      const maxCap = regionMax[l.region] === NO_SPEND ? 0 : (regionMax[l.region] > 0 ? regionMax[l.region] : Infinity);
      l.locationCap = base.locationCaps[l.region];
      const locCap = base.softCaps || !l.locationCap.on ? Infinity : l.locationCap.cap;
      const options = [
        [maxCap, regionMax[l.region] === NO_SPEND ? 'location set to no spend' : 'location maximum'],
        [locCap, 'location spending cap (largest month x multiple)'],
        [base.softCaps ? Infinity : l.capacity, l.capacity < ceilingSum - 0.005 ? 'spending caps and cost per application limits' : 'spending caps (largest successful month x multiple)'],
        [l.cphCap, 'cost per hire limit'],
      ];
      const [cap, reason] = options.reduce((a, b) => (b[0] < a[0] ? b : a));
      l.cap = cap; l.capReason = reason;
      l.floorAsked = regionMin[l.region] > 0 ? regionMin[l.region] : 0;
      l.floor = l.floorAsked;
      if (l.floor > maxCap) {
        // Two instructions disagree. The minimum is applied, as before, and said.
        steps.push({ step: 'between locations', region: l.region, amount: 0, reason: `location minimum £${Math.round(l.floor)} is above its maximum; the minimum was applied` });
      }
      // A minimum never takes a location above its spending caps or cost
      // limits (user decision, 17 September 2026). The shortfall is reported.
      const room = base.softCaps ? Infinity : Math.min(l.capacity, l.cphCap, locCap);
      if (l.floor > room + 0.005) {
        l.floor = room;
        steps.push({ step: 'between locations', region: l.region, amount: 0,
          reason: `location minimum £${Math.round(l.floorAsked)} is above what its spending caps${l.cphCap < Math.min(l.capacity, locCap) ? ' and cost per hire limit' : ''} allow (£${Math.round(room)}); the caps held` });
      }
      l.base = (locs.length ? coverageReserve / locs.length : 0) + demandPool * share[l.region];
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
    const aboveByInstruction = {};   // comparison with the previous version only
    const shortfalls = [];           // minimums the caps did not allow
    locs.forEach(l => {
      const floors = {};
      l.cells.forEach(c => {
        const f = (comboMin[l.region] || {})[c.plat];
        if (!(f > 0)) return;
        // Floors set on Setup stop at the platform's spending cap too.
        floors[c.plat] = base.softCaps ? f : Math.min(f, c.cap);
        if (f > floors[c.plat] + 0.005) shortfalls.push({ kind: 'floor', region: l.region, platform: c.plat, asked: f, allowed: floors[c.plat] });
      });
      l.fixed = {};
      let s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
      for (let i = 0; i < 5; i++) {
        const low = Object.keys(floors).filter(plat => (s.spend[plat] || 0) < floors[plat] - 0.005 && l.fixed[plat] === undefined);
        if (!low.length) break;
        low.forEach(plat => { l.fixed[plat] = floors[plat]; steps.push({ step: 'within location', region: l.region, platform: plat, amount: floors[plat] - (s.spend[plat] || 0), reason: 'floor set for this plan' }); });
        s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
      }
      l.split = s.spend;
      if (s.shortfall > 0.005) {
        // Floors asked for more than the location has: keep their proportions.
        const k = l.spend / (l.spend + s.shortfall);
        Object.keys(l.split).forEach(plat => { l.split[plat] *= k; });
        Object.keys(l.fixed).forEach(plat => { l.fixed[plat] = l.split[plat]; });
        l.floorShortfall = s.shortfall;
      }
      if (s.leftover > 0.005 && base.softCaps) {
        // Comparison with the previous version: spread above the biggest month.
        const capSum = U.sum(l.cells.map(c => c.cap)) || l.cells.length;
        l.cells.forEach(c => {
          const add = s.leftover * ((U.sum(l.cells.map(x => x.cap)) ? c.cap : 1) / capSum);
          l.split[c.plat] += add;
          aboveByInstruction[l.region + '|' + c.plat] = add;
        });
        steps.push({ step: 'within location', region: l.region, amount: s.leftover, reason: 'comparison with the previous version: spread above the biggest month' });
      } else if (s.leftover > 0.005) {
        // Floors fixed below what the location was given: what does not fit
        // under the other platforms' caps is not placed.
        unplaced += s.leftover; unplacedReasons['spending caps (largest successful month x multiple)'] = true;
        l.spend -= s.leftover;
        steps.push({ step: 'within location', region: l.region, amount: -s.leftover, reason: 'no platform here had room under its spending cap' });
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
        const cellCap = base.softCaps ? Infinity : l.cells.find(c => c.plat === plat).cap;
        l.fixed[plat] = target < total ? cur * (target / total) : Math.min(cellCap, cur + (target - total) * share);
        if (target < total) l.trimmedBy = (l.trimmedBy || 0) + (cur - l.fixed[plat]);
        const s = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
        l.split = s.spend;
        if (s.leftover > 0.005 && base.softCaps) {
          // Comparison with the previous version: spread above the caps.
          const free = l.cells.filter(c => l.fixed[c.plat] === undefined);
          const capSum = U.sum(free.map(c => c.cap)) || free.length;
          free.forEach(c => { l.split[c.plat] += s.leftover * ((U.sum(free.map(x => x.cap)) ? c.cap : 1) / capSum); });
        } else if (s.leftover > 0.005) {
          // The location's other platforms took what they could up to their
          // caps; the rest is not placed, even where that leaves a location
          // below its minimum (reported below).
          unplaced += s.leftover; unplacedReasons['platform maximum'] = true;
          l.spend -= s.leftover;
          steps.push({ step: 'platform limits', region: l.region, platform: plat, amount: -s.leftover, reason: 'platform maximum: no other platform here had room' });
        }
        if (s.shortfall > 0.005) {
          // The location has less than its fixed spends: this platform gives
          // way first, then every fixed spend in proportion.
          l.fixed[plat] = Math.max(0, l.fixed[plat] - s.shortfall);
          const s2 = RAC.allocate.splitLocation(l.cells, l.spend, l.fixed);
          l.split = s2.spend;
          if (s2.shortfall > 0.005) {
            const k = l.spend / (l.spend + s2.shortfall);
            Object.keys(l.split).forEach(q => { l.split[q] *= k; });
            Object.keys(l.fixed).forEach(q => { l.fixed[q] = l.split[q]; });
          }
        }
      });
      steps.push({ step: 'platform limits', platform: plat, amount: target - total, reason: target < total ? 'platform maximum' : 'platform minimum' });
    }

    // Minimums the caps did not allow (user decision, 17 September 2026).
    P().forEach(plat => {
      const lo = platMin[plat] > 0 ? platMin[plat] : 0;
      const got = U.sum(locs.map(l => l.split[plat] || 0));
      if (lo > got + 0.5) shortfalls.push({ kind: 'platform', platform: plat, asked: lo, placed: got, short: lo - got, because: 'spending caps' });
    });
    locs.forEach(l => {
      const placed = U.sum(Object.values(l.split));
      if (!(l.floorAsked > 0 && l.floorAsked > placed + 0.5)) return;
      const because = l.floorAsked > l.floor + 0.005 ? (l.cphCap < l.capacity ? 'spending caps and the cost per hire limit' : 'spending caps')
        : l.trimmedBy > 0.005 ? 'spending caps, after the platform maximum' : 'the budget available';
      shortfalls.push({ kind: 'location', region: l.region, asked: l.floorAsked, placed, short: l.floorAsked - placed, because });
    });
    shortfalls.forEach(s => {
      if (s.kind === 'floor') {
        s.placed = (locs.find(l => l.region === s.region).split[s.platform]) || 0;
        s.short = s.asked - s.placed;
        s.because = 'spending caps';
      }
      const what = s.kind === 'location' ? `${s.region} minimum` : s.kind === 'platform' ? `${RAC.PLATFORM_LABELS[s.platform]} minimum`
        : `${s.region} ${RAC.PLATFORM_LABELS[s.platform]} floor`;
      s.text = `${what} £${Math.round(s.asked).toLocaleString('en-GB')}, placed £${Math.round(s.placed).toLocaleString('en-GB')}, short by £${Math.round(s.short).toLocaleString('en-GB')} because of ${s.because}`;
    });

    // Step 5: forecast.
    const r = base.ranges;
    const rows = [];
    locs.forEach(l => {
      l.cellResults = {};
      P().forEach(plat => {
        const c = base.cells[l.region][plat];
        const S = l.split[plat] || 0;
        const f = RAC.forecast.at(c.pc, S);
        l.cellResults[plat] = cellResult(base, c, S, f, l.on.includes(plat), aboveByInstruction[l.region + '|' + plat] || 0, withRanges);
        rows.push(l.cellResults[plat]);
      });
    });

    const locations = locs.map(l => {
      const cs = P().map(plat => l.cellResults[plat]);
      const out = rollUp(base, cs, { region: l.region, vacancies: l.vacancies });
      return { ...out, cells: l.cellResults, cap: l.cap, capReason: l.capReason, cphLimit: l.cphLimit, locationCap: l.locationCap,
        capacity: l.capacity, base: l.base, floor: l.floor, floorShortfall: l.floorShortfall || 0, fixed: l.fixed };
    });
    if (withRanges) locations.forEach(loc => { loc.range = rowRanges(base, loc.cellsList); });
    const platforms = {};
    P().forEach(plat => {
      const cs = locations.map(l => l.cells[plat]);
      platforms[plat] = rollUp(base, cs, { platform: plat });
      if (withRanges) platforms[plat].range = rowRanges(base, cs);
    });
    const all = locations.flatMap(l => l.cellsList);
    const totals = rollUp(base, all, {});
    const bl = base.baseline;
    totals.paidHires = totals.hires;
    totals.otherHires = bl.hires;
    totals.allHires = totals.hires + bl.hires;
    if (withRanges) {
      const paid = hireRange(base, all.filter(c => c.spend > 0), 1);
      const D = base.draws, [plo, phi] = r.percentiles;
      const other = Array.from(D.other);
      const both = paid ? Array.from(paid.draws, (h, d) => h + D.other[d]) : other;
      totals.range = {
        apps: { low: totals.apps * (1 + r.apps.low), high: totals.apps * (1 + r.apps.high), lowPct: r.apps.low, highPct: r.apps.high },
        hires: paid ? stripDraws(paid) : { low: 0, high: 0, lowPct: 0, highPct: 0, rateSd: 0, lowConfidence: false, reasons: [] },
        otherHires: { low: U.percentileInc(other, plo), high: U.percentileInc(other, phi) },
        allHires: { low: U.percentileInc(both, plo), high: U.percentileInc(both, phi) },
      };
    }
    // Locations not in the plan, at no spend, for tables that list every location.
    const liveSet = new Set(locations.map(l => l.region));
    const idleCells = {};
    base.ds.regions.filter(region => !liveSet.has(region)).forEach(region => {
      idleCells[region] = {};
      P().forEach(plat => {
        const c = base.cells[region][plat];
        idleCells[region][plat] = cellResult(base, c, 0, RAC.forecast.at(c.pc, 0), false, 0, false);
      });
    });
    const aboveLargestSuccessful = U.sum(all.map(c => c.aboveLargestSuccessful));
    const aboveLargestMonth = U.sum(all.map(c => c.aboveLargestMonth));
    const placed = U.sum(locations.map(l => l.spend));

    return {
      role, budget, daysInMonth: days,
      holdbacks: { premium, premiumMedia, premiumFee, combined, oneRac, total: premium + combined + oneRac },
      fees: {
        ...base.feeInfo,
        premium: premiumFee,
        byPlatform: Object.fromEntries(P().map(pl => [pl, { media: platforms[pl].media, fee: platforms[pl].fee, total: platforms[pl].spend }])),
        placed: U.sum(all.map(c => c.fee)),
        total: premiumFee + U.sum(all.map(c => c.fee)),
      },
      otherSources: { ...bl },
      deployable, coverageReserve, demandPool, totalVac, liveCount: locations.length,
      locations, platforms, totals, idleCells, allRegions: base.ds.regions.slice(),
      placed,
      unplaced: { total: unplaced, reasons: Object.keys(unplacedReasons) },
      minimumShortfalls: shortfalls,
      aboveLargestSuccessful: { total: aboveLargestSuccessful, share: placed > 0 ? aboveLargestSuccessful / placed : 0 },
      aboveLargestMonth: { total: aboveLargestMonth, share: placed > 0 ? aboveLargestMonth / placed : 0 },
      platMin, platMax, regionMin, regionMax,
      efficiency: { weight: efficiency, byLocation: efficiencyRows },
      steps,
    };
  }

  function cellResult(base, c, S, f, on, aboveByInstruction, withRanges) {
    const pc = c.pc;
    const r = base.ranges;
    const u = pc.usual;
    const ws = RAC.cost.windowStats(base.ctx, pc.plat, pc.region);
    const w = RAC.backtest.widen(r.apps, r.widen, RAC.backtest.widenEvidence(base.ctx, u.apps), f.media, pc.spendUsual, base.d1[pc.plat].seUsed);
    const apps = RAC.backtest.band(r.apps, w);
    return {
      region: pc.region, platform: pc.plat, on, spend: S,
      // Platform fee: spend = media + fee.
      media: f.media, fee: f.fee, feeRate: pc.fee,
      apps: f.apps, passed: f.passed, hires: f.hires,
      cpa: f.apps > 0 ? f.cpa : null,
      cph: f.hires > 0 ? S / f.hires : null,
      // Cost per application build-up.
      historicCpa: u.rawCpa, historicApps: u.apps, historicSpend: u.spend,
      applyRate: ws.clicks > 0 ? ws.apps / ws.clicks : null,
      platformCpa: u.platform.cpa, thinAdjustment: u.thinAdjustment, usualCpa: u.cpa, cpaSource: u.source,
      spendUsual: pc.spendUsual, spendBasis: pc.spendBasis, diminishingRate: pc.b,
      spendAdjustment: f.spendAdjustment, remainingError: pc.bias, plannedCpaMedia: f.cpaMedia, plannedCpa: f.cpa,
      // Screening and hires build-up.
      screenRate: pc.screen, platformScreen: pc.rates.platformScreen, screenBasis: pc.rates.platformBasis,
      screenAdjustment: pc.rates.screenAdjustment, hireAfterScreening: pc.hireAfterScreening,
      reconciliation: pc.recon, hirePerApplication: pc.hirePerApplication,
      // Of the hires: reconciled to what Eploy credited to the platforms, and
      // the share of other-source hires credited to paid media.
      hiresPlatform: pc.recon > 0 ? f.hires * base.factors.paid / pc.recon : 0,
      hiresCredited: pc.recon > 0 ? f.hires * (base.factors.share * base.factors.credit) / pc.recon : 0,
      // Spending cap: past media spend x multiple (ceiling), and the same
      // with the fee added (ceilingTotal, what planned spend is held to).
      ceiling: c.ceiling.ceiling, ceilingTotal: c.ceiling.ceiling * (1 + pc.fee), ceilingBase: c.ceiling.base, ceilingBasis: c.ceiling.basis, ceilingFlagged: c.ceiling.flagged, ceilingRowLimited: !!c.ceiling.rowLimited, ceilingRowLimit: c.ceiling.rowLimit === undefined ? null : c.ceiling.rowLimit,
      largestSuccessful: c.ceiling.largestSuccessful, largestMonth: c.ceiling.largestMonth, ceilingMonths: c.ceiling.months, capBenchmark: c.ceiling.benchmark,
      cpaLimit: c.cpaLimit, cpaLimitSpend: Number.isFinite(c.cpaCap) ? c.cpaCap : null, cap: c.cap,
      aboveLimitByInstruction: aboveByInstruction,
      aboveLargestSuccessful: Math.max(0, f.media - c.ceiling.base),
      aboveLargestMonth: Math.max(0, f.media - c.ceiling.largestMonth),
      // Range.
      widen: w,
      range: S > 0 && withRanges ? {
        apps: { low: f.apps * (1 + apps.low), high: f.apps * (1 + apps.high), lowPct: apps.low, highPct: apps.high },
        hires: stripDraws(hireRange(base, [{ region: pc.region, platform: pc.plat, hires: f.hires }], w, u.apps)),
      } : null,
    };
  }

  const Z90 = 1.2815515655446004;   // standard normal 90th percentile
  function stripDraws(x) {
    if (!x) return null;
    const { draws, ...rest } = x;
    return rest;
  }

  function rollUp(base, cells, extra) {
    const spend = U.sum(cells.map(c => c.spend));
    const media = U.sum(cells.map(c => c.media));
    const fee = U.sum(cells.map(c => c.fee));
    const apps = U.sum(cells.map(c => c.apps));
    const passed = U.sum(cells.map(c => c.passed));
    const hires = U.sum(cells.map(c => c.hires));
    return {
      ...extra, spend, media, fee, apps, passed, hires,
      cpa: apps > 0 ? spend / apps : null,
      cph: hires > 0 ? spend / hires : null,
      screenRate: apps > 0 ? passed / apps : null,
      hirePerApplication: apps > 0 ? hires / apps : null,
      cellsList: cells,
    };
  }

  // A row's range: widened for the evidence behind all its cells together.
  function rowRanges(base, cells) {
    const r = base.ranges;
    const funded = cells.filter(c => c.spend > 0);
    const spend = U.sum(funded.map(c => c.spend));
    if (!(spend > 0)) return null;
    const apps = U.sum(funded.map(c => c.apps));
    const evidence = U.sum(funded.map(c => c.historicApps || 0));
    const usual = U.sum(funded.map(c => c.spendUsual || 0));
    const se = U.sum(funded.map(c => c.spend * (base.d1[c.platform].seUsed || 0))) / spend;
    const media = U.sum(funded.map(c => c.media));
    const w = RAC.backtest.widen(r.apps, r.widen, U.sum(funded.map(c => RAC.backtest.widenEvidence(base.ctx, c.historicApps))), media, usual, se);
    const a = RAC.backtest.band(r.apps, w);
    return {
      widen: w,
      apps: { low: apps * (1 + a.low), high: apps * (1 + a.high), lowPct: a.low, highPct: a.high },
      hires: stripDraws(hireRange(base, funded, w, evidence)),
    };
  }

  // Step 6: budget for the hire target. Expected hires from other sources
  // count towards the target, so paid media solves for the remainder.
  function budgetForTarget(base, p, plan) {
    const target = p.hireTarget > 0 ? p.hireTarget : 0;
    const appTarget = p.appTarget > 0 ? p.appTarget : 0;
    const solveOnHires = target > 0;
    const other = base.baseline.hires;
    const goal = solveOnHires ? target - other : appTarget;
    const out = { goal: solveOnHires ? target : appTarget, paidGoal: solveOnHires ? Math.max(0, goal) : null, solveOnHires,
      budgetForTarget: 0, pinned: false, unreachable: false, maxAchievable: null, saturationBudget: null, otherSourcesMeetTarget: false };
    if (!((solveOnHires ? target : appTarget) > 0)) return out;
    const holdbacks = plan.holdbacks.total;
    if (solveOnHires && goal <= 0) {
      // Other sources alone are expected to reach the target.
      out.otherSourcesMeetTarget = true;
      out.budgetForTarget = Math.ceil(holdbacks / 50) * 50;
      return out;
    }
    const minTotal = U.sum(plan.locations.map(l => l.floor || 0));
    if (plan.locations.length && minTotal >= plan.deployable - 1) {
      out.pinned = true;
      out.budgetForTarget = Math.ceil((minTotal + holdbacks) / 50) * 50;
      return out;
    }
    const trial = (b) => allocate(base, { ...p, budget: b }, false);
    const at = (b) => { const q = trial(b); return solveOnHires ? q.totals.hires : q.totals.apps; };
    let lo = holdbacks, hi = lo + 500000;
    for (let i = 0; i < 8 && at(hi) < goal; i++) hi *= 1.6;
    const most = at(hi);
    if (most < goal) {
      // Within the caps, spend above what every location can take adds
      // nothing: that budget is where hires stop rising.
      out.unreachable = true;
      out.maxAchievable = solveOnHires ? most + other : most;
      out.saturationBudget = Math.ceil((holdbacks + trial(hi).placed) / 50) * 50;
      return out;
    }
    for (let i = 0; i < 60 && hi - lo > 2; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < goal) lo = mid; else hi = mid;
    }
    // The search stops within £2, so the £50 step below can already be enough.
    let answer = Math.ceil(hi / 50) * 50;
    if (answer - 50 >= holdbacks && at(answer - 50) >= goal) answer -= 50;
    out.budgetForTarget = answer;
    return out;
  }

  // Every monthly figure the role's calculations read, carried in the plan so
  // the workings export renders from the plan alone (B3, data sources and
  // blend inputs sheets).
  function rawMonthly(base) {
    const ctx = base.ctx;
    const rows = [];
    ctx.ds.regions.forEach(region => P().forEach(plat => {
      const m = RAC.data.monthly(ctx.ds, plat, region, base.role);
      Object.keys(m).sort().forEach(mo => {
        rows.push({ platform: plat, region, month: mo, spend: m[mo].spend, apps: m[mo].apps, clicks: m[mo].clicks });
      });
    }));
    return { months: ctx.ds.months.slice(), weights: { ...ctx.weights }, monthCount: ctx.monthCount, rows };
  }

  // The window figures behind every cost per application, kept in the plan so
  // the workings export can show each one as a formula over the monthly rows.
  function blendRecord(base) {
    const ctx = base.ctx;
    const window = {};
    P().forEach(plat => {
      window[plat] = {};
      ctx.ds.regions.forEach(region => {
        const s = RAC.cost.windowStats(ctx, plat, region);
        const w = s.weighted;
        window[plat][region] = {
          wspend: w.spend, wapps: w.apps, wclicks: w.clicks, wsum: w.wsum,
          spend: s.spend, apps: s.apps, rawCpa: s.rawCpa,
          ranSpend: w.ranSpend, ranWeight: w.ranWeight, avgSpend: s.avgSpend,
        };
      });
    });
    const platform = {};
    const typical = {};
    P().forEach(plat => {
      const x = RAC.cost.platformCpa(ctx, plat);
      platform[plat] = { apps: x.apps, spend: x.spend || 0, rawCpa: x.rawCpa, cpa: x.cpa, source: x.source };
      typical[plat] = RAC.cost.typicalMonth(ctx, plat);
    });
    return { window, platform, typical };
  }

  function build(role, inputs, env) {
    if (!env || !env.A || !env.A.ok) throw new Error('The assumptions file has not loaded or is invalid, so the planner cannot run.');
    if (!env.eploy) throw new Error('The Eploy rates file has not loaded, so the planner cannot run.');
    const key = role + '|' + U.stableKey(inputs) + '|' + envStamp(env);
    const hit = RAC.cache.get(key);
    if (hit) return hit;
    const baseKey = 'base|' + role + '|' + U.stableKey({ bench: inputs.bench, capMultiple: inputs.capMultiple, otherHiresShare: inputs.otherHiresShare,
      otherHiresMonthly: inputs.otherHiresMonthly, remainingError: inputs.remainingError, includeSettling: !!inputs.includeSettling, planMonth: inputs.planMonth || null,
      roleMixAdjustment: inputs.roleMixAdjustment, selfCompetition: inputs.selfCompetition,
      cpa: inputs.limits && inputs.limits.cpa, overrides: inputs.overrides, compare: inputs.compare }) + '|' + envStamp(env);
    let base = RAC.cache.get(baseKey);
    if (!base) base = RAC.cache.set(baseKey, prepare(role, inputs, env));
    const plan = allocate(base, inputs);
    const target = budgetForTarget(base, inputs, plan);
    const A = base.A;
    const status = base.ctx.status;
    // Out of reach: the same plan at each cap multiple, for the screen and the PDF.
    let reach = null;
    if (target.unreachable && !inputs.noReach) {
      reach = {
        mostHires: target.maxAchievable, saturationBudget: target.saturationBudget, unplaced: plan.unplaced.total,
        byMultiple: [1, 2, 3].map(m => {
          const q = m === base.capMultiple ? { ...plan, ...target } : build(role, { ...inputs, capMultiple: m, noReach: true }, env);
          return {
            multiple: m, current: m === base.capMultiple,
            hiresAtBudget: q.totals.allHires, unplacedAtBudget: q.unplaced.total,
            budgetForTarget: q.unreachable ? null : q.budgetForTarget,
            mostHires: q.unreachable ? q.maxAchievable : null,
            saturationBudget: q.unreachable ? q.saturationBudget : null,
          };
        }),
      };
    }
    const settlingUsed = base.ctx.settlingUsed.map(mo => ({ month: mo, note: 'not yet settled, figures may change', reason: status[mo].reason }));
    const result = {
      ...plan,
      ...target,
      reach,
      settings: base.settings,
      A,   // the assumption values used, overrides included (text, exports, snapshots)
      settlingUsed,
      includeSettling: !!inputs.includeSettling,
      hireTarget: inputs.hireTarget || 0,
      appTarget: inputs.appTarget || 0,
      capMultiple: base.capMultiple,
      window: base.ctx.window,
      windowMonths: base.ctx.windowMonths,
      weights: base.ctx.weights,
      // Months the spending caps looked at (C3): settled months from ceiling_first_month.
      capMonths: base.ctx.settled.filter(mo => mo >= RAC.assumptions.get(A, 'ceiling_first_month')),
      // Months behind the caps' fixed benchmark: the same settled 2026 months.
      capBenchmarkMonths: base.ctx.settled.filter(mo => mo >= RAC.assumptions.get(A, 'ceiling_first_month')),
      factors: base.factors,
      otherHiresShare: base.factors.share,
      otherHiresMonthly: base.baseline.monthly,
      remainingError: base.factors.biasSet,
      costAdjustment: { used: base.factors.bias, remainingError: base.factors.biasSet, roleMix: base.factors.roleMix, selfCompetition: base.factors.selfCompetition },
      combinedActivityIncludesDisplay: RAC.assumptions.get(A, 'combined_activity_includes_display') === 1,
      hireRangeBasis: { draws: base.draws.n, paidHires: base.draws.paidHires, otherHires: base.draws.otherHires, months: base.draws.months },
      diminishingReturns: base.d1,
      rates: base.hireRates,
      ranges: base.ranges,
      months: status,
      raw: rawMonthly(base),
      blend: blendRecord(base),
      stamps: {
        assumptions: { date: A.date, fingerprint: A.fingerprint, overrides: inputs.overrides || {} },
        data: { stamp: env.ds.stamp, settledTo: base.ctx.settled[base.ctx.settled.length - 1] || null, settlingUsed: base.ctx.settlingUsed.slice(),
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
