// Checks for the OneRAC plan (planner/onerac.js, D7).
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';
import { FakePDF } from '../lib/fake_pdf.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const D = calibrationData(RAC);
  const env = { ds: D.SMR.ds, A, eploy };
  const SETUP = { locations: [{ region: 'London', from: '2026-10' }, { region: 'West Midlands', from: '2026-11' }], budget: 20000, fundFromRoles: true };
  const VAC = {
    SMR: { London: 18, 'South East': 19, 'West Midlands': 8, 'South West': 10 },
    Patrol: { London: 12, 'South East': 9, 'West Midlands': 5, 'South West': 8 },
  };
  const base = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 };
  const oneRacInputs = (regions, extra = {}) => ({
    ...base, regions, vacancies: VAC, budget: 20000, hireTarget: 6,
    premiumCampaigns: 0, acReserve: 0, platMin: {}, platMax: {}, coverage: {}, comboMin: {},
    regionMin: {}, regionMax: {}, limits: {}, ...extra,
  });

  check('OneRAC: only locations whose launch month has arrived count, and the hold-back follows open roles', () => {
    assert(JSON.stringify(RAC.onerac.live(SETUP, '2026-10')) === '["London"]', 'October: ' + RAC.onerac.live(SETUP, '2026-10'));
    assert(JSON.stringify(RAC.onerac.live(SETUP, '2026-11')) === '["London","West Midlands"]', 'November: ' + RAC.onerac.live(SETUP, '2026-11'));
    const m = RAC.onerac.mix(VAC, ['London']);
    assert(m.total === 30 && m.vacancies.SMR === 18 && m.vacancies.Patrol === 12, 'mix ' + JSON.stringify(m.vacancies));
    near(m.share.SMR, 18 / 30, 1e-12, 'SMR share');
    const hb = RAC.onerac.holdback(SETUP, m, '2026-10');
    near(hb.byRole.SMR + hb.byRole.Patrol, 20000, 1e-9, 'hold-back adds up to the OneRAC budget');
    near(hb.byRole.SMR, 20000 * 18 / 30, 1e-9, 'SMR hold-back');
    const off = RAC.onerac.holdback({ ...SETUP, fundFromRoles: false }, m, '2026-10');
    assert(off.byRole.SMR === 0 && off.byRole.Patrol === 0, 'with funding off nothing comes off the role budgets');
    return `October London only (£${Math.round(hb.byRole.SMR)} off SMR, £${Math.round(hb.byRole.Patrol)} off Patrol); November adds West Midlands; funding off takes nothing`;
  });

  check('OneRAC: the plan adds the two roles’ history in its locations and blends cost to the open roles', () => {
    const regions = ['London', 'West Midlands'];
    const plan = RAC.onerac.build(oneRacInputs(regions), env);
    assert(plan, 'no plan built');
    assert(plan.role === 'OneRAC', 'role ' + plan.role);
    assert(JSON.stringify(plan.allRegions) === JSON.stringify(regions), 'regions ' + plan.allRegions);
    // Its monthly figures are the two roles' added together.
    let mine = 0, roles = 0;
    plan.raw.rows.forEach(r => { mine += r.spend; });
    RAC.ROLES.forEach(role => regions.forEach(region => RAC.PLATFORMS.forEach(plat => {
      const m = RAC.data.monthly(env.ds, plat, region, role);
      Object.keys(m).forEach(mo => { roles += m[mo].spend; });
    })));
    near(mine, roles, 0.01, 'monthly spend is the two roles added together');
    // Its Eploy counts are the two roles' added together.
    const count = (role, regs) => eploy.cells.filter(c => c[0] === role && regs.includes(c[1]))
      .reduce((t, c) => ({ apps: t.apps + c[4], quality: t.quality + c[5], hires: t.hires + c[6] }), { apps: 0, quality: 0, hires: 0 });
    const both = RAC.ROLES.map(r => count(r, regions));
    const cts = plan.rates.counts.all;
    const months = new Set(plan.rates.screenMonths);
    const direct = eploy.cells.filter(c => RAC.ROLES.includes(c[0]) && regions.includes(c[1]) && months.has(c[3]))
      .reduce((t, c) => ({ apps: t.apps + c[4], quality: t.quality + c[5] }), { apps: 0, quality: 0 });
    near(cts.apps, direct.apps, 1e-9, 'applications behind the rates');
    near(cts.passed, direct.quality, 1e-9, 'quality applications behind the rates');
    // The role-mix adjustment moves cost towards the open-roles blend.
    const adj = plan.oneRac.adjustment;
    assert(adj.factor > 0.5 && adj.factor < 2, 'role-mix adjustment ' + adj.factor);
    near(plan.costAdjustment.used, plan.costAdjustment.remainingError * adj.factor, 1e-12, 'cost adjustment');
    assert(plan.budget === 20000 && plan.totals.spend <= plan.deployable + 0.01, 'budget conservation');
    return `${regions.join(' and ')}: ${plan.totals.apps.toFixed(0)} applications, ${plan.totals.allHires.toFixed(1)} hires on £${Math.round(plan.totals.spend)}; ` +
      `open-roles cost £${adj.openBlend.toFixed(2)} against £${adj.combined.toFixed(2)} blended by past spend (x${adj.factor.toFixed(3)}); ` +
      `both roles' counts: ${both.map((b, i) => `${RAC.ROLES[i]} ${b.apps}`).join(', ')}`;
  });

  check('OneRAC: its assumptions are the role values blended by open roles', () => {
    const plan = RAC.onerac.build(oneRacInputs(['London']), env);
    const m = plan.oneRac.mix;
    ['role_cpa_benchmark', 'remaining_error_factor', 'paid_hire_reconciliation_factor', 'range_apps_low', 'row_widen_apps'].forEach(key => {
      const want = RAC.ROLES.reduce((a, role) => a + m.share[role] * RAC.assumptions.get(A, key, role), 0);
      const spec = RAC.assumptions.SCHEMA[key];
      near(RAC.assumptions.get(plan.A, key, 'OneRAC'), spec.integer ? Math.round(want) : want, 1e-9, key);
    });
    const rows = RAC.text.assumptionRows(plan.A, 'OneRAC', plan).filter(r => r.source === 'blended by open roles');
    assert(rows.length >= 10, `only ${rows.length} blended rows reach the exports`);
    const bench = rows.find(r => r.key === 'role_cpa_benchmark');
    return `${rows.length} values blended and printed, for example the role benchmark at £${bench.value.toFixed(2)} ` +
      `(SMR £${RAC.assumptions.get(A, 'role_cpa_benchmark', 'SMR')}, Patrol £${RAC.assumptions.get(A, 'role_cpa_benchmark', 'Patrol')})`;
  });

  check('OneRAC: the self-competition assumption lowers cost per application by what it says', () => {
    const plain = RAC.onerac.build(oneRacInputs(['London']), env);
    const cheaper = RAC.onerac.build(oneRacInputs(['London'], { selfCompetition: 0.1 }), env);
    near(cheaper.costAdjustment.used, plain.costAdjustment.used * 0.9, 1e-12, 'cost adjustment at 10%');
    const a = plain.locations[0].cells.indeed, b = cheaper.locations[0].cells.indeed;
    if (a.spend > 0) near(b.plannedCpa / a.plannedCpa, 0.9, 1e-9, 'planned cost per application at the same spend');
    assert(cheaper.totals.apps > plain.totals.apps, 'cheaper applications should be more numerous');
    assert(RAC.assumptions.get(A, 'onerac_self_competition') === 0, 'the file default should be 0%');
    return `0% gives ${plain.totals.apps.toFixed(0)} applications and ${plain.totals.allHires.toFixed(1)} hires; 10% gives ${cheaper.totals.apps.toFixed(0)} and ${cheaper.totals.allHires.toFixed(1)}`;
  });

  check('OneRAC: a second scenario is shown beside the plan, and named as a comparison', () => {
    const plan = RAC.onerac.build(oneRacInputs(['London'], { secondScenario: 0.15 }), env);
    const second = plan.oneRac.second;
    assert(second && second.selfCompetition === 0.15, 'no second scenario on the plan');
    // The plan itself is unchanged: the scenario is a comparison only.
    const plain = RAC.onerac.build(oneRacInputs(['London']), env);
    near(plan.totals.apps, plain.totals.apps, 1e-9, 'the plan moved when a second scenario was added');
    assert(second.apps > plain.totals.apps, 'a cheaper scenario should show more applications');
    assert(Math.abs(second.extraHires - (second.hires - plan.totals.allHires)) < 1e-9, 'the difference in hires');
    const doc = { role: 'OneRAC', roleName: 'OneRAC (SMR and Patrol)', plan, commentary: { legacy: [], plan: [] } };
    const o = { monthLabel: 'October 2026', planName: 'OneRAC October', backtest: null, code: { commit: 'feedface00' }, notes: false };
    const out = RAC.pdf.build(FakePDF, [doc], o);
    assert(!out.problems.length, out.problems.join('; '));
    // The PDF wraps each line, so a phrase can be split across the strings it draws.
    const flat = out.texts.join(' ').replace(/\s+/g, ' ');
    assert(flat.includes('Second scenario: at a self-competition improvement of 15%'), 'the PDF does not print the second scenario');
    assert(flat.includes('It is a comparison, not the plan.'), 'the PDF does not say it is a comparison');
    const text = RAC.text.method(plan.A, 'OneRAC', plan, null).flatMap(x => x.paras).join(' ');
    assert(/A second scenario is shown beside the plan/.test(text), 'the method text does not mention it');
    // Nothing set means nothing shown.
    assert(RAC.onerac.build(oneRacInputs(['London'], { secondScenario: 0 }), env).oneRac.second === null, 'a second scenario appeared without one being set');
    return `at 15% the same budget shows ${second.hires.toFixed(1)} hires against ${plan.totals.allHires.toFixed(1)}, printed as a comparison; the plan is unchanged`;
  });

  check('OneRAC: its PDF and workings build from the plan, with the OneRAC method section', () => {
    const plan = RAC.onerac.build(oneRacInputs(['London', 'West Midlands']), env);
    const doc = { role: 'OneRAC', roleName: 'OneRAC (SMR and Patrol)', plan, commentary: { legacy: [], plan: [] } };
    const opts = { monthLabel: 'October 2026', planName: 'OneRAC October', backtest: null, code: { commit: 'feedface00' } };
    const text = RAC.text.method(plan.A, 'OneRAC', plan, null);
    assert(text.some(s => s.heading === 'The OneRAC plan'), 'no OneRAC section in the method text');
    assert(!RAC.outputChecks.text(text.flatMap(s => s.paras).join('\n')).length, 'method text fails the output checks');
    const pdf = RAC.pdf.build(FakePDF, [doc], { ...opts, notes: false });
    assert(!pdf.problems.length, 'PDF: ' + pdf.problems.join('; '));
    const all = pdf.texts.join('\n');
    ['OneRAC (SMR and Patrol)', 'London', 'West Midlands', RAC.text.fmt.gbp(plan.totals.spend)].forEach(t =>
      assert(all.includes(t), 'the OneRAC PDF does not show ' + t));
    assert(RAC.pdf.titleOf(doc, 'October 2026').includes('OneRAC'), 'title ' + RAC.pdf.titleOf(doc, 'October 2026'));
    const w = RAC.workings.build([doc], opts);
    assert(!w.problems.length, 'workings: ' + w.problems.join('; '));
    assert(w.sheets.find(s => s.name === 'Workings').rows.some(r => r.cells[0] === 'London'), 'no London row in the workings');
    const ca = RAC.text.costAdjustment(plan);
    assert(ca.extra && ca.label === 'Cost adjustment', 'cost adjustment label ' + ca.label);
    return `method has ${text.length} sections including the OneRAC one; workings ${w.checks.length} formulas; cost adjustment "${ca.basis}"`;
  });

  check('OneRAC: role plans leave its locations out and carry the hold-back', () => {
    const m = RAC.onerac.mix(VAC, ['London']);
    const hb = RAC.onerac.holdback(SETUP, m, '2026-10');
    const without = RAC.plan.build('SMR', { ...base, liveRegions: base.liveRegions.filter(r => r !== 'London'), oneRacHoldback: hb.byRole.SMR }, env);
    assert(!without.locations.some(l => l.region === 'London'), 'London is still in the SMR plan');
    near(without.holdbacks.oneRac, Math.round(hb.byRole.SMR), 1e-9, 'OneRAC hold-back');
    const plain = RAC.plan.build('SMR', base, env);
    near(without.deployable, plain.deployable - Math.round(hb.byRole.SMR), 1e-9, 'the hold-back comes off the deployable budget');
    return `SMR without London: deployable £${Math.round(without.deployable)} against £${Math.round(plain.deployable)}, ` +
      `OneRAC hold-back £${Math.round(without.holdbacks.oneRac)}`;
  });
}
