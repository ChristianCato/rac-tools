// Runs the tests on past months and writes the results into assumptions.csv
// with today's date and the evidence in the notes.
//   - Rows with source "tested": the value and the tested column are set.
//   - Rows with source "agreed, informed by tests" (user decision,
//     17 September 2026): only the tested column and the notes are set; the
//     value stays as agreed. The notes say whether the switch rule is met
//     (at least switch_min_test_months test months, stable with any one month
//     left out). The switch itself is an edit to the file.
//   - remaining_error_factor follows its agreed rule: the tested figure only
//     if it stays on the same side of 1 with any one test month left out,
//     otherwise 1.
//
// Usage (from the repo folder):
//   node tools/calibrate.mjs                 show what the tests give; change nothing
//   node tools/calibrate.mjs --write         write the results into assumptions.csv
//   node tools/calibrate.mjs --only blend,recon
//
// Data used:
//   SMR and Patrol  the repo data file (rac_data.js), taken from the live app
//                   with August on 17 September 2026
//   Eploy           data/eploy_rates.json
// Once the Assumptions tab exists, the same tests run there on the app's
// current data, and show where this file is out of date.
//
// Steps, in the order they depend on each other:
//   blend   blend strengths for the hire calculation
//   recon   reconciliation of predicted hires to the hires Eploy credited to
//           the four platforms, and the hires it recorded from other sources
//   backtest  diminishing returns, remaining-error adjustment, ranges, row widening
import fs from 'node:fs';
import path from 'node:path';
import { loadPlanner, loadAssumptions, readRoot, ROOT } from '../tests/lib/planner.mjs';
import { calibrationData } from '../tests/lib/calibration_data.mjs';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const today = new Date().toISOString().slice(0, 10);

const RAC = loadPlanner();
let A = loadAssumptions(RAC);
if (!A.ok) { console.error('assumptions.csv has problems:\n' + A.errors.join('\n')); process.exit(1); }
const eploy = JSON.parse(readRoot('data/eploy_rates.json'));

const DATA = calibrationData(RAC);

const changes = [];   // { key, role, value (null: unchanged), tested, notes }
const sensitivity = {};   // leave-one-out results, written to data/backtest_results.json
const loo = (x) => x.loo.map(l => `${l.month} ${l.value}`).join(', ');
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const AGREED = RAC.assumptions.AGREED_TESTED;
const isAgreed = (key, role) => { const e = RAC.assumptions.entry(A, key, role); return !!e && e.source === AGREED; };
const switchMin = RAC.assumptions.get(A, 'switch_min_test_months');
// Why each agreed value was chosen (kept at the start of its notes).
const AGREED_NOTE = {
  screen_blend_n: 'Agreed 17 Sep 2026 for this release: 200 applications for both roles.',
  location_screen_blend_n: 'Agreed 17 Sep 2026 for this release: off for both roles (100000 means no location adjustment).',
  region_hire_blend_n: 'Agreed 17 Sep 2026 for this release: role average for both roles (100000).',
  d1_role_rate: 'Agreed 17 Sep 2026 for this release: 0.65 for both roles.',
  d1_prior_strength: 'Agreed 17 Sep 2026 for this release: shared across platforms (100000) for both roles.',
  remaining_error_factor: 'Agreed 17 Sep 2026: the tested figure applies only if it stays on the same side of 1 with any one test month left out; otherwise 1.00. It is the default for each plan, which a plan can change.',
  row_widen_apps: 'Agreed 17 Sep 2026: one strength for both roles, the one whose widened row ranges held closest to 80% of both roles\' location and platform misses together, used when SMR and Patrol each hold at least 70% at it; otherwise 800.',
};
const switchText = (months, unstable) => (months >= switchMin && !unstable
  ? `Switch rule met (${months} test months, stable): the tested figure may replace the agreed value.`
  : `Switch rule not met (${months} test months${unstable ? ', unstable' : ''}; needs ${switchMin} and stable): the agreed value stays.`);
