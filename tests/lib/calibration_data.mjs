// The monthly data tested values are set from, used by tools/calibrate.mjs and
// the checks: the repo data file (rac_data.js), which since 17 September 2026
// is the live app's data including August, for both roles. The date the data
// was taken is the file's generated_at.
import { readRoot } from './planner.mjs';

// The data object a data file sets on window.
export function readDataFile(text) {
  const w = {};
  new Function('window', text)(w);
  return w.__AVP_DATA__;
}

export function repoData() {
  return readDataFile(readRoot('rac_data.js'));
}

export function calibrationData(RAC) {
  const D = repoData();
  const repo = { generated_at: D.generated_at, current_through: D.data_current_through, months: D.data_months };
  const label = `data from rac_data.js (the live app's data, taken ${D.generated_at})`;
  const ds = RAC.data.snapshot(D, null, repo);
  return {
    SMR: { ds, label: 'SMR ' + label },
    Patrol: { ds, label: 'Patrol ' + label },
  };
}
