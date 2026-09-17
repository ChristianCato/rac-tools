// Checks for part months (D3) and the single cost per application method.
import path from 'node:path';
import fs from 'node:fs';
import { loadPlanner, loadAssumptions, ROOT } from '../lib/planner.mjs';
import { loadEngine, readGzJson } from '../lib/engine.mjs';
import { withRoleMonthly, septSmrSettings } from '../lib/fixtures.mjs';

const T = path.join(ROOT, 'tests');
const BASE = readGzJson(path.join(T, 'fixtures/rac_data_46aaae2.json.gz'));
const F2A = JSON.parse(fs.readFileSync(path.join(T, 'fixtures/smr_sept_plan_2a.json'), 'utf8'));
const FLIVE = JSON.parse(fs.readFileSync(path.join(T, 'fixtures/smr_sept_live_2026-09-16.json'), 'utf8'));
const LEGACY = fs.readFileSync(path.join(T, 'legacy/engine_46aaae2.js'), 'utf8');
const REPO = { generated_at: BASE.generated_at, current_through: BASE.data_current_through, months: BASE.data_months };
const PNAME = { indeed: 'Indeed', meta: 'Meta', google: 'Google', appcast: 'Appcast' };
const monthsOf = (f) => [...new Set(f.raw.map(r => r[0]))].sort();

