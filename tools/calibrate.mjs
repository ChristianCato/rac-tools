// Runs the tests that set the tested values in assumptions.csv, and writes the
// results into the file with today's date and the evidence in the notes.
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

const changes = [];   // { key, role, value, notes }
const sensitivity = {};   // leave-one-out results, written to data/backtest_results.json
const loo = (x) => x.loo.map(l => `${l.month} ${l.value}`).join(', ');
const set = (key, role, value, notes) => {
  changes.push({ key, role, value, notes });
  A = RAC.assumptions.withValues(A, { [key]: { [role]: value } });
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
        `Leaving out each test month: ${loo(x)}${x.unstable ? '; UNSTABLE' : '; stable'}.`;
    };
    set('screen_blend_n', role, t.screen_blend_n.value, note('screen_blend_n', 'the role average'));
    set('location_screen_blend_n', role, t.location_screen_blend_n.value, note('location_screen_blend_n', 'no location adjustment'));
    set('region_hire_blend_n', role, t.region_hire_blend_n.value, note('region_hire_blend_n', 'the role average'));
    (sensitivity[role] ||= {}).blend = Object.fromEntries(Object.entries(t).map(([k, x]) => [k,
      { value: x.value, best: x.best, gain: Math.round(x.gain * 100) / 100, dispersion: Math.round(x.phi * 100) / 100, leaveOneOut: x.loo, unstable: x.unstable }]));
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
      `Tested ${today}: starting value for Setup (editable per plan); average of the hires Eploy recorded outside the four platforms each month, all locations including no region: ${byMonth}`);
  }
}

// Back-test (D1, D2, D5): months the adjustment is learned from, then the
// rates, adjustment, ranges and row widening for each role.
const WINDOW = { mode: 'last3up', mult: 2 };
let backtests = null;
if (run('backtest')) {
  const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  const trials = RAC.backtest.RECENT_CHOICES.map(recent => {
    const res = {};
    for (const role of RAC.ROLES) res[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy, { recent, stability: false });
    return { recent, res, rms: RAC.ROLES.reduce((a, r) => a + res[r].fit.rmsLog, 0) };
  });
  const best = trials.reduce((b, t) => (t.rms < b.rms - 1e-12 ? t : b), trials[0]);
  const trialText = trials.map(t => `${t.recent || 'all'}: ${RAC.ROLES.map(r => `${r} ${t.res[r].fit.rmsLog.toFixed(3)}`).join(', ')}`).join('; ');
  const setAll = (key, value, notes) => {
    changes.push({ key, role: 'all', value, notes });
    A = RAC.assumptions.withValues(A, { [key]: value });
  };
  setAll('remaining_error_months', best.recent,
    `Tested ${today}: typical miss (root mean square of log misses) by months the adjustment was learned from: ${trialText}. Lowest total kept.`);
  backtests = {};
  for (const role of RAC.ROLES) backtests[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy, { recent: best.recent });
  const r4 = (x) => Math.round(x * 10000) / 10000;
  for (const role of RAC.ROLES) {
    const bt = backtests[role];
    const months = bt.outer.map(o => `${o.month} ${pct(o.miss)}`).join(', ');
    const learned = `test months ${bt.testable[0]} to ${bt.testable[bt.testable.length - 1]}, each with at least ${RAC.assumptions.get(A, 'test_min_history_months')} earlier months (${DATA[role].label}), window year to date with the last 3 months x2`;
    const st = bt.stability, f = bt.final;
    const flag = (k) => (st.unstable[k] ? 'UNSTABLE' : 'stable');
    const looText = (k, fmt) => st.loo.map(x => `${x.month} ${fmt(x[k])}`).join(', ');
    set('d1_role_rate', role, f.bRole, `Tested ${today}: best of ${RAC.backtest.B_GRID.join(', ')} by Poisson deviance predicting each month from earlier months, ${learned}. ` +
      `Leaving out each test month: ${looText('bRole', v => v)}; ${flag('bRole')} (unstable if any moves by more than 0.1).`);
    const kRule = f.best.k >= RAC.backtest.SHARED ? 'the shared rate predicted best'
      : f.k >= RAC.backtest.SHARED ? `own rates (strength ${f.best.k}) beat the shared rate by only ${f.gain.toFixed(1)} units after dispersion ${f.phi.toFixed(1)} (needs ${RAC.assumptions.get(A, 'own_figure_min_gain')}), so the shared rate is used`
      : `own rates beat the shared rate by ${f.gain.toFixed(1)} units after dispersion ${f.phi.toFixed(1)}`;
    set('d1_prior_strength', role, f.k, `Tested ${today}: best of ${RAC.backtest.K_GRID.join(', ')}; 100000 means every platform takes the shared rate; ${kRule} (${learned}). ` +
      `Leaving out each test month: ${looText('k', v => v)}; ${flag('k')}.`);
    set('remaining_error_factor', role, r4(f.bias), `Tested ${today}: predicted over actual applications in ${best.recent ? 'the latest ' + best.recent + ' test months' : 'all test months'} at the chosen rate (${learned}); default for the Setup field. ` +
      `Leaving out each test month: ${looText('bias', v => v.toFixed(3))}; ${flag('bias')} (unstable if any moves by more than 5%).`);
    (sensitivity[role] ||= {}).backtest = {
      value: { roleRate: f.bRole, strength: f.k, adjustment: r4(f.bias) },
      bestBeforeRule: f.best, gain: Math.round(f.gain * 100) / 100, dispersion: Math.round(f.phi * 100) / 100,
      leaveOneOut: st.loo.map(x => ({ ...x, bias: r4(x.bias) })), unstable: st.unstable,
    };
    set('range_apps_low', role, r4(bt.appsRange.low), `Tested ${today}: 10th percentile (PERCENTILE.INC) of application misses, each month predicted from earlier months only: ${months}`);
    set('range_apps_high', role, r4(bt.appsRange.high), `Tested ${today}: 90th percentile of the same misses (${bt.appsRange.months} test months)`);
    set('range_apps_sigma', role, r4(bt.appsRange.sigma), `Tested ${today}: standard deviation of log(1 + miss) over the same months`);
    set('row_widen_apps', role, bt.rowWiden.c, `Tested ${today}: strength whose widened row ranges held the middle 80% of ${bt.rowWiden.cells} location and platform misses most closely (held ${(bt.rowWiden.coverage * 100).toFixed(0)}%); by strength ${bt.rowWiden.table.map(x => `${x.c}: ${(x.coverage * 100).toFixed(0)}%`).join(', ')}`);
  }
}

for (const c of changes) {
  const old = A.entries.find(e => e.key === c.key && e.role === c.role);
  console.log(`${c.key} ${c.role}: ${old ? old.value : '?'} -> ${c.value}\n    ${c.notes}`);
}

if (WRITE) {
  const text = readRoot('assumptions.csv');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const q = (s) => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  for (const c of changes) {
    const i = lines.findIndex(l => { const r = RAC.util.parseCsv(l)[0] || []; return r[0] === c.key && r[4] === c.role; });
    if (i < 0) throw new Error(`no row for ${c.key} ${c.role}`);
    const r = RAC.util.parseCsv(lines[i])[0];
    r[2] = String(c.value); r[5] = 'tested'; r[6] = today; r[7] = c.notes;
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
        final: { roleRate: bt.final.bRole, strength: bt.final.k, adjustment: round(bt.final.bias) },
        sensitivity: sensitivity[role] || null,
      };
    }
    fs.writeFileSync(path.join(ROOT, 'data/backtest_results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('Wrote data/backtest_results.json');
  }
}
