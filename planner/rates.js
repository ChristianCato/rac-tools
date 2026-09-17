// RAC planner: screening pass rates and hire rates (addendum 2.2).
//
// From RAC's applicant tracking data (Eploy), aggregated in
// data/eploy_rates.json by tools/eploy_import.py. For a location l, platform p
// and role:
//
//   screening pass rate used = platform rate x location screening adjustment
//     platform rate, Indeed and Appcast:
//       (passed + N x role average) / (applications + N), N = screen_blend_n
//     platform rate, Meta and Google:
//       own rate moved meta_google_pull of the way to the role average
//     location screening adjustment:
//       location rate / role average, blended with 1 (no adjustment) by
//       location_screen_blend_n applications
//   hire rate after screening = regional hires / regional passed screening,
//     blended with the role figure by region_hire_blend_n
//   hires = applications x screening pass rate used x hire rate after screening
//
// The role average covers every source, including Other. Only months whose
// outcomes have settled count (screening_maturity_months,
// hire_maturity_months), measured from the dataset's file date. The
// platform's own hire rate after screening is not used: it rested on 2 to 63
// hires.
(function (RAC) {
  'use strict';
  const U = RAC.util;
  const PULLED = ['meta', 'google'];

  // Months whose outcomes count: n further months must have started by the
  // dataset's file date.
  function maturedMonths(eploy, n) {
    const asOfMonth = eploy.dataset.file_date.slice(0, 7);
    const months = [...new Set(eploy.cells.map(c => c[3]))].sort();
    return months.filter(mo => mo >= eploy.eploy_first_month && U.addMonths(mo, n) <= asOfMonth);
  }

  // Adds up cells for one role over some months, by a key function.
  function tally(eploy, role, months, keyFn) {
    const set = new Set(months);
    const out = {};
    eploy.cells.forEach(([r, region, plat, mo, a, p, h]) => {
      if (r !== role || !set.has(mo)) return;
      const k = keyFn(region, plat, mo);
      if (k === null) return;
      const t = out[k] = out[k] || { apps: 0, passed: 0, hires: 0 };
      t.apps += a; t.passed += p; t.hires += h;
    });
    return out;
  }

  // Blend strengths and months can be passed in (for testing); otherwise they
  // come from the assumptions file.
  function build(eploy, A, role, opts = {}) {
    const get = (k) => (opts[k] !== undefined ? opts[k] : RAC.assumptions.get(A, k, role));
    const screenMonths = opts.screenMonths || maturedMonths(eploy, get('screening_maturity_months'));
    const hireMonths = (opts.hireMonths || maturedMonths(eploy, get('hire_maturity_months')))
      .filter(mo => screenMonths.includes(mo));   // hires after screening need both settled
    const blend = { N: get('screen_blend_n'), pull: get('meta_google_pull'), M: get('location_screen_blend_n'), R: get('region_hire_blend_n') };
    const regions = opts.regions || [...new Set(eploy.cells.map(c => c[1]))].filter(r => r !== 'Unknown').sort();
    const counts = {
      all: tally(eploy, role, screenMonths, () => 'all').all || { apps: 0, passed: 0, hires: 0 },
      byPlat: tally(eploy, role, screenMonths, (region, plat) => plat),
      byLoc: tally(eploy, role, screenMonths, (region) => region === 'Unknown' ? null : region),
      hireAll: tally(eploy, role, hireMonths, () => 'all').all || { apps: 0, passed: 0, hires: 0 },
      byLocHire: tally(eploy, role, hireMonths, (region) => region === 'Unknown' ? null : region),
    };
    return { role, screenMonths, hireMonths, counts, ...combine(counts, blend, regions), dataset: eploy.dataset };
  }

  // The rates from the counts. Kept apart from build() so the hire ranges can
  // rebuild the rates from counts redrawn within their uncertainty.
  function combine(counts, blend, regions) {
    const { N, pull, M, R } = blend;
    const all = counts.all;
    const roleScreen = all.apps > 0 ? all.passed / all.apps : 0;
    const platform = {};
    RAC.PLATFORMS.forEach(p => {
      const t = counts.byPlat[p] || { apps: 0, passed: 0 };
      const own = t.apps > 0 ? t.passed / t.apps : null;
      let used, basis;
      if (PULLED.includes(p)) {
        used = own === null ? roleScreen : own + pull * (roleScreen - own);
        basis = `own rate moved ${Math.round(pull * 100)}% of the way to the role average`;
      } else {
        used = (t.passed + N * roleScreen) / (t.apps + N || 1);
        basis = N >= 100000 ? 'role average' : N > 0 ? `blended with the role average by ${N} applications` : 'own rate';
      }
      platform[p] = { apps: t.apps, passed: t.passed, own, used, basis };
    });
    const hireAll = counts.hireAll;
    const roleHire = hireAll.passed > 0 ? hireAll.hires / hireAll.passed : 0;
    const location = {};
    regions.forEach(l => {
      const t = counts.byLoc[l] || { apps: 0, passed: 0 };
      const ratio = t.apps > 0 && roleScreen > 0 ? (t.passed / t.apps) / roleScreen : 1;
      const adj = (t.apps * ratio + M * 1) / (t.apps + M || 1);
      const th = counts.byLocHire[l] || { passed: 0, hires: 0 };
      const hire = (th.hires + R * roleHire) / (th.passed + R || 1);
      location[l] = {
        apps: t.apps, passed: t.passed, ownScreen: t.apps > 0 ? t.passed / t.apps : null, screenAdjustment: adj,
        hirePassed: th.passed, hires: th.hires, ownHire: th.passed > 0 ? th.hires / th.passed : null, hireAfterScreening: hire,
      };
    });
    return {
      roleScreen, roleHire,
      totals: { screen: all, hire: hireAll },
      blend,
      platform, location,
    };
  }

  // Counts redrawn within their statistical uncertainty (normal approximation
  // to the binomial, with half a count added so a zero still carries some
  // uncertainty), for the hire ranges.
  function redraw(counts, normal) {
    const pass = (t, k, n) => {
      if (!t || !(t[n] > 0)) return t;
      const x = t[k] + 0.5, p = Math.min(1, x / (t[n] + 1));
      const v = Math.min(t[n], Math.max(0, t[k] + normal() * Math.sqrt(x * (1 - p))));
      return { ...t, [k]: v };
    };
    const map = (o, k, n) => Object.fromEntries(Object.entries(o).map(([key, t]) => [key, pass(t, k, n)]));
    return {
      all: pass(counts.all, 'passed', 'apps'),
      byPlat: map(counts.byPlat, 'passed', 'apps'),
      byLoc: map(counts.byLoc, 'passed', 'apps'),
      hireAll: pass(counts.hireAll, 'hires', 'passed'),
      byLocHire: map(counts.byLocHire, 'hires', 'passed'),
    };
  }

  // The rates for one location and platform, with their build-up.
  function cell(rates, plat, region) {
    const pf = rates.platform[plat];
    const loc = rates.location[region] || { screenAdjustment: 1, hireAfterScreening: rates.roleHire, apps: 0, hirePassed: 0 };
    const screen = pf.used * loc.screenAdjustment;
    return {
      platformScreen: pf.used, platformBasis: pf.basis, screenAdjustment: loc.screenAdjustment,
      screen, hireAfterScreening: loc.hireAfterScreening,
      hirePerApplication: screen * loc.hireAfterScreening,
      evidence: { platformApps: pf.apps, locationApps: loc.apps, locationPassed: loc.hirePassed },
    };
  }

  RAC.rates = { maturedMonths, tally, build, combine, redraw, cell };
})(window.RAC = window.RAC || {});