// tested: what the test gave. value: what the planner uses, for "tested" rows
// and the remaining-error rule; other agreed rows keep their value.
const set = (key, role, tested, notes, value = tested) => {
  const agreed = isAgreed(key, role);
  // These two agreed values follow an agreed rule applied to the test results.
  const keepValue = agreed && key !== 'remaining_error_factor' && key !== 'row_widen_apps';
  changes.push({ key, role, value: keepValue ? null : value, tested, notes: agreed ? `${AGREED_NOTE[key]} ${notes}` : notes });
  if (!keepValue) A = RAC.assumptions.withValues(A, { [key]: { [role]: value } });
};
const run = (step) => !only || only.includes(step);

for (const role of RAC.ROLES) {
  if (run('blend')) {
    const t = RAC.testing.blendStrengths(eploy, A, role);
    const note = (k, what) => {
      const x = t[k];
      const table = x.table.map(r => `${r.value}: ${r.ll.toFixed(1)}`).join(', ');
      const rule = x.value === x.best
        ? (x.value === RAC.testing.AVERAGE ? 'the average predicted best' : `beat the average by ${x.gain.toFixed(1)} units after dispersion ${x.phi.toFixed(2)} (needs ${x.minGain})`)
        : `best was ${x.best} but it beat the average by only ${x.gain.toFixed(1)} units after dispersion ${x.phi.toFixed(2)} (needs ${x.minGain}), so the average is used`;
      return `Tested ${today} on Eploy ${eploy.dataset.file_date}: ${x.splits}; ${rule}; log-likelihood by strength (${table}); 100000 means ${what}. ` +
        `Leaving out each test month: ${loo(x)}${x.unstable ? '; UNSTABLE' : '; stable'}. ${switchText(x.perMonth.length, x.unstable)}`;
    };
    set('screen_blend_n', role, t.screen_blend_n.value, note('screen_blend_n', 'the role average'));
    set('location_screen_blend_n', role, t.location_screen_blend_n.value, note('location_screen_blend_n', 'no location adjustment'));
    set('region_hire_blend_n', role, t.region_hire_blend_n.value, note('region_hire_blend_n', 'the role average'));
    (sensitivity[role] ||= {}).blend = Object.fromEntries(Object.entries(t).map(([k, x]) => [k,
      { used: RAC.assumptions.get(A, k, role), tested: x.value, best: x.best, gain: Math.round(x.gain * 100) / 100, dispersion: Math.round(x.phi * 100) / 100,
        testMonths: x.perMonth.length, leaveOneOut: x.loo, unstable: x.unstable }]));
  }
  if (run('recon')) {
    const r = RAC.testing.reconciliation(DATA[role].ds, eploy, A, role);
    const r4 = (x) => Math.round(x * 10000) / 10000;
    const span = `application months ${r.months[0]} to ${r.months[r.months.length - 1]} (${r.months.length} months)`;
    const model = `the model gave ${r.modelHires.toFixed(1)} hires from ${Math.round(r.platformApps)} platform applications (${DATA[role].label}; Eploy ${eploy.dataset.file_date})`;
    set('paid_hire_reconciliation_factor', role, r4(r.paidFactor),
      `Tested ${today}: ${span}; ${model}; Eploy credited ${r.eployPaidHires} hires to Indeed, Meta, Google and Appcast.`);
    set('other_hires_credit_factor', role, r4(r.otherFactor),
      `Tested ${today}: ${span}; Eploy recorded ${r.eployOtherHires} hires from other sources against ${r.modelHires.toFixed(1)} model hires. ` +
      `With paid_hire_reconciliation_factor it adds up to ${r4(r.paidFactor + r.otherFactor)}, the earlier scaling to all ${r.eployHires} hires.`);
    const byMonth = r.otherMonthly.map(x => `${x.month} ${x.hires}`).join(', ');
    set('other_hires_monthly', role, r4(r.otherMean),
      `Tested ${today}: starting value for each plan (a plan can change it); average of the hires Eploy recorded outside the four platforms each month, all locations including no region: ${byMonth}`);
  }
}

