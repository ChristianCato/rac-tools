// Checks for spending limits (C1 to C5), limits (D6), the allocation and the
// plan entry point.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';
import { plan2aData } from './30_cost.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const D = calibrationData(RAC);
  const env = { ds: D.SMR.ds, A, eploy };
  const env2a = { ds: plan2aData(RAC), A, eploy };
  const SEPT = septSmrSettings(RAC.plan.NO_SPEND);
  const P = RAC.PLATFORMS;
  const cells = (plan) => plan.locations.flatMap(l => P.map(p => l.cells[p]));

  check('Budget is conserved to the penny', () => {
    const out = [];
    for (const [name, e, inputs] of [
      ['plan 2a data', env2a, SEPT],
      ['live data', env, SEPT],
      ['live data, £250,000', env, { ...SEPT, budget: 250000 }],
      ['live data, location minimums', env, { ...SEPT, regionMin: { Scotland: 9000, 'North West': 12000 } }],
      ['live data, Appcast max £1,500', env, { ...SEPT, platMax: { appcast: 1500 } }],
    ]) {
      const plan = RAC.plan.build('SMR', inputs, e);
      const cellSum = cells(plan).reduce((a, c) => a + c.spend, 0);
      near(plan.holdbacks.total + plan.placed + plan.unplaced.total, inputs.budget, 0.01, `${name}: hold-backs + placed + unplaced`);
      near(cellSum, plan.placed, 0.01, `${name}: cells add up to placed`);
      near(plan.locations.reduce((a, l) => a + l.spend, 0), plan.placed, 0.01, `${name}: locations add up to placed`);
      near(P.reduce((a, p) => a + plan.platforms[p].spend, 0), plan.placed, 0.01, `${name}: platforms add up to placed`);
      out.push(`${name}: £${plan.holdbacks.total} + £${plan.placed.toFixed(2)} + £${plan.unplaced.total.toFixed(2)} unplaced`);
    }
    return out.join('; ');
  });

  check('No location or platform goes above its limit unless instructed', () => {
    let n = 0;
    for (const inputs of [SEPT, { ...SEPT, budget: 250000 }, { ...SEPT, regionMin: { Scotland: 9000 } }]) {
      const plan = RAC.plan.build('SMR', inputs, env);
      for (const c of cells(plan)) {
        n++;
        assert(c.spend <= c.cap + c.aboveLimitByInstruction + 0.01, `${c.region} ${c.platform} £${c.spend.toFixed(2)} above its limit £${c.cap.toFixed(2)}`);
        if (!c.on) assert(c.spend === 0, `${c.region} ${c.platform} switched off but funded`);
      }
      for (const l of plan.locations) {
        const max = inputs.regionMax[l.region];
        const min = (inputs.regionMin || {})[l.region] || 0;
        if (min > (max === RAC.plan.NO_SPEND ? 0 : max > 0 ? max : Infinity)) {
          assert(plan.steps.some(s => s.region === l.region && /above its maximum; the minimum was applied/.test(s.reason)), `${l.region}: conflicting minimum not recorded`);
        } else if (max === RAC.plan.NO_SPEND) assert(l.spend === 0, l.region + ' set to no spend but funded');
        else if (max > 0) assert(l.spend <= max + 0.01, `${l.region} above its maximum`);
      }
    }
    const pinned = RAC.plan.build('SMR', { ...SEPT, regionMin: { Scotland: 9000 } }, env);
    const sc = pinned.locations.find(l => l.region === 'Scotland');
    assert(Math.abs(sc.spend - 9000) < 0.01, 'Scotland minimum not met: ' + sc.spend);
    const above = P.reduce((a, p) => a + sc.cells[p].aboveLimitByInstruction, 0);
    return `${n} location and platform rows checked; a £9,000 Scotland minimum (above its £2,500 maximum and its limits) was met, with £${above.toFixed(0)} recorded as above limits by instruction`;
  });

  check('Spending limits match a direct calculation from the data and Eploy', () => {
    const plan = RAC.plan.build('SMR', SEPT, env);
    const settledSM = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    let checked = 0, successful = 0, qualityOut = 0;
    for (const l of plan.locations) for (const p of P) {
      const c = l.cells[p];
      const m = RAC.data.monthly(env.ds, p, l.region, 'SMR');
      const months = Object.keys(m).filter(mo => mo >= '2026-01' && plan.months[mo].settled && m[mo].spend >= 200 && m[mo].apps >= 5).sort();
      assert(JSON.stringify(months) === JSON.stringify(c.ceilingMonths.map(x => x.month)), `${l.region} ${p} months considered`);
      let best = 0;
      for (const mo of months) {
        const x = m[mo], cpa = x.spend / x.apps;
        const expected = c.usualCpa * Math.pow(x.spend / c.spendUsual, 1 - c.diminishingRate) * c.remainingError;
        const t = eploy.cells.filter(r => r[0] === 'SMR' && r[1] === l.region && r[3] === mo).reduce((a, r) => [a[0] + r[4], a[1] + r[5]], [0, 0]);
        const normT = eploy.cells.filter(r => r[0] === 'SMR' && r[1] === l.region && settledSM.includes(r[3])).reduce((a, r) => [a[0] + r[4], a[1] + r[5]], [0, 0]);
        const norm = normT[1] / normT[0];
        const qualityApplies = settledSM.includes(mo) && t[0] * norm >= 10;
        const qualityPass = !qualityApplies || t[1] / t[0] >= norm * 0.75 - 1e-12;
        const ok = cpa <= expected + 1e-9 && qualityPass;
        const rec = c.ceilingMonths.find(x => x.month === mo);
        assert(rec.successful === ok, `${l.region} ${p} ${mo}: planner ${rec.successful}, direct ${ok}`);
        if (ok) { best = Math.max(best, x.spend); successful++; }
        if (cpa <= expected + 1e-9 && !qualityPass) qualityOut++;
        checked++;
      }
      const want = (best > 0 ? best : c.spendUsual) * plan.capMultiple;
      near(c.ceiling, want, 1e-6, `${l.region} ${p} limit`);
    }
    return `${checked} location-months checked, ${successful} successful, ${qualityOut} set aside by the quality test; every limit matched`;
  });

  check('Cost per hire and cost per application limits hold, and the money moves', () => {
    const plain = RAC.plan.build('SMR', SEPT, env);
    const se = plain.locations.find(l => l.region === 'South East');
    const cphLimit = Math.round(se.cph * 0.8);
    const cpaLimit = Math.round(se.cells.meta.plannedCpa * 0.9);
    const limited = RAC.plan.build('SMR', { ...SEPT, limits: { cph: { 'South East': cphLimit }, cpa: { 'South East': { meta: cpaLimit } } } }, env);
    const se2 = limited.locations.find(l => l.region === 'South East');
    assert(se2.cph <= cphLimit * 1.001, `South East cost per hire £${se2.cph.toFixed(0)} above limit £${cphLimit}`);
    assert(se2.cells.meta.spend === 0 || se2.cells.meta.plannedCpa <= cpaLimit + 0.01, `South East Meta £${se2.cells.meta.plannedCpa} above £${cpaLimit}`);
    assert(se2.spend < se.spend - 100, 'South East spend did not fall');
    near(limited.holdbacks.total + limited.placed + limited.unplaced.total, SEPT.budget, 0.01, 'budget conserved');
    return `South East: cost per hire limit £${cphLimit} held (£${se2.cph.toFixed(0)}), Meta cost per application limit £${cpaLimit} held; spend £${se.spend.toFixed(0)} to £${se2.spend.toFixed(0)}, unplaced £${plain.unplaced.total.toFixed(0)} to £${limited.unplaced.total.toFixed(0)}`;
  });

  check('Platform maximum holds across the role', () => {
    const plan = RAC.plan.build('SMR', { ...SEPT, platMax: { appcast: 1500 } }, env);
    assert(plan.platforms.appcast.spend <= 1501, 'Appcast £' + plan.platforms.appcast.spend);
    return `Appcast £${plan.platforms.appcast.spend.toFixed(0)} under a £1,500 maximum; unplaced £${plan.unplaced.total.toFixed(0)}`;
  });

  check('Within a location, the next hire costs the same on every platform with room', () => {
    const plan = RAC.plan.build('SMR', { ...SEPT, budget: 40000 }, env);
    let worst = 0, n = 0;
    for (const l of plan.locations) {
      const inner = P.filter(p => l.cells[p].spend > 1 && l.cells[p].spend < l.cells[p].cap - 1);
      if (inner.length < 2) continue;
      const pcs = inner.map(p => RAC.plan.prepare('SMR', SEPT, env).cells[l.region][p].pc);
      const mc = inner.map((p, i) => RAC.forecast.marginalCostPerHire(pcs[i], l.cells[p].spend));
      worst = Math.max(worst, Math.max(...mc) / Math.min(...mc) - 1); n++;
    }
    assert(n > 0, 'no location had two platforms below their limits');
    assert(worst < 1e-6, `marginal cost per hire differed by ${(worst * 100).toFixed(4)}%`);
    return `${n} locations: marginal cost per hire equal to within ${(worst * 100).toExponential(1)}%`;
  });

  check('Budget for the hire target: enough at the answer, not £50 less', () => {
    // 25 hires: at the agreed defaults 30 SMR hires were out of reach within the spending limits.
    const T = { ...SEPT, hireTarget: 25 };
    const plan = RAC.plan.build('SMR', T, env);
    assert(plan.budgetForTarget > 0 && !plan.unreachable, 'no answer');
    const at = RAC.plan.build('SMR', { ...T, budget: plan.budgetForTarget }, env).totals.allHires;
    const below = RAC.plan.build('SMR', { ...T, budget: plan.budgetForTarget - 50 }, env).totals.allHires;
    assert(at >= 25 - 1e-9, `at £${plan.budgetForTarget}: ${at} hires`);
    assert(below < 25, `at £${plan.budgetForTarget - 50}: ${below} hires`);
    const at30 = RAC.plan.build('SMR', SEPT, env);
    assert(at30.unreachable && at30.maxAchievable < 30, '30 hires expected out of reach at a 0% share');
    const big = RAC.plan.build('SMR', { ...SEPT, hireTarget: 500 }, env);
    assert(big.unreachable && big.maxAchievable > 0, 'a 500-hire target should be out of reach within the limits');
    return `25 hires: £${plan.budgetForTarget} gives ${at.toFixed(2)}, £50 less gives ${below.toFixed(2)}; 30 hires out of reach (most ${at30.maxAchievable.toFixed(1)} including other sources); 500 hires out of reach (most ${big.maxAchievable.toFixed(1)})`;
  });

  check('Expected hires from other sources: a fixed line, counted towards the target, not in the rows', () => {
    const monthly = RAC.assumptions.get(A, 'other_hires_monthly', 'SMR');
    const out = [];
    for (const share of [0, 0.4]) {
      const plans = [60000, 120000].map(budget => RAC.plan.build('SMR', { ...SEPT, budget, otherHiresShare: share }, env));
      plans.forEach(p => {
        near(p.totals.otherHires, (1 - share) * monthly, 1e-12, `share ${share}: expected hires from other sources`);
        near(p.totals.allHires, p.totals.hires + p.totals.otherHires, 1e-12, `share ${share}: all hires`);
        near(p.locations.reduce((a, l) => a + l.hires, 0), p.totals.hires, 1e-9, `share ${share}: location rows add up to paid-media hires only`);
        near(RAC.PLATFORMS.reduce((a, pl) => a + p.platforms[pl].hires, 0), p.totals.hires, 1e-9, `share ${share}: platform rows add up to paid-media hires only`);
        assert(p.totals.range.allHires.low <= p.totals.allHires && p.totals.range.allHires.high >= p.totals.allHires, 'all-hires range does not contain the figure');
        const wPaid = p.totals.range.hires.high - p.totals.range.hires.low;
        const wAll = p.totals.range.allHires.high - p.totals.range.allHires.low;
        assert(share === 1 || wAll > wPaid + 1e-9, `share ${share}: the range does not include the other-source monthly spread`);
      });
      assert(Math.abs(plans[0].totals.otherHires - plans[1].totals.otherHires) < 1e-12, 'expected hires from other sources moved with the budget');
      assert(plans[1].totals.hires > plans[0].totals.hires, 'paid-media hires did not rise with the budget');
      const target = RAC.plan.build('SMR', { ...SEPT, hireTarget: 25, otherHiresShare: share }, env);
      const at = RAC.plan.build('SMR', { ...SEPT, hireTarget: 25, otherHiresShare: share, budget: target.budgetForTarget }, env);
      const below = RAC.plan.build('SMR', { ...SEPT, hireTarget: 25, otherHiresShare: share, budget: target.budgetForTarget - 50 }, env);
      assert(at.totals.hires >= 25 - at.totals.otherHires - 1e-9 && below.totals.hires < 25 - at.totals.otherHires, `share ${share}: budget did not solve for the remainder (${at.totals.hires} paid-media hires)`);
      out.push(`share ${share * 100}%: ${at.totals.otherHires.toFixed(2)} from other sources, £${target.budgetForTarget} for 25 hires (paid media ${at.totals.hires.toFixed(2)}); all-hires range ${at.totals.range.allHires.low.toFixed(1)} to ${at.totals.range.allHires.high.toFixed(1)}`);
    }
    const easy = RAC.plan.build('SMR', { ...SEPT, hireTarget: 5 }, env);
    assert(easy.otherSourcesMeetTarget && easy.budgetForTarget === Math.ceil(easy.holdbacks.total / 50) * 50, 'a target below the other-source hires should need only the hold-backs');
    return out.join('; ') + `; a target of 5 is met by other sources alone (budget £${easy.budgetForTarget}, the hold-backs)`;
  });

  check('Credited share: changes hires and budget, not the split; 100% equals the earlier full scaling', () => {
    const none = RAC.plan.build('SMR', { ...SEPT, otherHiresShare: 0 }, env);
    const half = RAC.plan.build('SMR', { ...SEPT, otherHiresShare: 0.5 }, env);
    for (const l of none.locations) for (const p of P) {
      const h = half.locations.find(x => x.region === l.region).cells[p];
      near(h.spend, l.cells[p].spend, 1e-6, `${l.region} ${p} spend moved with the share`);
      if (l.cells[p].hires > 0) near(h.hires / l.cells[p].hires, half.factors.recon / none.factors.recon, 1e-9, `${l.region} ${p} credited hires not in proportion to predicted hires`);
      near(h.hiresPlatform + h.hiresCredited, h.hires, 1e-9, `${l.region} ${p} hires split`);
    }
    const n25 = RAC.plan.build('SMR', { ...SEPT, hireTarget: 25, otherHiresShare: 0 }, env).budgetForTarget;
    const h25 = RAC.plan.build('SMR', { ...SEPT, hireTarget: 25, otherHiresShare: 0.5 }, env).budgetForTarget;
    assert(h25 < n25, `crediting a share did not lower the budget for 25 hires (£${n25} to £${h25})`);
    assert(half.totals.allHires > none.totals.allHires, 'crediting a share did not raise total hires');
    // The earlier scaling: every hire Eploy recorded / the model's past hires,
    // worked out fresh, applied to paid media with no separate line.
    const rec = RAC.testing.reconciliation(env.ds, eploy, A, 'SMR');
    const earlier = { paid_hire_reconciliation_factor: { SMR: rec.factor }, other_hires_credit_factor: { SMR: 0 },
      other_hires_monthly: { SMR: 0 }, other_hires_low: { SMR: 0 }, other_hires_high: { SMR: 0 } };
    const out = [];
    for (const [name, e] of [['live data', env], ['plan 2a data', env2a]]) {
      const full = RAC.plan.build('SMR', { ...SEPT, otherHiresShare: 1 }, e);
      const old = RAC.plan.build('SMR', { ...SEPT, otherHiresShare: 0, overrides: earlier }, e);
      assert(full.totals.otherHires === 0, 'at 100% there should be no separate line');
      near(full.factors.recon, rec.factor, 1e-4, `${name}: factor at 100%`);
      near(full.totals.hires / old.totals.hires, 1, 1e-4, `${name}: hires at 100% against the earlier scaling`);
      near(full.totals.allHires / old.totals.allHires, 1, 1e-4, `${name}: all hires at 100% against the earlier scaling`);
      near(full.totals.apps, old.totals.apps, 1e-6, `${name}: applications`);
      assert(Math.abs(full.budgetForTarget - old.budgetForTarget) <= 50, `${name}: budget for 30 hires £${full.budgetForTarget} against £${old.budgetForTarget}`);
      out.push(`${name}: ${full.totals.hires.toFixed(2)} hires at 100% against ${old.totals.hires.toFixed(2)} under the earlier scaling (x${rec.factor.toFixed(4)}), £${full.budgetForTarget} against £${old.budgetForTarget}`);
    }
    return `split unchanged by the share; 25 hires £${n25} at 0%, £${h25} at 50%; ` + out.join('; ');
  });

  check('A plan does not depend on what was built before it', () => {
    const first = JSON.stringify(RAC.plan.build('SMR', SEPT, env).totals, (k, v) => (k === 'cellsList' ? undefined : v));
    RAC.plan.build('Patrol', { ...SEPT, bench: { mode: 'last3' }, capMultiple: 1 }, { ds: D.Patrol.ds, A, eploy });
    RAC.plan.build('SMR', { ...SEPT, bench: 'all', capMultiple: 3 }, env);
    RAC.plan.build('SMR', { ...SEPT, overrides: { remaining_error_factor: { SMR: 1.5 } } }, env);
    RAC.plan.build('SMR', { ...SEPT, otherHiresShare: 0.7 }, env);
    const again = JSON.stringify(RAC.plan.build('SMR', SEPT, env).totals, (k, v) => (k === 'cellsList' ? undefined : v));
    assert(first === again, 'the SMR plan changed after other plans were built');
    const fresh = loadPlanner();
    const clean = JSON.stringify(fresh.plan.build('SMR', SEPT, { ds: calibrationData(fresh).SMR.ds, A: fresh.assumptions.parse(readRoot('assumptions.csv')), eploy }).totals, (k, v) => (k === 'cellsList' ? undefined : v));
    assert(first === clean, 'the SMR plan differs from a clean load');
    const changed = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1 }, env).totals.hires;
    assert(Math.abs(changed - RAC.plan.build('SMR', SEPT, env).totals.hires) > 0.01, 'changing the multiple did not change the plan');
    const over = RAC.plan.build('SMR', { ...SEPT, overrides: { remaining_error_factor: { SMR: 1.5 } } }, env).totals.apps;
    assert(over < RAC.plan.build('SMR', SEPT, env).totals.apps, 'a per-plan override did not reach the plan');
    return 'identical after building Patrol, another window, another multiple and an override in between, and identical to a clean load';
  });

  check('Changing the data changes the plan (no stale results)', () => {
    const before = RAC.plan.build('SMR', SEPT, env).totals.apps;
    const D2 = structuredClone(env.ds.DATA);
    Object.values(D2.indeed).forEach(c => { if (c.monthly && c.monthly['2026-06']) c.monthly['2026-06'].completes *= 2; });
    const ds2 = RAC.data.snapshot(D2, env.ds.bench, env.ds.repo);
    const after = RAC.plan.build('SMR', SEPT, { ...env, ds: ds2 }).totals.apps;
    assert(Math.abs(after - before) > 1, 'plan did not move when June Indeed applications doubled');
    return `applications ${before.toFixed(1)} to ${after.toFixed(1)} when June Indeed applications doubled`;
  });
}
