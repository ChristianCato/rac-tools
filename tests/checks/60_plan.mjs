// Checks for spending caps (C1 to C5), cost limits (D6), the allocation and the
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

  check('No location or platform goes above its spending cap, whatever the minimums say', () => {
    let n = 0;
    const cases = [SEPT, { ...SEPT, budget: 250000 }, { ...SEPT, regionMin: { Scotland: 9000 } },
      { ...SEPT, regionMin: { Scotland: 9000 }, platMax: { appcast: 500 } },
      { ...SEPT, comboMin: { Scotland: { google: 20000 } }, platMin: { meta: 90000 } }];
    for (const inputs of cases) {
      const plan = RAC.plan.build('SMR', inputs, env);
      for (const c of cells(plan)) {
        n++;
        assert(c.spend <= c.cap + 0.01, `${c.region} ${c.platform} £${c.spend.toFixed(2)} above its cap £${c.cap.toFixed(2)}`);
        assert(c.aboveLimitByInstruction === 0, `${c.region} ${c.platform} recorded above its cap`);
        assert(c.spend >= 0, `${c.region} ${c.platform} negative spend £${c.spend}`);
        if (!c.on) assert(c.spend === 0, `${c.region} ${c.platform} switched off but funded`);
      }
      near(plan.holdbacks.total + plan.placed + plan.unplaced.total, inputs.budget, 0.01, 'budget conserved');
      for (const l of plan.locations) {
        const max = inputs.regionMax[l.region];
        const min = (inputs.regionMin || {})[l.region] || 0;
        if (min > (max === RAC.plan.NO_SPEND ? 0 : max > 0 ? max : Infinity)) {
          assert(plan.steps.some(s => s.region === l.region && /above its maximum; the minimum was applied/.test(s.reason)), `${l.region}: conflicting minimum not recorded`);
        } else if (max === RAC.plan.NO_SPEND) assert(l.spend === 0, l.region + ' set to no spend but funded');
        else if (max > 0) assert(l.spend <= max + 0.01, `${l.region} above its maximum`);
      }
    }
    // Scotland's minimum is above everything its caps allow: every platform
    // sits at its cap and the shortfall is reported, not spent above the caps.
    const pinned = RAC.plan.build('SMR', { ...SEPT, regionMin: { Scotland: 9000 } }, env);
    const sc = pinned.locations.find(l => l.region === 'Scotland');
    const capacity = P.reduce((a, p) => a + sc.cells[p].cap, 0);
    assert(capacity < 9000, `test needs Scotland's caps below £9,000 (${capacity})`);
    // (Appcast sits under September's £5,000 Appcast maximum.)
    P.filter(p => p !== 'appcast').forEach(p => near(sc.cells[p].spend, sc.cells[p].cap, 0.01, `Scotland ${p} should be at its cap`));
    const s = pinned.minimumShortfalls.find(x => x.kind === 'location' && x.region === 'Scotland');
    assert(s, 'Scotland shortfall not reported');
    near(s.placed, sc.spend, 0.01, 'placed');
    near(s.short, 9000 - sc.spend, 0.01, 'short');
    assert(s.because === 'spending caps' && /^Scotland minimum £9,000, placed £[\d,]+, short by £[\d,]+ because of spending caps$/.test(s.text), s.text);
    // Money trimmed by a platform maximum does not go above the other platforms' caps either.
    const trimmed = RAC.plan.build('SMR', { ...SEPT, regionMin: { Scotland: 9000 }, platMax: { appcast: 500 } }, env);
    const t = trimmed.minimumShortfalls.find(x => x.kind === 'location' && x.region === 'Scotland');
    assert(t && t.short > s.short - 0.01, 'trimmed Scotland shortfall');
    // Floors and platform minimums stop at the caps and say so.
    const floors = RAC.plan.build('SMR', { ...SEPT, comboMin: { Scotland: { google: 20000 } }, platMin: { meta: 90000 } }, env);
    const kinds = floors.minimumShortfalls.map(x => x.kind).sort().join();
    assert(kinds === 'floor,platform', 'floor and platform minimum shortfalls: ' + kinds);
    // A minimum the caps allow is met in full.
    const LOW = { ...SEPT, budget: 50000 };
    const nwBase = RAC.plan.build('SMR', LOW, env).locations.find(l => l.region === 'North West');
    const nwMin = Math.floor(P.reduce((a, p) => a + nwBase.cells[p].cap, 0) * 0.95);
    assert(nwMin > nwBase.spend + 100, 'test minimum should be above North West\'s share');
    const ok = RAC.plan.build('SMR', { ...LOW, regionMin: { 'North West': nwMin } }, env);
    const nw = ok.locations.find(l => l.region === 'North West');
    assert(!ok.minimumShortfalls.length && nw.spend >= nwMin - 0.01, `North West £${nw.spend} with shortfalls ${ok.minimumShortfalls.map(x => x.text)}`);
    return `${n} location and platform rows checked, none above its cap or below zero; ${s.text}; with Appcast held to £500: ${t.text}; ${floors.minimumShortfalls.map(x => x.text).join('; ')}; a £${nwMin} North West minimum (95% of its caps, on a £50,000 budget) was met`;
  });

  check('Spending caps match a direct calculation from the data and Eploy', () => {
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
    // 25 hires: at the agreed defaults 30 SMR hires were out of reach within the spending caps.
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
      other_hires_monthly: { SMR: 0 } };
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

  check('Core Setup fields reach the plan and are recorded with their defaults', () => {
    const plain = RAC.plan.build('SMR', SEPT, env);
    const set = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1.5, otherHiresShare: 0.25, otherHiresMonthly: 12, remainingError: 1.2, includeSettling: true }, env);
    const byKey = (p) => Object.fromEntries(p.settings.map(x => [x.key, x]));
    const a = byKey(plain), b = byKey(set);
    assert(Object.keys(a).join() === 'capMultiple,otherHiresShare,otherHiresMonthly,remainingError,includeSettling', 'fields ' + Object.keys(a));
    near(a.remainingError.default, RAC.assumptions.get(A, 'remaining_error_factor', 'SMR'), 0, 'adjustment default is the tested value');
    near(a.otherHiresMonthly.default, RAC.assumptions.get(A, 'other_hires_monthly', 'SMR'), 0, 'other-source default is the tested value');
    assert(a.includeSettling.value === false && a.includeSettling.default === false, 'include settling should be off by default');
    assert(b.capMultiple.value === 1.5 && b.otherHiresShare.value === 0.25 && b.otherHiresMonthly.value === 12 && b.remainingError.value === 1.2 && b.includeSettling.value === true, 'values not recorded');
    assert(Object.values(b).every(x => x.changed), 'changed flags');
    near(set.totals.otherHires, 0.75 * 12, 1e-12, 'edited other-source hires');
    near(set.factors.bias, 1.2, 0, 'edited adjustment');
    const c = set.locations[0].cells.indeed;
    near(c.remainingError, 1.2, 0, 'adjustment reaches the rows');
    assert(set.settlingUsed.length === 1 && set.settlingUsed[0].month === '2026-08' && /not yet settled, figures may change/.test(set.settlingUsed[0].note), 'August not flagged: ' + JSON.stringify(set.settlingUsed));
    assert(plain.settlingUsed.length === 0 && !plain.windowMonths.includes('2026-08'), 'August used with the option off');
    const bad = RAC.plan.build('SMR', { ...SEPT, capMultiple: 7, remainingError: 9, otherHiresMonthly: -1 }, env);
    const bk = byKey(bad);
    assert(bk.capMultiple.value === 1 && bk.remainingError.value === bk.remainingError.default && bk.otherHiresMonthly.value === bk.otherHiresMonthly.default, 'out-of-range values should fall back to the defaults');
    return `defaults: multiple ${a.capMultiple.default}, share ${a.otherHiresShare.default}, other sources ${a.otherHiresMonthly.default} a month (since ${plain.otherSources.recentFrom}: ${plain.otherSources.recentMean.toFixed(2)}), adjustment ${a.remainingError.default}; with the option on, August counted and flagged`;
  });

  check('Matching factor to platform hires applies at every share, including 0%', () => {
    const paid = RAC.assumptions.get(A, 'paid_hire_reconciliation_factor', 'SMR');
    const credit = RAC.assumptions.get(A, 'other_hires_credit_factor', 'SMR');
    for (const share of [0, 0.3, 1]) {
      const p = RAC.plan.build('SMR', { ...SEPT, otherHiresShare: share }, env);
      near(p.factors.recon, paid + share * credit, 1e-12, `share ${share}`);
      const c = p.locations[0].cells.indeed;
      near(c.hiresPlatform, c.hires * paid / (paid + share * credit), 1e-9, `share ${share}: platform-matched part`);
    }
    return `x${paid} at 0%, plus the credited share x${credit}`;
  });

  check('Hire ranges come from the counts behind the rates, and thin rows are flagged', () => {
    const plan = RAC.plan.build('SMR', SEPT, env);
    const t = plan.totals.range;
    assert(!('range_hires_low' in A.values), 'the tested hire misses should no longer set ranges');
    assert(t.hires.low < plan.totals.hires && t.hires.high > plan.totals.hires, 'paid range does not contain the figure');
    assert(t.allHires.low < plan.totals.allHires && t.allHires.high > plan.totals.allHires, 'all-hires range does not contain the figure');
    // The plan-level rate rests mostly on the hires matched to the platforms.
    const P0 = plan.hireRangeBasis.paidHires;
    assert(t.hires.rateSd > 0.5 / Math.sqrt(P0) && t.hires.rateSd < 2.5 / Math.sqrt(P0), `rate uncertainty ${t.hires.rateSd} against 1/sqrt(${P0})`);
    // The same plan gives the same range.
    const fresh = loadPlanner();
    const x = fresh.plan.build('SMR', SEPT, { ds: calibrationData(fresh).SMR.ds, A: fresh.assumptions.parse(readRoot('assumptions.csv')), eploy }).totals.range.hires;
    assert(x.low === t.hires.low && x.high === t.hires.high, 'the same plan gave a different range on a fresh load');
    // Fewer hires behind the rates: a wider rate uncertainty.
    const thinEploy = { ...eploy, cells: eploy.cells.map(c => [c[0], c[1], c[2], c[3], Math.round(c[4] / 5), Math.round(c[5] / 5), Math.round(c[6] / 5)]), dataset: { ...eploy.dataset, file: 'thin' } };
    const thin = RAC.plan.build('SMR', SEPT, { ...env, eploy: thinEploy });
    assert(thin.totals.range.hires.rateSd > t.hires.rateSd * 1.5, `thin evidence ${thin.totals.range.hires.rateSd} against ${t.hires.rateSd}`);
    const flagged = plan.locations.filter(l => l.range && l.range.hires.lowConfidence);
    flagged.forEach(l => assert(l.range.hires.reasons.length > 0, l.region + ' flagged without a reason'));
    const cellFlags = plan.locations.flatMap(l => P.map(p => l.cells[p])).filter(c => c.range && c.range.hires && c.range.hires.lowConfidence).length;
    assert(cellFlags > 0, 'no location and platform row was flagged low confidence');
    return `paid ${t.hires.low.toFixed(1)} to ${t.hires.high.toFixed(1)} (rate uncertainty ${(t.hires.rateSd * 100).toFixed(0)}% on ${P0} matched hires; ${(thin.totals.range.hires.rateSd * 100).toFixed(0)}% on a fifth of the counts); all hires ${t.allHires.low.toFixed(1)} to ${t.allHires.high.toFixed(1)}; low confidence: ${flagged.map(l => l.region).join(', ') || 'no locations'}, ${cellFlags} location and platform rows`;
  });

  check('Hire ranges include chance variation in the number of hires', () => {
    const plan = RAC.plan.build('SMR', SEPT, env);
    const t = plan.totals.range.hires;
    // Whole-number counts, wider than the rate and application uncertainty alone.
    assert(t.high - t.low > t.expectedHigh - t.expectedLow, `paid ${t.low} to ${t.high} not wider than ${t.expectedLow} to ${t.expectedHigh}`);
    // A row with well under one hire: a count of zero is within its range.
    const small = cells(plan).filter(c => c.spend > 0 && c.hires > 0 && c.hires < 0.5);
    assert(small.length > 0, 'no small row to check');
    small.forEach(c => assert(c.range.hires.low === 0, `${c.region} ${c.platform}: ${c.hires.toFixed(2)} hires, range from ${c.range.hires.low}`));
    // Chance alone on the total: a Poisson count around the expected hires has
    // a 10th to 90th percentile width of about 2.56 x sqrt(hires).
    const poissonOnly = 2 * 1.2816 * Math.sqrt(plan.totals.hires);
    assert(t.high - t.low >= poissonOnly * 0.8, `paid width ${t.high - t.low} below chance alone ${poissonOnly}`);
    // Other sources: the monthly counts varied by more than chance; the range covers at least chance.
    const o = plan.totals.range.otherHires, e = plan.totals.otherHires;
    assert(o.high - o.low >= 2 * 1.2816 * Math.sqrt(e) * 0.8, `other-source width ${o.high - o.low} for ${e}`);
    return `paid ${plan.totals.hires.toFixed(1)}: ${t.low} to ${t.high} with chance variation (${t.expectedLow.toFixed(1)} to ${t.expectedHigh.toFixed(1)} without); ` +
      `other sources ${e.toFixed(1)}: ${o.low} to ${o.high}; all ${plan.totals.allHires.toFixed(1)}: ${plan.totals.range.allHires.low} to ${plan.totals.range.allHires.high}; ${small.length} rows under half a hire start at 0`;
  });

  check('Target out of reach: most hires, the budget where hires stop rising, and multiples 1 to 3', () => {
    const plan = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1 }, env);
    assert(plan.unreachable && plan.reach, 'expected 30 hires out of reach at multiple 1');
    const at = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1, budget: plan.saturationBudget, noReach: true }, env);
    near(at.totals.allHires, plan.maxAchievable, 0.02, 'hires at the budget where they stop rising');
    const more = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1, budget: plan.saturationBudget + 20000, noReach: true }, env);
    near(more.totals.allHires, plan.maxAchievable, 0.02, 'hires above that budget');
    assert(more.unplaced.total > 19000, 'extra budget should be unplaced');
    const below = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1, budget: plan.saturationBudget - 2000, noReach: true }, env);
    assert(below.totals.allHires < plan.maxAchievable - 0.01, 'hires should still rise below that budget');
    assert(plan.reach.byMultiple.map(x => x.multiple).join() === '1,2,3', 'multiples');
    for (const r of plan.reach.byMultiple) {
      const q = RAC.plan.build('SMR', { ...SEPT, capMultiple: r.multiple, noReach: true }, env);
      near(r.hiresAtBudget, q.totals.allHires, 1e-9, `multiple ${r.multiple} hires`);
      near(r.unplacedAtBudget, q.unplaced.total, 1e-6, `multiple ${r.multiple} unplaced`);
      if (r.budgetForTarget !== null) assert(r.budgetForTarget === q.budgetForTarget && !q.unreachable, `multiple ${r.multiple} budget`);
      else assert(q.unreachable && r.mostHires === q.maxAchievable && r.saturationBudget === q.saturationBudget, `multiple ${r.multiple} most hires`);
    }
    return plan.reach.byMultiple.map(r => `x${r.multiple}: ${r.hiresAtBudget.toFixed(1)} hires at £${SEPT.budget}, £${r.unplacedAtBudget.toFixed(0)} not placed, ` +
      (r.budgetForTarget ? `30 hires at £${r.budgetForTarget}` : `most ${r.mostHires.toFixed(1)} hires, reached at £${r.saturationBudget}`)).join('; ');
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

  check('Efficiency: at 0 the split is by open roles; above 0 it moves towards where hires cost least', () => {
    const at = (w) => RAC.plan.build('SMR', { ...SEPT, efficiency: w }, env);
    const plain = at(0), half = at(0.5), full = at(1);
    // At 0 nothing changes, and the record says so.
    assert(plain.efficiency.weight === 0 && plain.efficiency.byLocation.length === 0, 'the split moved at 0');
    // Every share still adds up, and the budget is still conserved.
    [half, full].forEach(q => {
      const sum = q.efficiency.byLocation.reduce((a, x) => a + x.share, 0);
      near(sum, 1, 1e-9, 'the shares at ' + q.efficiency.weight);
      assert(q.totals.spend <= q.deployable + 0.01, 'budget conservation at ' + q.efficiency.weight);
    });
    // The cheapest location gains and the dearest loses.
    const rows = full.efficiency.byLocation.filter(x => x.cphAtOpenRoles).slice().sort((a, b) => a.cphAtOpenRoles - b.cphAtOpenRoles);
    assert(rows.length > 1, 'need more than one location with a cost per hire');
    const cheapest = rows[0], dearest = rows[rows.length - 1];
    assert(cheapest.byEfficiency > cheapest.openRoles, `${cheapest.region} is cheapest but did not gain`);
    assert(dearest.byEfficiency < dearest.openRoles, `${dearest.region} is dearest but did not lose`);
    // Halfway is halfway.
    const h = half.efficiency.byLocation.find(x => x.region === cheapest.region);
    near(h.share, (h.openRoles + h.byEfficiency) / 2, 1e-9, 'halfway share');
    // It buys hires, or the setting would be pointless, and it stays inside the caps.
    assert(full.totals.hires >= plain.totals.hires - 1e-9, `hires fell from ${plain.totals.hires} to ${full.totals.hires}`);
    full.locations.forEach(l => assert(l.spend <= l.cap + 0.01, `${l.region} above its cap at 100%`));
    return `0%: ${plain.totals.hires.toFixed(2)} paid-media hires on the open-roles split; 100%: ${full.totals.hires.toFixed(2)}, ` +
      `${cheapest.region} (cheapest, £${cheapest.cphAtOpenRoles.toFixed(0)} a hire) ${Math.round(cheapest.openRoles * 100)}% to ${Math.round(cheapest.byEfficiency * 100)}%, ` +
      `${dearest.region} (dearest, £${dearest.cphAtOpenRoles.toFixed(0)}) ${Math.round(dearest.openRoles * 100)}% to ${Math.round(dearest.byEfficiency * 100)}%`;
  });
}