// Data as plan 2a held it: SMR months from its workings, July cut at 24 July.
export function plan2aData(RAC) {
  const D = withRoleMonthly(BASE, F2A.raw, 'SMR');
  return RAC.data.snapshot(D, { at: '2026-07-24', months: monthsOf(F2A), lastDate: '2026-07-24' }, REPO);
}
// Data as the live app held it on 16 September (upload record without lastDate, as saved).
export function liveData(RAC, at = '2026-09-16') {
  const D = withRoleMonthly(BASE, FLIVE.raw, 'SMR');
  return RAC.data.snapshot(D, { at, months: monthsOf(FLIVE) }, REPO);
}

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const W = { mode: 'last3up', mult: 2 };

  check('Part months: plan 2a data leaves out July (cut at 24 July); June is still settling', () => {
    const ds = plan2aData(RAC);
    const st = RAC.data.monthStatus(ds, A);
    const settled = RAC.data.settledMonths(ds, A);
    assert(RAC.assumptions.get(A, 'data_settle_days') === 31, 'settle period should be the agreed 31 days');
    assert(!st['2026-07'].settled && !st['2026-07'].settling && /part month/.test(st['2026-07'].reason), 'July: ' + JSON.stringify(st['2026-07']));
    assert(!st['2026-06'].settled && st['2026-06'].settling, 'June should be still settling 24 days after month end: ' + JSON.stringify(st['2026-06']));
    assert(settled[settled.length - 1] === '2026-05', 'last settled month ' + settled[settled.length - 1]);
    const off = RAC.cost.context(ds, A, 'SMR', W);
    const on = RAC.cost.context(ds, A, 'SMR', W, { includeSettling: true });
    assert(!off.settled.includes('2026-06') && off.settlingUsed.length === 0, 'June counted with the option off');
    assert(on.settled.includes('2026-06') && !on.settled.includes('2026-07') && JSON.stringify(on.settlingUsed) === '["2026-06"]', 'option on: ' + on.settlingUsed);
    return `settled ${settled[0]} to ${settled[settled.length - 1]}; June: ${st['2026-06'].reason}; July: ${st['2026-07'].reason}; with the option on, June counts and is listed, July never does`;
  });

  check('Part months: repo data file alone leaves out July; 16 September data leaves out August', () => {
    const repo = RAC.data.snapshot(structuredClone(BASE), null, REPO);
    const s1 = RAC.data.settledMonths(repo, A);
    assert(s1[s1.length - 1] === '2026-05', 'repo file last settled ' + s1[s1.length - 1]);
    const live = liveData(RAC);
    const st = RAC.data.monthStatus(live, A);
    assert(!st['2026-08'].settled && st['2026-08'].settling && st['2026-07'].settled, 'August ' + JSON.stringify(st['2026-08']) + ' July ' + JSON.stringify(st['2026-07']));
    const sept30 = RAC.data.monthStatus(liveData(RAC, '2026-09-30'), A);
    const oct1 = RAC.data.monthStatus(liveData(RAC, '2026-10-01'), A);
    assert(!sept30['2026-08'].settled && oct1['2026-08'].settled, 'August should count from 1 October (31 days)');
    return `repo file (taken ${repo.repo.generated_at}): to ${s1[s1.length - 1]} (June: ${RAC.data.monthStatus(repo, A)['2026-06'].reason}); ` +
      `16 Sep data: August ${st['2026-08'].reason}; counts if the data is taken on or after 1 October`;
  });

  check('Part months are left out of cost per application, typical month and spend level', () => {
    const ds = plan2aData(RAC);
    const ctx = RAC.cost.context(ds, A, 'SMR', W);
    assert(!ctx.windowMonths.includes('2026-07'), 'July in window');
    for (const r of ds.regions) for (const p of RAC.PLATFORMS) {
      const s = RAC.cost.windowStats(ctx, p, r);
      assert(!s.months.includes('2026-07'), `${r} ${p} used July`);
    }
    // Change July's figures wildly: nothing may move.
    const D2 = structuredClone(ds.DATA);
    Object.values(D2.indeed).forEach(c => { if (c.monthly && c.monthly['2026-07']) c.monthly['2026-07'].spend *= 50; });
    const ds2 = RAC.data.snapshot(D2, ds.bench, ds.repo);
    const ctx2 = RAC.cost.context(ds2, A, 'SMR', W);
    for (const r of ds.regions) {
      const a = RAC.cost.usualCpa(ctx, 'indeed', r).cpa, b = RAC.cost.usualCpa(ctx2, 'indeed', r).cpa;
      assert(a === b, `${r} Indeed moved when July changed: ${a} to ${b}`);
      assert(RAC.cost.usualSpend(ctx, 'indeed', r).spend === RAC.cost.usualSpend(ctx2, 'indeed', r).spend, r + ' spend level moved');
    }
    assert(RAC.cost.typicalMonth(ctx, 'indeed') === RAC.cost.typicalMonth(ctx2, 'indeed'), 'typical month moved');
    assert(ds.stamp !== ds2.stamp, 'data stamp did not change with the data');
    return 'window ' + ctx.windowMonths.join(', ') + '; changing July moved nothing';
  });

  check('Usual cost per application matches a direct calculation from plan 2a rows', () => {
    const ds = plan2aData(RAC);
    const ctx = RAC.cost.context(ds, A, 'SMR', W);
    // Independent calculation straight from the fixture rows.
    const months = ctx.settled, last = months[months.length - 1];
    const wt = (mo) => mo.slice(0, 4) !== last.slice(0, 4) ? 0 : (months.indexOf(mo) >= months.length - 3 ? 2 : 1);
    const N = months.filter(mo => wt(mo) > 0).length;
    const stats = (region, plat) => {
      let s = 0, a = 0, ws = 0;
      F2A.raw.filter(x => x[1] === region && x[2] === PNAME[plat] && months.includes(x[0]) && wt(x[0]) > 0)
        .forEach(x => { s += wt(x[0]) * (x[3] || 0); a += wt(x[0]) * (x[4] || 0); ws += wt(x[0]); });
      return ws > 0 ? { s: s * N / ws, a: a * N / ws } : { s: 0, a: 0 };
    };
    let worst = 0, n = 0;
    for (const plat of RAC.PLATFORMS) {
      let ps = 0, pa = 0;
      ds.regions.forEach(r => { const x = stats(r, plat); if (x.a > 0) { ps += x.s; pa += x.a; } });
      const pcpa = pa > 0 ? (ps + 35 * 48.2) / (pa + 35) : 48.2;
      for (const r of ds.regions) {
        const x = stats(r, plat);
        const want = x.a > 0 ? (x.s + 35 * pcpa) / (x.a + 35) : pcpa;
        const got = RAC.cost.usualCpa(ctx, plat, r).cpa;
        worst = Math.max(worst, Math.abs(got - want)); n++;
      }
    }
    near(worst, 0, 1e-9, 'largest gap');
    return `${n} location and platform figures matched to within £${worst.toExponential(1)}`;
  });

  check('With part months counted, the method equals the previous prediction blend', () => {
    // Settling switched off: every month counts, as in the previous version.
    const A0 = RAC.assumptions.withValues(A, { data_settle_days: 0 });
    const D = withRoleMonthly(BASE, F2A.raw, 'SMR');
    const ds = RAC.data.snapshot(D, { at: '2099-01-01', months: monthsOf(F2A) }, REPO);
    const ctx = RAC.cost.context(ds, A0, 'SMR', W);
    const E = loadEngine(LEGACY, withRoleMonthly(BASE, F2A.raw, 'SMR'));
    E.buildFundingPlan('SMR', septSmrSettings(E.NO_SPEND));   // sets the old engine's window
    let worst = 0, n = 0;
    for (const p of RAC.PLATFORMS) for (const r of ds.regions) {
      const a = RAC.cost.usualCpa(ctx, p, r).cpa, b = E.regionPlatformCPA(p, r, 'SMR').cpa;
      worst = Math.max(worst, Math.abs(a - b)); n++;
    }
    near(worst, 0, 1e-9, 'largest gap against the previous method');
    return `${n} figures equal to the previous method (largest gap £${worst.toExponential(1)})`;
  });

  check('No all-time fallback: a location with no window months takes the platform figure', () => {
    const ds = liveData(RAC, '2026-09-24');   // August counts, but is outside a window that ends in July
    const ctx = RAC.cost.context(ds, A, 'SMR', { mode: 'custom', from: '2026-01', to: '2026-07' });
    const y = RAC.cost.usualCpa(ctx, 'meta', 'Yorkshire & Humber');
    const pf = RAC.cost.platformCpa(ctx, 'meta');
    assert(y.apps === 0 && y.cpa === pf.cpa && y.source === 'platform', 'Yorkshire & Humber Meta: ' + JSON.stringify(y));
    return `Yorkshire & Humber Meta (August only) took the Meta figure, £${pf.cpa.toFixed(2)}`;
  });

  check('Cost figures do not depend on what was worked out before', () => {
    const ds = liveData(RAC);
    const first = RAC.cost.usualCpa(RAC.cost.context(ds, A, 'SMR', W), 'google', 'South East').cpa;
    RAC.cost.usualCpa(RAC.cost.context(ds, A, 'Patrol', { mode: 'last3' }), 'google', 'South East');
    RAC.cost.usualCpa(RAC.cost.context(ds, RAC.assumptions.withValues(A, { cpa_prior_apps: 500 }), 'SMR', 'all'), 'google', 'South East');
    const again = RAC.cost.usualCpa(RAC.cost.context(ds, A, 'SMR', W), 'google', 'South East').cpa;
    assert(first === again, `changed from ${first} to ${again}`);
    return `South East Google SMR £${first.toFixed(2)} before and after other roles and windows were worked out`;
  });
}
