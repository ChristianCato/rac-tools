// Runs the tests that set the tested values in assumptions.csv, and writes the
// results into the file with today's date and the evidence in the notes.
//
// Usage (from the repo folder):
//   node tools/calibrate.mjs                 show what the tests give; change nothing
//   node tools/calibrate.mjs --write         write the results into assumptions.csv
//   node tools/calibrate.mjs --only blend,recon
//
// Data used:
//   SMR     the monthly data as the live app held it on 16 September 2026
//           (tests/fixtures/smr_sept_live_2026-09-16.json), taken on that date
//   Patrol  the repo data file (no newer Patrol export was available)
//   Eploy   data/eploy_rates.json
// Once the Assumptions tab exists, the same tests run there on the app's
// current data, and show where this file is out of date.
//
// Steps, in the order they depend on each other:
//   blend   blend strengths for the hire calculation
//   recon   reconciliation of predicted hires to every hire Eploy recorded
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
const set = (key, role, value, notes) => {
  changes.push({ key, role, value, notes });
  A = RAC.assumptions.withValues(A, { [key]: { [role]: value } });
};
const run = (step) => !only || only.includes(step);

for (const role of RAC.ROLES) {
  if (run('blend')) {
    const t = RAC.testing.blendStrengths(eploy, A, role);
    const line = (k) => t[k].table.map(x => `${x.value}: ${x.ll.toFixed(1)}`).join(', ');
    set('screen_blend_n', role, t.screen_blend_n.value,
      `Tested ${today} on Eploy ${eploy.dataset.file_date}: learned ${t.screen_blend_n.splits}; best of log-likelihood by strength (${line('screen_blend_n')})`);
    set('location_screen_blend_n', role, t.location_screen_blend_n.value,
      `Tested ${today} on Eploy ${eploy.dataset.file_date}: learned ${t.location_screen_blend_n.splits}; log-likelihood by strength (${line('location_screen_blend_n')})`);
    set('region_hire_blend_n', role, t.region_hire_blend_n.value,
      `Tested ${today} on Eploy ${eploy.dataset.file_date}: learned ${t.region_hire_blend_n.splits}; log-likelihood by strength (${line('region_hire_blend_n')}); 100000 means the role average`);
  }
  if (run('recon')) {
    const r = RAC.testing.reconciliation(DATA[role].ds, eploy, A, role);
    const f = Math.round(r.factor * 1000) / 1000;
    set('hire_reconciliation_factor', role, f,
      `Tested ${today}: application months ${r.months[0]} to ${r.months[r.months.length - 1]}; the model gave ${r.modelHires.toFixed(1)} hires from ${Math.round(r.platformApps)} platform applications; ` +
      `Eploy recorded ${r.eployHires} hires from all sources (${r.eployPaidHires} credited to Indeed, Meta, Google and Appcast; ${r.eployOtherHires} to other sources). ${DATA[role].label}.`);
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
    for (const role of RAC.ROLES) res[role] = RAC.backtest.run(DATA[role].ds, A, role, WINDOW, eploy, { recent });
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
  backtests = best.res;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  for (const role of RAC.ROLES) {
    const bt = backtests[role];
    const months = bt.outer.map(o => `${o.month} ${pct(o.miss)}`).join(', ');
    const learned = `learned from ${bt.testable[0]} to ${bt.testable[bt.testable.length - 1]} (${DATA[role].label}), window year to date with the last 3 months x2`;
    set('d1_role_rate', role, bt.final.bRole, `Tested ${today}: best of ${RAC.backtest.B_GRID.join(', ')} by Poisson deviance predicting each month from earlier months, ${learned}`);
    set('d1_prior_strength', role, bt.final.k, `Tested ${today}: best of ${RAC.backtest.K_GRID.join(', ')}; 100000 means every platform takes the shared rate (${learned})`);
    set('remaining_error_factor', role, r4(bt.final.bias), `Tested ${today}: predicted over actual applications in the latest ${best.recent || 'all'} test months at the chosen rate (${learned})`);
    set('range_apps_low', role, r4(bt.appsRange.low), `Tested ${today}: 10th percentile (PERCENTILE.INC) of application misses, each month predicted from earlier months only: ${months}`);
    set('range_apps_high', role, r4(bt.appsRange.high), `Tested ${today}: 90th percentile of the same misses (${bt.appsRange.months} test months)`);
    set('range_apps_sigma', role, r4(bt.appsRange.sigma), `Tested ${today}: standard deviation of log(1 + miss) over the same months`);
    const hm = bt.hires.map(o => `${o.month} ${pct(o.miss)}`).join(', ');
    set('range_hires_low', role, r4(bt.hireRange.low), `Tested ${today}: 10th percentile of hire misses against every hire Eploy recorded, each month predicted from earlier months: ${hm}`);
    set('range_hires_high', role, r4(bt.hireRange.high), `Tested ${today}: 90th percentile of the same misses (${bt.hireRange.months} test months)`);
    set('range_hires_sigma', role, r4(bt.hireRange.sigma), `Tested ${today}: standard deviation of log(1 + miss) over the same months`);
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
        hires: bt.hires.map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]))),
        final: { roleRate: bt.final.bRole, strength: bt.final.k, adjustment: round(bt.final.bias) },
      };
    }
    fs.writeFileSync(path.join(ROOT, 'data/backtest_results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('Wrote data/backtest_results.json');
  }
}