// Back-test (D1, D2, D5): months the adjustment is learned from, then the
// rates, adjustment, ranges and row widening for each role.
const WINDOW = { mode: 'last3up', mult: 2 };
let backtests = null;
if (run('backtest')) {
  const trials = RAC.backtest.RECENT_CHOICES.map(recent => {
    const res = {};
    for (const role of RAC.ROLES) res[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy, { recent, stability: false });
    return { recent, res, rms: RAC.ROLES.reduce((a, r) => a + res[r].fit.rmsLog, 0) };
  });
  // Lowest total wins; on a tie the current value stays.
  const current = RAC.assumptions.get(A, 'remaining_error_months');
  const lowest = Math.min(...trials.map(t => t.rms));
  const tied = trials.filter(t => t.rms <= lowest + 1e-9);
  const best = tied.find(t => t.recent === current) || tied[0];
  const trialText = trials.map(t => `${t.recent || 'all'}: ${RAC.ROLES.map(r => `${r} ${t.res[r].fit.rmsLog.toFixed(3)}`).join(', ')}`).join('; ');
  const setAll = (key, value, notes) => {
    changes.push({ key, role: 'all', value, tested: value, notes });
    A = RAC.assumptions.withValues(A, { [key]: value });
  };
  setAll('remaining_error_months', best.recent,
    `Tested ${today}: typical miss (root mean square of log misses) by months the adjustment was learned from (0 means all): ${trialText}. Lowest total kept; on a tie the current value stays.`);
  backtests = {};
  for (const role of RAC.ROLES) backtests[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy, { recent: best.recent });
  const r4 = (x) => Math.round(x * 10000) / 10000;
  // Row widening: one strength for both roles, on both roles' misses together.
  const pooled = RAC.backtest.C_GRID.map((c, i) => {
    const cells = RAC.ROLES.reduce((a, r) => a + backtests[r].rowWiden.cells, 0);
    const inside = RAC.ROLES.reduce((a, r) => a + backtests[r].rowWiden.table[i].coverage * backtests[r].rowWiden.cells, 0);
    return { c, coverage: inside / cells, cells };
  });
  const target = RAC.assumptions.get(A, 'range_high_percentile') - RAC.assumptions.get(A, 'range_low_percentile');
  const pooledBest = pooled.reduce((b, r) => (Math.abs(r.coverage - target) < Math.abs(b.coverage - target) - 1e-12 ? r : b), pooled[0]);
  const pooledText = `closest at ${pooledBest.c} (held ${(pooledBest.coverage * 100).toFixed(1)}% of ${pooledBest.cells}); by strength ${pooled.map(x => `${x.c}: ${(x.coverage * 100).toFixed(1)}%`).join(', ')}`;
  console.log(`Row widening, both roles together: ${pooledText}`);
  // The agreed rule: the combined best, if each role holds at least 70% of its
  // misses at it; otherwise 800.
  const WIDEN_FALLBACK = 800, WIDEN_MIN_HELD = 0.7;
  const heldAt = (c) => Object.fromEntries(RAC.ROLES.map(r => [r, backtests[r].rowWiden.table.find(x => x.c === c).coverage]));
  const bestHeld = heldAt(pooledBest.c);
  const widenValue = RAC.ROLES.every(r => bestHeld[r] >= WIDEN_MIN_HELD) ? pooledBest.c : WIDEN_FALLBACK;
  const heldText = (c) => RAC.ROLES.map(r => `${r} ${(heldAt(c)[r] * 100).toFixed(0)}%`).join(', ');
  const widenRule = `Rule: combined best ${pooledBest.c} (${heldText(pooledBest.c)}); ` +
    (widenValue === pooledBest.c ? `each role holds at least 70% there, so ${widenValue} is used.` : `a role holds under 70% there, so ${WIDEN_FALLBACK} is used (${heldText(WIDEN_FALLBACK)}).`) +
    ` At 400: ${heldText(400)}; at 800: ${heldText(800)}.`;
  console.log(widenRule);
  for (const role of RAC.ROLES) {
    const bt = backtests[role];
    const months = bt.outer.map(o => `${o.month} ${pct(o.miss)}`).join(', ');
    const n = bt.testable.length;
    const learned = `test months ${bt.testable[0]} to ${bt.testable[n - 1]}, each with at least ${RAC.assumptions.get(A, 'test_min_history_months')} earlier months (${DATA[role].label}), window year to date with the last 3 months x2`;
    const st = bt.stability, f = bt.final;
    const flag = (k) => (st.unstable[k] ? 'UNSTABLE' : 'stable');
    const looText = (k, fmt) => st.loo.map(x => `${x.month} ${fmt(x[k])}`).join(', ');
    set('d1_role_rate', role, f.tested.bRole, `Tested ${today}: best of ${RAC.backtest.B_GRID.join(', ')} by Poisson deviance predicting each month from earlier months, ${learned}. ` +
      `Leaving out each test month: ${looText('bRole', v => v)}; ${flag('bRole')} (unstable if any moves by more than 0.1). ${switchText(n, st.unstable.bRole)}`);
    const kRule = f.best.k >= RAC.backtest.SHARED ? 'the shared rate predicted best'
      : f.k >= RAC.backtest.SHARED ? `own rates (strength ${f.best.k}) beat the shared rate by only ${f.gain.toFixed(1)} units after dispersion ${f.phi.toFixed(1)} (needs ${RAC.assumptions.get(A, 'own_figure_min_gain')}), so the shared rate is the tested figure`
      : `own rates beat the shared rate by ${f.gain.toFixed(1)} units after dispersion ${f.phi.toFixed(1)}`;
    set('d1_prior_strength', role, f.tested.k, `Tested ${today}: best of ${RAC.backtest.K_GRID.join(', ')}; 100000 means every platform takes the shared rate; ${kRule} (${learned}). ` +
      `Leaving out each test month: ${looText('k', v => v)}; ${flag('k')}. ${switchText(n, st.unstable.k)}`);
    const costMisses = f.rule.months.map(m => `${m.month} ${pct(m.costMiss)}`).join(', ');
    set('remaining_error_factor', role, r4(f.tested.bias), `Tested ${today}: at the rate in use (${f.used.bRole}), predicted over actual applications in ${best.recent ? 'the latest ' + best.recent + ' test months' : 'all test months'} was ${r4(f.tested.bias)} (${learned}). ` +
      `Cost misses (predicted over actual applications, each month from earlier months, no adjustment): ${costMisses}; ` +
      `with each test month left out: ${f.rule.leftOut.map(x => `${x.month} ${x.value.toFixed(3)}`).join(', ')}; ` +
      `${f.rule.same ? 'always on the same side of 1, so the tested figure applies' : 'not always on the same side of 1, so 1.00 applies'}. ` +
      `Stability (leaving out each test month, rule re-applied): ${looText('bias', v => v.toFixed(3))}; ${flag('bias')} (unstable if any moves by more than 5% or the rule changes).`, r4(f.used.bias));
    (sensitivity[role] ||= {}).backtest = {
      used: { roleRate: f.used.bRole, strength: f.used.k, adjustment: r4(f.used.bias) },
      tested: { roleRate: f.tested.bRole, strength: f.tested.k, adjustment: r4(f.tested.bias) },
      sameDirection: f.rule.same, testMonths: n,
      bestBeforeRule: f.best, gain: Math.round(f.gain * 100) / 100, dispersion: Math.round(f.phi * 100) / 100,
      leaveOneOut: st.loo.map(x => ({ ...x, bias: r4(x.bias) })), unstable: st.unstable,
    };
    set('range_apps_low', role, r4(bt.appsRange.low), `Tested ${today}: 10th percentile (PERCENTILE.INC) of application misses, each month predicted from earlier months only: ${months}`);
    set('range_apps_high', role, r4(bt.appsRange.high), `Tested ${today}: 90th percentile of the same misses (${bt.appsRange.months} test months)`);
    set('range_apps_sigma', role, r4(bt.appsRange.sigma), `Tested ${today}: standard deviation of log(1 + miss) over the same months`);
    set('row_widen_apps', role, bt.rowWiden.c, `Tested ${today}: ${widenRule} For ${role} alone, the strength whose widened row ranges held the middle 80% of ${bt.rowWiden.cells} location and platform misses most closely was ${bt.rowWiden.c} (held ${(bt.rowWiden.coverage * 100).toFixed(0)}%); by strength ${bt.rowWiden.table.map(x => `${x.c}: ${(x.coverage * 100).toFixed(0)}%`).join(', ')}. ` +
      `Both roles together: ${pooledText}.`, widenValue);
  }
}

