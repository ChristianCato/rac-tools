// Checks for the hire calculation (addendum 2.2), reconciliation, D1 and the
// forecast function.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const DATA = calibrationData(RAC);

  // Direct count from the aggregated rows, written separately from the planner.
  const count = (role, months, pred) => eploy.cells
    .filter(c => c[0] === role && months.includes(c[3]) && pred(c))
    .reduce((t, c) => ({ apps: t.apps + c[4], passed: t.passed + c[5], hires: t.hires + c[6] }), { apps: 0, passed: 0, hires: 0 });

  check('Screening and hire rates match a direct count from the Eploy rows', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const r = RAC.rates.build(eploy, A, role);
      const sm = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
      assert(JSON.stringify(r.screenMonths) === JSON.stringify(sm), `${role} screening months ${r.screenMonths}`);
      assert(JSON.stringify(r.hireMonths) === JSON.stringify(sm), `${role} hire months ${r.hireMonths}`);
      const all = count(role, sm, () => true);
      const roleRate = all.passed / all.apps;
      near(r.roleScreen, roleRate, 1e-12, role + ' role screening rate');
      const N = RAC.assumptions.get(A, 'screen_blend_n', role);
      for (const p of ['indeed', 'appcast']) {
        const t = count(role, sm, c => c[2] === p);
        near(r.platform[p].used, (t.passed + N * roleRate) / (t.apps + N), 1e-12, `${role} ${p} screening rate`);
      }
      for (const p of ['meta', 'google']) {
        const t = count(role, sm, c => c[2] === p);
        near(r.platform[p].used, (t.passed / t.apps + roleRate) / 2, 1e-12, `${role} ${p} screening rate (halfway)`);
      }
      const M = RAC.assumptions.get(A, 'location_screen_blend_n', role);
      const Rn = RAC.assumptions.get(A, 'region_hire_blend_n', role);
      const roleHire = all.hires / all.passed;
      for (const l of ['London', 'South East', 'Scotland', 'North East']) {
        const t = count(role, sm, c => c[1] === l);
        near(r.location[l].screenAdjustment, (t.apps * ((t.passed / t.apps) / roleRate) + M) / (t.apps + M), 1e-12, `${role} ${l} screening adjustment`);
        near(r.location[l].hireAfterScreening, (t.hires + Rn * roleHire) / (t.passed + Rn), 1e-12, `${role} ${l} hire rate after screening`);
      }
      const c = RAC.rates.cell(r, 'google', 'London');
      near(c.hirePerApplication, r.platform.google.used * r.location.London.screenAdjustment * r.location.London.hireAfterScreening, 1e-15, 'hires per application');
      out.push(`${role}: role screening ${(roleRate * 100).toFixed(1)}%, hire after screening ${(roleHire * 100).toFixed(1)}%, London hires per Google application ${(c.hirePerApplication * 100).toFixed(2)}%`);
    }
    return out.join('; ');
  });

  check('Patrol London: the location screening adjustment reflects its weak screening', () => {
    const r = RAC.rates.build(eploy, A, 'Patrol');
    const x = r.location.London;
    assert(x.screenAdjustment < 0.6, 'Patrol London adjustment ' + x.screenAdjustment);
    const perApp = RAC.PLATFORMS.map(p => RAC.rates.cell(r, p, 'London').hirePerApplication);
    return `London passed ${x.passed} of ${x.apps} (${(x.ownScreen * 100).toFixed(1)}%, role ${(r.roleScreen * 100).toFixed(1)}%), adjustment ${x.screenAdjustment.toFixed(2)}; ` +
      `hires per application by platform ${perApp.map(v => (v * 100).toFixed(2) + '%').join(', ')}`;
  });

  check('Reconciliation: platform hires, other-source hires and their monthly average match a direct count', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const rec = RAC.testing.reconciliation(DATA[role].ds, eploy, A, role);
      const hr = RAC.rates.build(eploy, A, role);
      assert(JSON.stringify(rec.months) === JSON.stringify(hr.hireMonths), `${role} months ${rec.months} differ from the hire rate months ${hr.hireMonths}`);
      const all = count(role, rec.months, () => true).hires;
      const paid = count(role, rec.months, c => c[2] !== 'other').hires;
      const other = count(role, rec.months, c => c[2] === 'other').hires;
      assert(rec.eployHires === all && paid + other === all, `${role} Eploy hires ${rec.eployHires} against direct ${all}`);
      const pf = RAC.assumptions.get(A, 'paid_hire_reconciliation_factor', role);
      const of = RAC.assumptions.get(A, 'other_hires_credit_factor', role);
      near(rec.modelHires * pf, paid, 0.01, `${role} model hires x paid factor against platform hires`);
      near(rec.modelHires * of, other, 0.01, `${role} model hires x credit factor against other-source hires`);
      near(rec.modelHires * (pf + of), all, 0.02, `${role} both factors against every hire (the earlier scaling)`);
      const monthly = rec.months.map(mo => count(role, [mo], c => c[2] === 'other').hires);
      near(RAC.assumptions.get(A, 'other_hires_monthly', role), monthly.reduce((a, b) => a + b, 0) / monthly.length, 1e-4, `${role} other-source hires a month`);
      const os = RAC.testing.otherSources(eploy, A, role, rec.months);
      const recent = rec.months.filter(mo => mo >= '2026-03').map(mo => count(role, [mo], c => c[2] === 'other').hires);
      near(os.recentMean, recent.reduce((a, b) => a + b, 0) / recent.length, 1e-12, `${role} average since March 2026`);
      const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
      const variance = monthly.reduce((a, b) => a + (b - mean) ** 2, 0) / (monthly.length - 1);
      near(os.dispersion, Math.max(1, variance / mean), 1e-12, `${role} other-source dispersion`);
      assert(RAC.assumptions.get(A, 'other_hires_credited_share', role) === 0, `${role} credited share should start at 0%`);
      out.push(`${role}: model ${rec.modelHires.toFixed(1)} hires; x ${pf} = ${paid} platform hires; other sources ${other} (${monthly.join(', ')} a month, average ${(other / monthly.length).toFixed(2)}, since March ${os.recentMean.toFixed(2)}); ${pf} + ${of} = ${(pf + of).toFixed(4)}, the earlier scaling to ${all}`);
    }
    return out.join('; ');
  });

  check('Google includes Paid Google and Paid Google Display', () => {
    const csv = readRoot('data/eploy_mappings.csv');
    for (const label of ['Paid Google Display', 'Paid Google', 'Paid Google Search', 'Google (Organic or Paid)']) {
      assert(new RegExp(`^source,${label.replace(/[()]/g, '\\$&')},google,`, 'm').test(csv), `${label} does not map to google`);
    }
    assert(/^source,Paid Google Demand Gen,other,/m.test(csv), 'Paid Google Demand Gen should stay in other sources');
    const g = count('SMR', ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'], c => c[2] === 'google');
    return `SMR Google, applications October to June: ${g.apps} applications, ${g.passed} passed screening, ${g.hires} hires`;
  });

  check('Blend-strength tests use test months with 5 months of history, learning only from earlier months', () => {
    const months = RAC.rates.maturedMonths(eploy, 4);
    const sp = RAC.testing.testMonths(months, RAC.assumptions.get(A, 'test_min_history_months'));
    assert(JSON.stringify(sp.map(s => s.test[0])) === JSON.stringify(['2026-03', '2026-04', '2026-05']), 'test months ' + sp.map(s => s.test[0]));
    sp.forEach(s => {
      assert(s.train.length >= 5, `${s.test[0]} has only ${s.train.length} months of history`);
      assert(s.train.every(mo => mo < s.test[0]), `train ${s.train} not before ${s.test}`);
    });
    return sp.map(s => `${s.test[0]} from ${s.train[0]} to ${s.train[s.train.length - 1]}`).join('; ');
  });

  check('Own figures replace the average only when clearly better; leave-one-out flags unstable values', () => {
    const G = RAC.testing.GRID;
    const month = (mo, gainAt5, pearson = 10, cells = 10) => ({ month: mo, pearson, cells, ll: Object.fromEntries(G.map(v => [v, v === 5 ? gainAt5 : 0])) });
    // Dispersion 1: a gain of 3 is clear, 1.5 is not.
    assert(RAC.testing.decide([month('a', 1.5), month('b', 1.5)], () => true, 2).value === 5, 'a gain of 3 should use the own figure');
    assert(RAC.testing.decide([month('a', 0.7), month('b', 0.8)], () => true, 2).value === RAC.testing.AVERAGE, 'a gain of 1.5 should keep the average');
    // Dispersion 4 divides the same gain of 3 down to 0.75.
    const noisy = RAC.testing.decide([month('a', 1.5, 40), month('b', 1.5, 40)], () => true, 2);
    assert(noisy.value === RAC.testing.AVERAGE && Math.abs(noisy.phi - 4) < 1e-12, 'dispersion not applied');
    const lo = RAC.testing.leaveOneOut([month('a', 3), month('b', 0), month('c', 0)], 2, 5);
    assert(lo.unstable && lo.loo.find(x => x.month === 'a').value === RAC.testing.AVERAGE, 'leaving out the only strong month should flag instability');
    const out = [];
    for (const role of RAC.ROLES) {
      const t = RAC.testing.blendStrengths(eploy, A, role);
      for (const k of Object.keys(t)) {
        assert(t[k].loo.length === 3, `${role} ${k}: ${t[k].loo.length} leave-one-out values`);
        if (t[k].value !== RAC.testing.AVERAGE) assert(t[k].gain >= RAC.assumptions.get(A, 'own_figure_min_gain'), `${role} ${k} used without a clear gain`);
        out.push(`${role} ${k} ${t[k].value}${t[k].unstable ? ' (unstable)' : ''}`);
      }
    }
    return out.join('; ');
  });

  check('Diminishing returns fit recovers a known rate from made-up data', () => {
    // Four locations, each with apps = its own level x spend ^ 0.45 exactly.
    const regions = ['London', 'South East', 'Scotland', 'Wales'];
    const D = { regions_ordered: regions, indeed: {}, meta: {}, google: {}, appcast: {} };
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    regions.forEach((r, i) => {
      const monthly = {};
      months.forEach((mo, j) => { const s = 500 * (i + 1) * (1 + j); monthly[mo] = { spend: s, completes: (3 + 2 * i) * Math.pow(s, 0.45) }; });
      D.meta[r + '__SMR'] = { monthly };
    });
    const ds = RAC.data.snapshot(D, { at: '2026-12-31', months }, { generated_at: '2026-12-31', months: [] });
    const f = RAC.forecast.fitRate(ds, A, 'SMR', 'meta', months);
    near(f.fitted, 0.45, 1e-9, 'fitted rate');
    assert(f.n === 20 && f.cells === 4, `evidence ${f.n} from ${f.cells} locations`);
    const d1 = RAC.forecast.rates(ds, A, 'SMR', months, { roleRate: 0.8, k: 20 });
    near(d1.meta.b, (20 * 0.45 + 20 * 0.8) / 40, 1e-12, 'blended rate');
    near(d1.indeed.b, 0.8, 0, 'no evidence takes the role rate');
    const up = RAC.forecast.rates(ds, A, 'SMR', months, { fits: { indeed: { fitted: 1.4, n: 50 }, meta: f, google: f, appcast: f }, roleRate: 0.8, k: 10 });
    assert(up.indeed.b === 1 && up.indeed.heldAtOne, 'a rate above 1 is held at 1');
    return `fitted ${f.fitted.toFixed(4)} from ${f.n} location-months; blended with 0.8 at k=20 gives ${d1.meta.b.toFixed(3)}`;
  });

  check('Forecast: cost per application rises with spend as set, and the split maths agree', () => {
    const pc = { cpaUsual: 80, spendUsual: 2000, b: 0.6, bias: 1.1, recon: 2, screen: 0.12, hireAfterScreening: 0.15, hirePerApplication: 0.12 * 0.15 * 2 };
    const f1 = RAC.forecast.at(pc, 2000), f2 = RAC.forecast.at(pc, 4000);
    near(f1.cpa, 88, 1e-9, 'cost per application at the usual spend');
    near(f2.cpa, 88 * Math.pow(2, 0.4), 1e-9, 'cost per application at twice the usual spend');
    near(f2.apps / f1.apps, Math.pow(2, 0.6), 1e-12, 'applications rise as spend ^ b');
    near(f1.hires, (2000 / 88) * 0.12 * 0.15 * 2, 1e-12, 'hires');
    const S = 3100, h = 0.01;
    const numeric = h / (RAC.forecast.at(pc, S + h).hires - RAC.forecast.at(pc, S).hires);
    near(RAC.forecast.marginalCostPerHire(pc, S) / numeric, 1, 1e-5, 'marginal cost per hire against a numeric derivative');
    near(RAC.forecast.spendForMarginal(pc, RAC.forecast.marginalCostPerHire(pc, S)), S, 1e-6, 'spend for a marginal cost gives back the spend');
    const zero = RAC.forecast.at(pc, 0);
    assert(zero.apps === 0 && zero.hires === 0, 'no spend, no applications');
    return `£${f1.cpa.toFixed(2)} at £2,000, £${f2.cpa.toFixed(2)} at £4,000; marginal cost per hire at £3,100 £${RAC.forecast.marginalCostPerHire(pc, S).toFixed(0)}`;
  });
}
