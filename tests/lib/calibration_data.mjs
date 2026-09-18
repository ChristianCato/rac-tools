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
  // Printed in the workings, so it describes the source in plain terms: no
  // file name, nothing about the app.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const to = String(D.data_current_through || '').slice(0, 7);
  const toText = /^\d{4}-\d{2}$/.test(to) ? `${MONTHS[Number(to.slice(5)) - 1]} ${to.slice(0, 4)}` : 'the latest month held';
  const label = (role) => `RAC's monthly ${role} spend and application data, to ${toText}`;
  const ds = RAC.data.snapshot(D, null, repo);
  return {
    SMR: { ds, label: label('SMR') },
    Patrol: { ds, label: label('Patrol') },
  };
}