for (const c of changes) {
  const old = A.entries.find(e => e.key === c.key && e.role === c.role);
  console.log(`${c.key} ${c.role}: value ${old ? old.value : '?'}${c.value === null ? ' (agreed, kept)' : ' -> ' + c.value}; tested ${c.tested}\n    ${c.notes}`);
}

if (WRITE) {
  const text = readRoot('assumptions.csv');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const q = (s) => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  for (const c of changes) {
    // Columns: key, name, value, tested, unit, role, source, date, notes
    const i = lines.findIndex(l => { const r = RAC.util.parseCsv(l)[0] || []; return r[0] === c.key && r[5] === c.role; });
    if (i < 0) throw new Error(`no row for ${c.key} ${c.role}`);
    const r = RAC.util.parseCsv(lines[i])[0];
    if (c.value !== null) r[2] = String(c.value);
    r[3] = String(c.tested);
    if (!r[6].startsWith('agreed')) r[6] = 'tested';   // agreed rows keep their source; only the tested column moves
    r[7] = today; r[8] = c.notes;
    lines[i] = r.map(q).join(',');
  }
  const out = lines.join('\n');
  const check = RAC.assumptions.parse(out);
  if (!check.ok) throw new Error('refusing to write an invalid file: ' + check.errors.join('; '));
  fs.writeFileSync(path.join(ROOT, 'assumptions.csv'), out);
  console.log(`Wrote ${changes.length} values to assumptions.csv`);
  if (backtests) {
    // The test months behind the values, for the workings export's Back-test sheet.
    const round = (x) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
    const results = { note: 'Written by tools/calibrate.mjs. Each month was predicted from earlier months only.', tested: today, window: WINDOW, roles: {} };
    for (const role of RAC.ROLES) {
      const bt = backtests[role];
      results.roles[role] = {
        data: DATA[role].label,
        eploy: `${eploy.dataset.file} (${eploy.dataset.file_date})`,
        adjustmentLearnedFrom: bt.recent,
        applications: bt.outer.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))),
        hiresCheck: {
          note: 'Paid-media hires predicted from earlier months against the hires Eploy credited to the four platforms. A check only: hire ranges come from the counts behind the rates.',
          months: bt.hires.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))),
        },
        used: { roleRate: bt.final.used.bRole, strength: bt.final.used.k, adjustment: round(bt.final.used.bias) },
        tested: { roleRate: bt.final.tested.bRole, strength: bt.final.tested.k, adjustment: round(bt.final.tested.bias) },
        costMissesNoAdjustment: bt.final.rule.months.map(m => ({ month: m.month, predicted: round(m.predicted), actual: round(m.actual), costMiss: round(m.costMiss) })),
        sameDirection: bt.final.rule.same,
        sensitivity: sensitivity[role] || null,
      };
    }
    fs.writeFileSync(path.join(ROOT, 'data/backtest_results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('Wrote data/backtest_results.json');
  }
}
