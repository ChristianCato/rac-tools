// Checks for the Eploy import (addendum 2.6) and its aggregated output.
import { spawnSync } from 'node:child_process';
import { readRoot, ROOT } from '../lib/planner.mjs';

function python(args) {
  for (const exe of ['python', 'python3']) {
    const r = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8' });
    if (!r.error) return r;
  }
  return null;
}

export default function (check, { assert }) {
  check('Eploy import: safeguards on made-up workbooks', () => {
    const r = python(['tests/tools/test_eploy_import.py']);
    if (!r) return 'SKIPPED: Python not found';
    const lines = (r.stdout || '').trim().split(/\r?\n/);
    assert(r.status === 0, 'failed:\n' + lines.filter(l => !l.startsWith('PASS')).join('\n') + (r.stderr || ''));
    return `${lines.filter(l => l.startsWith('PASS')).length} cases: reads by header name, stops on missing columns, unmapped labels, bad or empty flags, out-of-range dates and shifts above 10%, writes no candidate-level fields`;
  });

  check('Eploy import: the committed rates match the current workbook', () => {
    const wb = process.env.RAC_EPLOY_WORKBOOK;
    if (!wb) return 'SKIPPED: set RAC_EPLOY_WORKBOOK to the Eploy workbook path to run this check (the workbook is never committed)';
    const r = python(['tools/eploy_import.py', wb, '--check']);
    if (!r) return 'SKIPPED: Python not found';
    assert(r.status === 0, (r.stdout || '') + (r.stderr || ''));
    return (r.stdout || '').trim().split(/\r?\n/).slice(-1)[0];
  });

  check('Eploy rates file holds only aggregated counts', () => {
    const d = JSON.parse(readRoot('data/eploy_rates.json'));
    const regions = new Set(['London', 'South East', 'East of England', 'South West', 'East Midlands', 'West Midlands', 'North West',
      'North East', 'Yorkshire & Humber', 'Scotland', 'Wales', 'Northern Ireland', 'Unknown']);
    const plats = new Set(['indeed', 'meta', 'google', 'appcast', 'other']);
    let apps = 0;
    for (const c of d.cells) {
      assert(c.length === 8, 'unexpected row shape ' + JSON.stringify(c));
      const [role, region, plat, month, a, q, h, pr] = c;
      assert(['SMR', 'Patrol'].includes(role) && regions.has(region) && plats.has(plat) && /^\d{4}-\d{2}$/.test(month), 'unexpected labels ' + JSON.stringify(c));
      assert([a, q, h, pr].every(Number.isInteger) && a >= q && q >= h && h >= 0 && a >= pr && pr >= h, 'counts out of order ' + JSON.stringify(c));
      // Quality includes every progressed application (and is the same thing under the first measure).
      assert(d.quality_measure === 'Quality Applies' ? q >= pr : q === pr, 'quality and progressed disagree ' + JSON.stringify(c));
      apps += a;
    }
    assert(apps === d.dataset.rows_smr + d.dataset.rows_patrol, `applications ${apps} differ from rows read ${d.dataset.rows_smr + d.dataset.rows_patrol}`);
    const keys = Object.keys(d).sort().join(',');
    assert(keys === 'cells,dataset,eploy_first_month,mappings_sha256,note,quality_measure', 'unexpected top-level fields: ' + keys);
    assert(['Quality Applies', 'Progressed Past Screening'].includes(d.quality_measure), 'quality measure ' + d.quality_measure);
    return `${d.cells.length} rows, ${apps} applications, dataset ${d.dataset.file} dated ${d.dataset.file_date}, quality measure ${d.quality_measure}`;
  });
}
