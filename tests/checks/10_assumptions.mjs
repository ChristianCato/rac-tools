// Checks for the planner files and the assumptions file (B1).
import fs from 'node:fs';
import path from 'node:path';
import { loadPlanner, loadAssumptions, readRoot, manifest, ROOT } from '../lib/planner.mjs';

export default function (check, { assert }) {
  check('Planner files listed in the manifest exist and load', () => {
    const files = manifest().files;
    files.forEach(f => assert(fs.existsSync(path.join(ROOT, f)), 'missing planner file ' + f));
    const RAC = loadPlanner();
    assert(RAC && RAC.util && RAC.assumptions, 'planner did not load');
    return `${files.length} files: ${files.join(', ')}`;
  });

  check('assumptions.csv is complete and valid', () => {
    const RAC = loadPlanner();
    const A = loadAssumptions(RAC);
    assert(A.ok, 'assumptions.csv has problems: ' + A.errors.join('; '));
    const counts = {};
    A.entries.forEach(e => { counts[e.source] = (counts[e.source] || 0) + 1; });
    return `${A.entries.length} rows (${Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ')}), fingerprint ${A.fingerprint}, latest date ${A.date}`;
  });

  check('A broken assumptions file stops the planner and names the row', () => {
    const RAC = loadPlanner();
    const good = readRoot('assumptions.csv');
    const firstRow = good.split(/\r?\n/)[1];
    const cases = [
      ['value removed', good.replace(/^(cap_multiple_default,[^,]*,)1,/m, '$1,'), /row \d+ \(cap_multiple_default\): value should be a number/],
      ['value out of range', good.replace(/^(cap_multiple_default,[^,]*,)1,/m, '$1' + '9,'), /cap_multiple_default\): value 9 is outside 1 to 3/],
      ['row deleted', good.replace(/^d1_role_rate,.*,Patrol,.*\r?\n/m, ''), /missing row: d1_role_rate for Patrol/],
      ['unknown key', good + 'made_up_value,Made up,1,,count,all,agreed,2026-09-17,\n', /made_up_value\): unknown key/],
      ['agreed row without its tested figure', good.replace(/^(d1_role_rate,[^,]*,[^,]*,)[^,]*,/m, '$1,'), /d1_role_rate, SMR\): source "agreed, informed by tests" needs the tested figure/],
      ['tested figure not a number', good.replace(/^(d1_role_rate,[^,]*,[^,]*,)[^,]*,/m, '$1' + 'high,'), /d1_role_rate, SMR\): tested should be a number or blank/],
      ['bad source', good.replace(/^(indeed_premium_rate,.*?,all,)agreed,/m, '$1' + 'guess,'), /indeed_premium_rate\): source should be/],
      ['duplicate row', good + firstRow + '\n', /indeed_premium_rate\): appears more than once/],
      ['bad month', good.replace(/^(eploy_first_month,[^,]*,)2025-10,/m, '$1' + '2025-13,'), /eploy_first_month\): value should be a month/],
      ['wrong role', good.replace(/^(meta_google_pull,.*?,share,)all,/m, '$1' + 'SMR,'), /meta_google_pull, SMR\): role should be all/],
    ];
    for (const [what, text, expect] of cases) {
      assert(text !== good, `test case "${what}" did not change the file`);
      const A = RAC.assumptions.parse(text);
      assert(!A.ok, `${what}: file was accepted`);
      assert(A.errors.some(e => expect.test(e)), `${what}: expected an error matching ${expect}, got: ${A.errors.join('; ')}`);
      let refused = false;
      try { RAC.assumptions.get(A, 'indeed_premium_rate'); } catch (e) { refused = true; }
      assert(refused, `${what}: planner read a value from an invalid file`);
    }
    return `${cases.length} broken versions, each refused with the row named`;
  });

  check('CSV reader handles quotes and Windows line endings', () => {
    const RAC = loadPlanner();
    const rows = RAC.util.parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n');
    assert(JSON.stringify(rows) === JSON.stringify([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]), JSON.stringify(rows));
    const A1 = RAC.assumptions.parse(readRoot('assumptions.csv').replace(/\r?\n/g, '\r\n'));
    const A2 = RAC.assumptions.parse(readRoot('assumptions.csv').replace(/\r?\n/g, '\n'));
    assert(A1.ok && A2.ok && A1.fingerprint === A2.fingerprint, 'line endings changed the result or fingerprint');
    return 'quoted commas and quotes read correctly; fingerprint ignores line endings';
  });

  check('Excel PERCENTILE.INC matches known values', () => {
    const RAC = loadPlanner();
    const p = RAC.util.percentileInc;
    // PERCENTILE.INC({1,2,3,4,5},0.1)=1.4; 0.9 gives 4.6; {0.35,-0.2,0.1} at 0.1 gives -0.14.
    const cases = [[[1, 2, 3, 4, 5], 0.1, 1.4], [[1, 2, 3, 4, 5], 0.9, 4.6], [[0.35, -0.2, 0.1], 0.1, -0.14], [[7], 0.9, 7]];
    cases.forEach(([xs, q, want]) => assert(Math.abs(p(xs, q) - want) < 1e-12, `PERCENTILE.INC(${xs},${q}) gave ${p(xs, q)}, expected ${want}`));
    return cases.length + ' cases';
  });
}
