// The monthly data tested values are set from, used by tools/calibrate.mjs and
// the checks.
//   SMR     as the live app held it on 16 September 2026, taken on that date
//   Patrol  the repo data file (no newer Patrol export was available)
import path from 'node:path';
import { readRoot, ROOT } from './planner.mjs';
import { readGzJson } from './engine.mjs';
import { withRoleMonthly } from './fixtures.mjs';

export function calibrationData(RAC) {
  const BASE = readGzJson(path.join(ROOT, 'tests/fixtures/rac_data_46aaae2.json.gz'));
  const LIVE = JSON.parse(readRoot('tests/fixtures/smr_sept_live_2026-09-16.json'));
  const repo = { generated_at: BASE.generated_at, current_through: BASE.data_current_through, months: BASE.data_months };
  const liveMonths = [...new Set(LIVE.raw.map(r => r[0]))].sort();
  return {
    SMR: {
      ds: RAC.data.snapshot(withRoleMonthly(BASE, LIVE.raw, 'SMR'), { at: '2026-09-16', months: liveMonths }, repo),
      label: 'SMR data as the live app held it on 16 September 2026',
    },
    Patrol: {
      ds: RAC.data.snapshot(BASE, null, repo),
      label: 'Patrol data from the repo data file (generated 28 July 2026)',
    },
  };
}
