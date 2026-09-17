// RAC planner: the forecast. One function turns spend in a location and
// platform into applications, applications that pass screening, and hires.
// The plan, the testing, the screens and both exports all use it.
//
// Planned cost per application at a monthly spend S (D1 and D2):
//   usual cost per application x (S / usual spend) ^ (1 - b) x remaining-error adjustment
// where b is the platform's diminishing returns rate for the role:
//   b = (n x fitted rate + k x shared role rate) / (n + k)
//   fitted rate: how applications rose with spend within each location,
//     from settled months (log applications against log spend, each
//     location's own average taken out, so differences between locations do
//     not count as a spend effect)
//   n: location-months behind the fit; k: d1_prior_strength
//   shared role rate: d1_role_rate
// A rate of 1 means no diminishing returns. Rates are held at 1 or below: above
// 1 each extra pound would buy applications more cheaply than the last, which
// the split between platforms cannot use.
//
// Applications = S / planned cost per application
// Hires = applications x screening pass rate used x hire rate after screening
//         x reconciliation factor
// The reconciliation factor is set by the plan (planner/plan.js):
//   paid_hire_reconciliation_factor
//   + share credited to paid media x other_hires_credit_factor
// It is the same for every location and platform, so it moves total hires and
// the budget but not the split between platforms.
//
// Platform fees (user decision, 17 September 2026). For platforms with a fee
// (Indeed, Meta), planned spend S includes the fee: media = S / (1 + fee
// rate). Historic spend is media only, so the usual cost per application and
// the spend-level adjustment work on media, and applications = media /
// planned media cost per application. Cost per application and per hire are
// reported on S, the total cost including the fee. With no fee, S is media.
(function (RAC) {
  'use strict';

  // Within-location fit of log applications on log spend for one platform.
  function fitRate(ds, A, role, plat, months) {
    const min = RAC.assumptions.get(A, 'typical_month_min_spend');
    const set = new Set(months);
    let sxy = 0, sxx = 0, n = 0, cells = 0;
    const centred = [];
    ds.regions.forEach(r => {
      const m = RAC.data.monthly(ds, plat, r, role);
      const pts = Object.keys(m).filter(mo => set.has(mo) && m[mo].spend > min && m[mo].apps > 0)
        .map(mo => [Math.log(m[mo].spend), Math.log(m[mo].apps)]);
      if (pts.length < 3) return;
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      pts.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; centred.push([x - mx, y - my]); });
      n += pts.length; cells += 1;
    });
    if (!(sxx > 0)) return { fitted: null, n: 0, cells, se: null };
    const fitted = sxy / sxx;
    // Standard error of the fitted rate (one slope, one mean per location).
    const rss = centred.reduce((a, [x, y]) => a + (y - fitted * x) ** 2, 0);
    const dof = Math.max(1, n - cells - 1);
    return { fitted, n, cells, se: Math.sqrt(rss / dof / sxx) };
  }

  // Diminishing returns rates for every platform in a role.
  //   months: the settled months the fit may use
  //   opts.roleRate, opts.k override the assumptions (for testing)
  function rates(ds, A, role, months, opts = {}) {
    const bRole = opts.roleRate !== undefined ? opts.roleRate : RAC.assumptions.get(A, 'd1_role_rate', role);
    const k = opts.k !== undefined ? opts.k : RAC.assumptions.get(A, 'd1_prior_strength', role);
    const out = {};
    RAC.PLATFORMS.forEach(p => {
      const f = opts.fits ? opts.fits[p] : fitRate(ds, A, role, p, months);
      // A strength of 100000 or more means every platform takes the shared rate.
      const shared = f.fitted === null || k >= 100000;
      const blended = shared ? bRole : (f.n * f.fitted + k * bRole) / (f.n + k);
      // Uncertainty in the rate used: only the fitted share of it is measured.
      const se = f.se && !shared ? f.se * f.n / (f.n + k) : 0;
      out[p] = { ...f, roleRate: bRole, k, blended, b: Math.min(1, blended), heldAtOne: blended > 1, seUsed: se };
    });
    return out;
  }

  // Everything the forecast needs for one location and platform.
  //   ctx: RAC.cost.context; hireRates: RAC.rates.build; d1: rates() above
  //   factors: { bias, recon } (remaining-error adjustment, reconciliation)
  //   factors.fees: { platform: rate } (none: no fees)
  function prepare(ctx, hireRates, d1, factors, plat, region) {
    const usual = RAC.cost.usualCpa(ctx, plat, region);
    const level = RAC.cost.usualSpend(ctx, plat, region);
    // Without hire rates (testing applications only) the hire side is zero.
    const r = hireRates ? RAC.rates.cell(hireRates, plat, region)
      : { screen: 0, hireAfterScreening: 0, hirePerApplication: 0 };
    // With no spend level to anchor on (the platform never ran anywhere in the
    // window), cost per application is taken as flat.
    const b = level.spend > 0 ? d1[plat].b : 1;
    return {
      plat, region,
      cpaUsual: usual.cpa, usual,
      spendUsual: level.spend, spendBasis: level.basis,
      b, bias: factors.bias, recon: factors.recon,
      fee: (factors.fees && factors.fees[plat]) || 0,
      screen: r.screen, hireAfterScreening: r.hireAfterScreening, rates: r,
      hirePerApplication: r.hirePerApplication * factors.recon,
    };
  }

  // Spend-level adjustment to cost per application at media spend m.
  function spendAdjustment(pc, m) {
    if (!(m > 0) || !(pc.spendUsual > 0)) return 1;
    return Math.pow(m / pc.spendUsual, 1 - pc.b);
  }

  // Planned cost per application on media alone, at media spend m (what the
  // model expected in a past month, where spend was media only).
  function mediaCpa(pc, m) {
    return pc.cpaUsual * spendAdjustment(pc, m) * pc.bias;
  }

  // Media and fee in a planned spend S.
  function split(pc, S) {
    const media = S > 0 ? S / (1 + (pc.fee || 0)) : 0;
    return { media, fee: S > 0 ? S - media : 0 };
  }

  // The forecast for one location and platform at monthly spend S (including
  // any fee).
  function at(pc, S) {
    const fee = pc.fee || 0;
    if (!(S > 0) || !(pc.cpaUsual > 0)) {
      return { spend: 0, media: 0, fee: 0, apps: 0, passed: 0, hires: 0, cpa: pc.cpaUsual * pc.bias * (1 + fee), cpaMedia: pc.cpaUsual * pc.bias, spendAdjustment: 1 };
    }
    const m = split(pc, S);
    const adj = spendAdjustment(pc, m.media);
    const cpaMedia = pc.cpaUsual * adj * pc.bias;
    const apps = m.media / cpaMedia;
    const passed = apps * pc.screen;
    const hires = passed * pc.hireAfterScreening * pc.recon;
    return { spend: S, media: m.media, fee: m.fee, apps, passed, hires, cpa: S / apps, cpaMedia, spendAdjustment: adj };
  }

  // Cost of the next hire at spend S (the split equalises this).
  function marginalCostPerHire(pc, S) {
    const x = Math.max(S, 1);
    const f = at(pc, x);
    if (!(f.hires > 0)) return Infinity;
    return x / (pc.b * f.hires);
  }

  // Spend (including any fee) at which the next hire costs lambda.
  function spendForMarginal(pc, lambda) {
    const h1 = pc.hirePerApplication;
    if (!(h1 > 0) || !(pc.cpaUsual > 0)) return 0;
    // hires = c x m^b on media m, with c = h1 x spendUsual^(1-b) / (cpaUsual x bias)
    const su = pc.spendUsual > 0 ? pc.spendUsual : 1;
    const c = h1 * Math.pow(su, 1 - pc.b) / (pc.cpaUsual * pc.bias);
    const g = 1 + (pc.fee || 0);   // S = g x m
    if (pc.b >= 1) return lambda * c / g >= 1 ? Infinity : 0;
    // marginal cost = g x m^(1-b) / (b c)  =>  m = (lambda b c / g)^(1/(1-b))
    return g * Math.pow(lambda * pc.b * c / g, 1 / (1 - pc.b));
  }

  RAC.forecast = { fitRate, rates, prepare, spendAdjustment, mediaCpa, split, at, marginalCostPerHire, spendForMarginal };
})(window.RAC = window.RAC || {});
