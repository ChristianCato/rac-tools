// RAC planner: the OneRAC plan (D7).
//
// OneRAC runs one set of campaigns for both roles in its locations, from each
// location's launch date. It is planned on its own, not as part of the SMR and
// Patrol plans:
//
//   - OneRAC locations are left out of the SMR and Patrol plans from their
//     launch month, so nothing is planned twice.
//   - Open roles for OneRAC are the SMR and Patrol open roles in those
//     locations added together.
//   - Past performance is the two roles' spend and applications in those
//     locations added together, which is what a combined campaign would have
//     spent and received.
//   - Cost per application is then blended to the mix of open roles (the
//     role-mix adjustment below), because the plan recruits for the roles that
//     are open, not for the roles the past spend happened to be split between.
//   - Quality and hire rates are the two roles' applicant tracking counts in
//     those locations added together. The two roles' rates sit close together
//     (SMR 21.7% and Patrol 19.5% quality, 10.9% and 10.3% hires after
//     quality), so the counts are used as they are.
//   - A self-competition assumption reduces cost per application for the two
//     roles no longer bidding against each other. It is 0% by default.
//   - Everything else is the role plans' own method: diminishing returns, the
//     remaining-error adjustment, spending caps, cost limits and ranges.
//
// Funding. "Fund OneRAC from the SMR and Patrol budgets" (on by default) takes
// the OneRAC budget off the top of both role budgets, split by the open roles
// in OneRAC locations, and each role plan shows it as a OneRAC hold-back. With
// it off, the role budgets are untouched.
//
//   RAC.onerac.live(setup, planMonth)          the locations live that month
//   RAC.onerac.mix(vacancies, regions)         open roles by role, and the shares
//   RAC.onerac.holdback(setup, mix, planMonth) what comes off each role budget
//   RAC.onerac.build(opts, env)                the OneRAC plan
(function (RAC) {
  'use strict';
  const P = () => RAC.PLATFORMS;
  const U = RAC.util;
  const ROLE = 'OneRAC';

  // Locations whose launch month has arrived.
  function live(setup, planMonth) {
    return ((setup && setup.locations) || [])
      .filter(l => l && l.region && (!l.from || !planMonth || planMonth >= l.from))
      .map(l => l.region);
  }

  // Open roles in the OneRAC locations, and each role's share of them.
  function mix(vacancies, regions) {
    const by = {};
    let total = 0;
    RAC.ROLES.forEach(role => {
      const v = (vacancies && vacancies[role]) || {};
      by[role] = U.sum(regions.map(r => Math.max(0, Math.round(v[r] || 0))));
      total += by[role];
    });
    const share = {};
    RAC.ROLES.forEach(role => { share[role] = total > 0 ? by[role] / total : 1 / RAC.ROLES.length; });
    return { regions: regions.slice(), vacancies: by, total, share };
  }

  // What the OneRAC budget takes off each role budget.
  function holdback(setup, m, planMonth) {
    const on = !setup || setup.fundFromRoles !== false;
    const budget = Math.max(0, Math.round((setup && setup.budget) || 0));
    const out = { on, budget, byRole: {} };
    RAC.ROLES.forEach(role => { out.byRole[role] = on && m.total > 0 ? budget * m.share[role] : 0; });
    if (!on || !m.regions.length || !budget) RAC.ROLES.forEach(role => { out.byRole[role] = 0; });
    out.planMonth = planMonth || null;
    return out;
  }

  // The two roles' monthly figures in the OneRAC locations, added together,
  // as a data object for a role of its own.
  function data(ds, regions) {
    const out = { regions_ordered: regions.slice() };
    P().forEach(plat => {
      out[plat] = {};
      regions.forEach(region => {
        const monthly = {};
        RAC.ROLES.forEach(role => {
          const m = RAC.data.monthly(ds, plat, region, role);
          Object.keys(m).forEach(mo => {
            const c = monthly[mo] = monthly[mo] || { spend: 0, completes: 0, clicks: 0 };
            c.spend += m[mo].spend; c.completes += m[mo].apps; c.clicks += m[mo].clicks;
          });
        });
        Object.keys(monthly).forEach(mo => { monthly[mo].cpa = monthly[mo].completes > 0 ? monthly[mo].spend / monthly[mo].completes : null; });
        out[plat][region + '__' + ROLE] = { monthly };
      });
    });
    return out;
  }

  // The two roles' applicant tracking counts in the OneRAC locations, added
  // together, as a rates file of its own.
  function eploy(file, regions) {
    const set = new Set(regions);
    const by = new Map();
    file.cells.forEach(([role, region, plat, mo, a, q, h, pr]) => {
      if (!RAC.ROLES.includes(role) || !set.has(region)) return;
      const k = region + '|' + plat + '|' + mo;
      const c = by.get(k) || [ROLE, region, plat, mo, 0, 0, 0, 0];
      c[4] += a; c[5] += q; c[6] += h; c[7] += (pr === undefined ? q : pr);
      by.set(k, c);
    });
    return { ...file, cells: [...by.values()].sort((x, y) => (x[1] + x[2] + x[3] < y[1] + y[2] + y[3] ? -1 : 1)) };
  }

  // Cost per application blended to the mix of open roles, against the same
  // figure blended by past spend (which is what adding the two roles together
  // gives). The ratio is applied to planned cost per application and printed.
  function roleMixAdjustment(ds, A, regions, m, window, includeSettling) {
    const per = {};
    let openBlend = 0, combinedSpend = 0, combinedApps = 0;
    RAC.ROLES.forEach(role => {
      const ctx = RAC.cost.context(ds, A, role, window, { includeSettling });
      let spend = 0, apps = 0;
      regions.forEach(region => P().forEach(plat => {
        const s = RAC.cost.windowStats(ctx, plat, region);
        spend += s.spend; apps += s.apps;
      }));
      per[role] = { spend, apps, cpa: apps > 0 ? spend / apps : null };
      combinedSpend += spend; combinedApps += apps;
    });
    const combined = combinedApps > 0 ? combinedSpend / combinedApps : null;
    const known = RAC.ROLES.filter(r => per[r].cpa !== null);
    const weight = U.sum(known.map(r => m.share[r]));
    if (known.length && weight > 0) openBlend = U.sum(known.map(r => (m.share[r] / weight) * per[r].cpa));
    const factor = combined > 0 && openBlend > 0 ? openBlend / combined : 1;
    return { factor, openBlend: openBlend || null, combined, per, roles: known };
  }

  // Every per-role assumption, blended by the open roles in OneRAC locations,
  // so the OneRAC plan reads them under its own role name.
  function assumptionsFor(A, m) {
    const changes = {};
    const entries = [];
    const shares = RAC.ROLES.map(r => `${r} ${Math.round(m.share[r] * 100)}%`).join(', ');
    Object.keys(RAC.assumptions.SCHEMA).forEach(key => {
      const spec = RAC.assumptions.SCHEMA[key];
      if (!spec.perRole || spec.unit === 'month') return;
      const per = RAC.ROLES.map(role => RAC.assumptions.get(A, key, role));
      const v = U.sum(RAC.ROLES.map((role, i) => m.share[role] * per[i]));
      const value = spec.integer ? Math.round(v) : v;
      changes[key] = { [ROLE]: value };
      const from = RAC.assumptions.entry(A, key, RAC.ROLES[0]) || {};
      entries.push({
        ...from, key, role: ROLE, value: String(value), parsed: value, testedValue: null,
        source: 'blended by open roles',
        notes: `The role values (${RAC.ROLES.map((r, i) => `${r} ${per[i]}`).join(', ')}) blended by the open roles in OneRAC locations (${shares}).`,
      });
    });
    const out = RAC.assumptions.withValues(A, changes);
    return { ...out, entries: out.entries.concat(entries) };
  }

  // The OneRAC plan.
  //   opts: regions, vacancies ({ SMR: {region: n}, Patrol: {...} }), budget,
  //         hireTarget, daysInMonth, planMonth, bench (data window),
  //         capMultiple, includeSettling, selfCompetition, and any of the
  //         usual plan inputs (platMin, platMax, regionMin, regionMax,
  //         coverage, limits, premiumCampaigns, acReserve, coveragePct).
  //   env:  the role plans' own { ds, A, eploy }.
  function build(opts, env) {
    const regions = (opts.regions || []).filter(r => env.ds.regions.includes(r));
    const m = mix(opts.vacancies, regions);
    if (!regions.length) return null;
    const A0 = assumptionsFor(env.A, m);
    const adj = roleMixAdjustment(env.ds, env.A, regions, m, opts.bench, opts.includeSettling);
    const ds = RAC.data.snapshot(data(env.ds, regions), env.ds.bench, env.ds.repo);
    const file = eploy(env.eploy, regions);
    const vacancies = Object.fromEntries(regions.map(r => [r, RAC.ROLES.reduce((a, role) => a + Math.max(0, Math.round(((opts.vacancies || {})[role] || {})[r] || 0)), 0)]));
    const inputs = {
      ...opts,
      liveRegions: regions.filter(r => vacancies[r] > 0),
      vacancies,
      oneRacHoldback: 0,
      roleMixAdjustment: adj.factor,
      selfCompetition: opts.selfCompetition || 0,
    };
    delete inputs.regions;
    const env2 = { ds, A: A0, eploy: file };
    const plan = RAC.plan.build(ROLE, inputs, env2);
    // An optional second scenario: the same plan with a different
    // self-competition figure, to show what it would be worth. It is a
    // comparison only; the plan itself is the first figure.
    let second = null;
    const other = Number(opts.secondScenario);
    if (Number.isFinite(other) && other > 0 && other <= 0.9 && other !== inputs.selfCompetition) {
      const q = RAC.plan.build(ROLE, { ...inputs, selfCompetition: other }, env2);
      second = {
        selfCompetition: other,
        apps: q.totals.apps, hires: q.totals.allHires, paidHires: q.totals.hires,
        cpa: q.totals.cpa, cph: q.totals.cph,
        budgetForTarget: q.unreachable ? null : q.budgetForTarget,
        mostHires: q.unreachable ? q.maxAchievable : null,
        extraHires: q.totals.allHires - plan.totals.allHires,
      };
    }
    return { ...plan, oneRac: { regions, mix: m, adjustment: adj, second, roleVacancies: opts.vacancies || {} } };
  }

  RAC.onerac = { ROLE, live, mix, holdback, data, eploy, roleMixAdjustment, assumptionsFor, build };
})(window.RAC = window.RAC || {});
