// Checks for testing on past months (D1, D2, D5) and the tested values.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';

const WINDOW = { mode: 'last3up', mult: 2 };

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const DATA = calibrationData(RAC);
  const results = JSON.parse(readRoot('data/backtest_results.json'));
  const fresh = {};
  for (const role of RAC.ROLES) fresh[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy);

  check('Testing predicts each month from earlier months only', () => {
    const ds = DATA.SMR.ds;
    const M = '2026-05';
    const params = { bRole: 0.7, k: 20 };
    const before = RAC.backtest.predictMonth(ds, A, 'SMR', M, params, RAC.backtest.makeCache(ds, A, 'SMR', WINDOW));
    // Scramble the month's own applications and everything after it.
    const D = structuredClone(ds.DATA);
    for (const p of RAC.PLATFORMS) for (const c of Object.values(D[p])) {
      for (const [mo, x] of Object.entries(c.monthly || {})) {
        if (mo === M) x.completes = x.completes * 7 + 3;
        if (mo > M) { x.completes = x.completes * 5 + 1; x.spend = x.spend * 3 + 10; }
      }
    }
    const ds2 = RAC.data.snapshot(D, ds.bench, ds.repo);
    const after = RAC.backtest.predictMonth(ds2, A, 'SMR', M, params, RAC.backtest.makeCache(ds2, A, 'SMR', WINDOW));
    assert(before.length === after.length && before.length > 10, 'cell count changed');
    before.forEach((c, i) => assert(Math.abs(c.predicted - after[i].predicted) < 1e-9, `${c.region} ${c.plat} prediction moved when later data changed`));
    assert(before.some((c, i) => c.actual !== after[i].actual), 'the scramble did not change the actuals');
    return `${before.length} predictions for ${M} unchanged after its own and later figures were scrambled`;
  });

  check('Plan ranges are PERCENTILE.INC of the misses, and rows are at least as wide', () => {
    const out = [];
    const lo = RAC.assumptions.get(A, 'range_low_percentile'), hi = RAC.assumptions.get(A, 'range_high_percentile');
    for (const role of RAC.ROLES) {
      const r = results.roles[role];
      // PERCENTILE.INC written out again here: sort, then interpolate.
      const inc = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); const k = (s.length - 1) * q, f = Math.floor(k); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f); };
      const am = r.applications.map(o => o.miss);
      near(RAC.assumptions.get(A, 'range_apps_low', role), inc(am, lo), 2e-4, role + ' applications low');
      near(RAC.assumptions.get(A, 'range_apps_high', role), inc(am, hi), 2e-4, role + ' applications high');
      const total = { low: inc(am, lo), high: inc(am, hi), sigma: RAC.assumptions.get(A, 'range_apps_sigma', role) };
      for (const [n, S, Su, se] of [[1, 5000, 1000, 0.1], [30, 2000, 2000, 0.05], [5000, 1000, 1000, 0]]) {
        const w = RAC.backtest.widen(total, RAC.assumptions.get(A, 'row_widen_apps', role), n, S, Su, se);
        const b = RAC.backtest.band(total, w);
        assert(w >= 1 && b.low <= total.low + 1e-12 && b.high >= total.high - 1e-12, `${role} row range narrower than the total (evidence ${n})`);
      }
      // Evidence for widening counts the blend's prior, so a row with no
      // applications of its own is not treated as resting on one.
      const ctx = RAC.cost.context(DATA[role].ds, A, role, WINDOW);
      assert(RAC.backtest.widenEvidence(ctx, 0) === RAC.assumptions.get(A, 'cpa_prior_apps') && RAC.backtest.widenEvidence(ctx, 100) === 100 + ctx.K, 'widening evidence');
      const wNone = RAC.backtest.widen(total, RAC.assumptions.get(A, 'row_widen_apps', role), RAC.backtest.widenEvidence(ctx, 0), 1000, 1000, 0);
      assert(wNone < 10, `${role}: a row with no applications widens ${wNone.toFixed(1)} times`);
      out.push(`${role}: applications ${(total.low * 100).toFixed(1)}% to +${(total.high * 100).toFixed(1)}% over ${am.length} months; a row with no applications of its own widens ${wNone.toFixed(1)} times`);
    }
    return out.join('; ');
  });

  check('Tested figures in assumptions.csv match a fresh run of the tests', () => {
    const stale = [];
    // Rows with source "tested": the value and the tested column are the fresh
    // figure. Rows "agreed, informed by tests": the tested column is.
    const cmp = (key, role, value, tol = 1e-4) => {
      const e = RAC.assumptions.entry(A, key, role);
      const v = e.source === 'tested' ? e.parsed : e.testedValue;
      if (!(Math.abs(v - value) <= tol)) stale.push(`${key} ${role || ''}: file ${v}, fresh ${value}`);
      if (e.source === 'tested' && e.testedValue !== e.parsed) stale.push(`${key} ${role}: tested column ${e.testedValue} differs from the value ${e.parsed}`);
    };
    for (const role of RAC.ROLES) {
      const bt = fresh[role];
      cmp('d1_role_rate', role, bt.final.tested.bRole);
      cmp('d1_prior_strength', role, bt.final.tested.k);
      cmp('remaining_error_factor', role, bt.final.tested.bias);
      // The agreed rule for the adjustment.
      const used = RAC.assumptions.get(A, 'remaining_error_factor', role);
      const rule = bt.final.rule.same ? bt.final.tested.bias : 1;
      if (Math.abs(used - rule) > 1e-4) stale.push(`remaining_error_factor ${role}: value ${used}, rule gives ${rule}`);
      cmp('range_apps_low', role, bt.appsRange.low);
      cmp('range_apps_high', role, bt.appsRange.high);
      cmp('row_widen_apps', role, bt.rowWiden.c);
      const t = RAC.testing.blendStrengths(eploy, A, role);
      ['screen_blend_n', 'location_screen_blend_n', 'region_hire_blend_n'].forEach(k => cmp(k, role, t[k].value));
      const rec = RAC.testing.reconciliation(DATA[role].ds, eploy, A, role);
      cmp('paid_hire_reconciliation_factor', role, rec.paidFactor, 6e-5);
      cmp('other_hires_credit_factor', role, rec.otherFactor, 6e-5);
      cmp('other_hires_monthly', role, rec.otherMean, 6e-5);
    }
    assert(!stale.length, 'assumptions.csv is out of date; run node tools/calibrate.mjs --write and review:\n' + stale.join('\n'));
    return 'blend strengths, reconciliation, other-source hires, diminishing returns, adjustment, ranges and row widening all match';
  });

  check('Agreed settings for this release are in place, with the tested figure beside each', () => {
    const want = { screen_blend_n: 200, location_screen_blend_n: 100000, region_hire_blend_n: 100000, d1_role_rate: 0.65, d1_prior_strength: 100000 };
    const out = [];
    for (const [key, v] of Object.entries(want)) for (const role of RAC.ROLES) {
      const e = RAC.assumptions.entry(A, key, role);
      assert(e.source === RAC.assumptions.AGREED_TESTED && e.parsed === v, `${key} ${role}: ${e.parsed} (${e.source}), agreed ${v}`);
      assert(e.testedValue !== null, `${key} ${role}: no tested figure`);
      out.push(`${key} ${role} ${e.parsed} (tested ${e.testedValue})`);
    }
    const w = RAC.ROLES.map(r => RAC.assumptions.entry(A, 'row_widen_apps', r));
    assert(w.every(e => e.source === RAC.assumptions.AGREED_TESTED) && w[0].parsed === w[1].parsed, 'row widening should be one agreed value for both roles');
    // Kept only while each role's rows hold at least 70% of their misses (user, 17 Sep 2026).
    const held = RAC.ROLES.map(r => fresh[r].rowWiden.table.find(x => x.c === w[0].parsed).coverage);
    held.forEach((h, i) => assert(h >= 0.7, `row widening ${w[0].parsed}: ${RAC.ROLES[i]} rows held only ${(h * 100).toFixed(0)}% of their misses (below 70%: review)`));
    out.push(`row widening ${w[0].parsed} held SMR ${(held[0] * 100).toFixed(0)}%, Patrol ${(held[1] * 100).toFixed(0)}% of misses`);
    const ref = RAC.ROLES.map(r => RAC.assumptions.entry(A, 'remaining_error_factor', r));
    assert(ref.every(e => e.source === RAC.assumptions.AGREED_TESTED), 'remaining-error adjustment should follow the agreed rule');
    const months = Math.min(...RAC.ROLES.map(r => results.roles[r].sensitivity.backtest.testMonths));
    return `${out.join('; ')}; row widening ${w[0].parsed} (tested SMR ${w[0].testedValue}, Patrol ${w[1].testedValue}); adjustment ${ref.map((e, i) => `${RAC.ROLES[i]} ${e.parsed} (tested ${e.testedValue})`).join(', ')}; ${months} test months (switch needs ${RAC.assumptions.get(A, 'switch_min_test_months')})`;
  });

  check('Back-test results file matches a fresh run', () => {
    for (const role of RAC.ROLES) {
      const f = results.roles[role], bt = fresh[role];
      const hm = f.hiresCheck.months;
      assert(f.applications.length === bt.outer.length && hm.length === bt.hires.length, role + ' test month counts differ');
      f.applications.forEach((o, i) => near(o.miss, bt.outer[i].miss, 1e-4, `${role} ${o.month} miss`));
      hm.forEach((o, i) => near(o.miss, bt.hires[i].miss, 1e-4, `${role} ${o.month} hire miss`));
      const s = f.sensitivity;
      assert(s && s.backtest && s.blend, role + ' sensitivity missing');
      assert(s.backtest.leaveOneOut.length === bt.testable.length, role + ' leave-one-out months');
      s.backtest.leaveOneOut.forEach((x, i) => {
        const y = bt.stability.loo[i];
        assert(x.month === y.month && x.bRole === y.bRole && x.k === y.k && Math.abs(x.bias - y.bias) < 1e-4, `${role} leave-one-out ${x.month} differs`);
      });
    }
    return RAC.ROLES.map(r => `${r}: ${results.roles[r].applications.length} application months, ${results.roles[r].hiresCheck.months.length} hire check months; leave-one-out recorded`).join('; ');
  });

  check('Every test month has at least 5 settled months before it', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      const bt = fresh[role];
      const all = RAC.cost.context(DATA[role].ds, A, role, WINDOW).settled;
      bt.testable.forEach(M => assert(all.indexOf(M) >= 5, `${role} ${M} has ${all.indexOf(M)} earlier months`));
      assert(all.indexOf(bt.testable[0]) === 5, `${role} first test month ${bt.testable[0]}`);
      bt.hires.forEach(h => assert(h.learnedFrom.split(' to ').length === 2, 'hire check month'));
      out.push(`${role}: ${bt.testable[0]} to ${bt.testable[bt.testable.length - 1]}`);
    }
    return out.join('; ');
  });

  check('Poisson deviance is zero on a perfect prediction and grows with the miss', () => {
    const d = RAC.backtest.deviance;
    near(d(10, 10), 0, 1e-12, 'perfect');
    assert(d(10, 12) > 0 && d(10, 15) > d(10, 12) && d(0, 2) === 4, 'deviance ordering');
    return 'ok';
  });
}
