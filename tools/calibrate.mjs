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
//   (chunk 2.5 adds: d1, bias, ranges)
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
}
