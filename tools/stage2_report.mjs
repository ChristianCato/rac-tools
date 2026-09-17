// Stage 2 check (addendum 2.10): the September SMR plan re-run under the new
// model, with the changes switched on one at a time, then on the data the live
// app held on 16 September.
//
// Usage (from the repo folder):  node tools/stage2_report.mjs [--json out.json]
// Prints a table in Markdown. Each row changes one thing on top of the row
// above, so the order matters and the effects are not independent.
import fs from 'node:fs';
import path from 'node:path';
import { loadPlanner, loadAssumptions, readRoot, ROOT } from '../tests/lib/planner.mjs';
import { loadEngine, readGzJson } from '../tests/lib/engine.mjs';
import { withRoleMonthly, septSmrSettings, cellsFromRaw } from '../tests/lib/fixtures.mjs';
import { calibrationData } from '../tests/lib/calibration_data.mjs';

const RAC = loadPlanner();
const A = loadAssumptions(RAC);
const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
const BASE = readGzJson(path.join(ROOT, 'tests/fixtures/rac_data_46aaae2.json.gz'));
const F2A = JSON.parse(readRoot('tests/fixtures/smr_sept_plan_2a.json'));
const FLIVE = JSON.parse(readRoot('tests/fixtures/smr_sept_live_2026-09-16.json'));
const LEGACY = readRoot('tests/legacy/engine_46aaae2.js');
const REPO = { generated_at: BASE.generated_at, current_through: BASE.data_current_through, months: BASE.data_months };
const months2a = [...new Set(F2A.raw.map(r => r[0]))].sort();
const SEPT = septSmrSettings(-1);
const TARGET = 30;

const rows = [];
const add = (label, r, note = '') => rows.push({ label, ...r, note });

// Previous engine.
function previous(data, replayLive) {
  const E = loadEngine(LEGACY, data);
  let plan = E.buildFundingPlan('SMR', SEPT);
  if (replayLive) {
    const months = [...new Set(FLIVE.raw.map(r => r[0]))].sort();
    const cells = cellsFromRaw(FLIVE.raw, 'SMR');
    for (const p of E.PLATFORMS) for (const k of Object.keys(BASE[p])) {
      if (k.endsWith('__SMR')) continue;
      for (const mo of months) { const v = BASE[p][k].monthly?.[mo]; if (v) ((cells[p] ||= {})[k] ||= {})[mo] = v; }
    }
    E.applyMonths(months, cells, null);
    E.setHireOverride(null);
    plan = E.buildFundingPlan('SMR', SEPT);
  }
  return { apps: plan.predictedApps, hires: plan.predictedHires, other: null, all: plan.predictedHires, budget30: plan.budgetForTarget, unplaced: plan.unplacedBudget,
    above: plan.beyondProven, cpa: plan.predictedApps > 0 ? (plan.deployable - plan.unplacedBudget) / plan.predictedApps : null };
}

function next(env, inputs) {
  const p = RAC.plan.build('SMR', { ...SEPT, ...inputs }, env);
  return {
    apps: p.totals.apps, hires: p.totals.hires, other: p.totals.otherHires, all: p.totals.allHires, cpa: p.totals.cpa,
    budget30: p.unreachable ? null : p.budgetForTarget, most: p.maxAchievable,
    unplaced: p.unplaced.total, above: p.aboveLargestSuccessful.total,
    range: p.totals.range, plan: p,
  };
}

// A. Plan 2a as issued.
const data2a = withRoleMonthly(BASE, F2A.raw, 'SMR');
add('A. Plan 2a as issued (previous engine)', previous(structuredClone(data2a)));

// B. Part months left out, previous engine: July (cut at 24 July) removed.
const noJuly = structuredClone(data2a);
for (const p of ['indeed', 'meta', 'google', 'appcast']) for (const c of Object.values(noJuly[p])) {
  if (c.monthly && c.monthly['2026-07']) {
    delete c.monthly['2026-07'];
    const sp = Object.values(c.monthly).reduce((a, v) => a + (v.spend || 0), 0);
    const n = Object.values(c.monthly).reduce((a, v) => a + (v.completes || 0), 0);
    Object.assign(c.all_time, { spend: sp, completes: n, cpa: n ? sp / n : null });
  }
}
noJuly.data_months = noJuly.data_months.filter(m => m !== '2026-07');
add('B. Part month (July) left out', previous(noJuly));

// New planner on plan 2a's data (July cut at 24 July, so left out).
const env2a = { ds: RAC.data.snapshot(withRoleMonthly(BASE, F2A.raw, 'SMR'), { at: '2026-07-24', months: months2a, lastDate: '2026-07-24' }, REPO), A, eploy };
const off = { remaining_error_factor: { SMR: 1 }, paid_hire_reconciliation_factor: { SMR: 1 }, other_hires_credit_factor: { SMR: 0 } };
const noBias = { remaining_error_factor: { SMR: 1 } };
add('C. Diminishing returns in the split and the forecast', next(env2a, { overrides: off, compare: { previousHireRates: true, previousCeilings: true, noOtherSources: true } }));
add('D. Hires from screening and hire rates (Eploy)', next(env2a, { overrides: off, compare: { previousCeilings: true, noOtherSources: true } }));
add('E. Hires reconciled to platform hires in Eploy, plus expected hires from other sources (0% credited)', next(env2a, { overrides: noBias, compare: { previousCeilings: true } }));
add('E100. For comparison only: 100% credited (equals the earlier scaling to every hire)', next(env2a, { overrides: noBias, otherHiresShare: 1, compare: { previousCeilings: true } }), 'not carried into F');
add('F. Spending limits on successful months (hard cap)', next(env2a, { overrides: noBias }));
add('G. Cost per hire and cost per application limits', next(env2a, { overrides: noBias }), 'none were set in plan 2a');
add('H. Remaining-error adjustment (full new model)', next(env2a, {}), 'spending limit multiple 2, as plan 2a');
add('H1. For comparison only: spending limit multiple 1 (new default)', next(env2a, { capMultiple: 1 }), 'not carried into I');

// Data as the live app held it on 16 September.
add('I. Previous engine, saved plan as held on 16 Sep', previous(structuredClone(BASE), true), 'August in the data but given no weight');
// J and K on the 16 September export (as before), then on the new rac_data.js.
const liveMonths = [...new Set(FLIVE.raw.map(r => r[0]))].sort();
const sep16 = withRoleMonthly(BASE, FLIVE.raw, 'SMR');
add('J. Full new model on 16 Sep data (export)', next({ ds: RAC.data.snapshot(sep16, { at: '2026-09-16', months: liveMonths }, REPO), A, eploy }, {}), 'August not yet counted (taken 16 days after month end)');
add('K. Full new model, August counted (export)', next({ ds: RAC.data.snapshot(sep16, { at: '2026-09-24', months: liveMonths }, REPO), A, eploy }, {}), 'if August is uploaded on or after 24 Sep');
const D = calibrationData(RAC);
const R17 = D.SMR.ds.repo;
const later = RAC.data.snapshot(D.SMR.ds.DATA, null, { ...R17, generated_at: '2026-09-24' });
add('J2. Full new model on rac_data.js (17 Sep)', next({ ds: D.SMR.ds, A, eploy }, {}), 'August not yet counted (taken 17 days after month end)');
add('K2. Full new model on rac_data.js, August counted', next({ ds: later, A, eploy }, {}), 'as if taken on 24 Sep');
add('K2 at multiple 1. For comparison only: spending limit multiple 1 (new default)', next({ ds: later, A, eploy }, { capMultiple: 1 }), 'an October plan on the defaults');

const gbp = (x) => (x === null || x === undefined ? '-' : '£' + Math.round(x).toLocaleString('en-GB'));
console.log('| Step | Applications | Paid-media hires | Expected hires from other sources | All hires | Cost per application | Budget for 30 hires | Not placed | Above largest (successful) month | Note |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const b30 = r.budget30 ? gbp(r.budget30) : `not reachable (most ${r.most ? r.most.toFixed(1) : '?'} hires)`;
  const other = r.other === null ? '-' : r.other.toFixed(1);
  console.log(`| ${r.label} | ${r.apps.toFixed(0)} | ${r.hires.toFixed(1)} | ${other} | ${r.all.toFixed(1)} | ${gbp(r.cpa)} | ${b30} | ${gbp(r.unplaced)} | ${gbp(r.above)} | ${r.note} |`);
}

// Detail for the explanations.
const H = rows.find(r => r.label.startsWith('H.')).plan;
const J = rows.find(r => r.label.startsWith('J2.')).plan;
const K = rows.find(r => r.label.startsWith('K2.')).plan;
const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%';
console.log('');
for (const [n, x] of [['H', H], ['J2', J], ['K2', K]]) {
  console.log(`Ranges (${n}): applications ${x.totals.range.apps.low.toFixed(0)} to ${x.totals.range.apps.high.toFixed(0)} (${pct(x.totals.range.apps.lowPct)} to ${pct(x.totals.range.apps.highPct)}); ` +
    `paid-media hires ${x.totals.range.hires.low.toFixed(1)} to ${x.totals.range.hires.high.toFixed(1)}; other sources ${x.totals.range.otherHires.low.toFixed(1)} to ${x.totals.range.otherHires.high.toFixed(1)}; ` +
    `all hires ${x.totals.range.allHires.low.toFixed(1)} to ${x.totals.range.allHires.high.toFixed(1)}`);
}
console.log(`Other-source months averaged: ${H.otherSources.months.map(m => m.month + ' ' + m.hires).join(', ')}`);
for (const [name, plan] of [['H', H], ['J', J]]) {
  console.log(`\n${name}: window ${plan.windowMonths.join(', ')}; unplaced reasons: ${plan.unplaced.reasons.join('; ') || 'none'}`);
  console.log('Location | open roles | spend | cap | cap reason | applications | hires | cost per hire');
  plan.locations.forEach(l => console.log(`${l.region} | ${l.vacancies} | ${gbp(l.spend)} | ${gbp(l.cap)} | ${l.capReason} | ${l.apps.toFixed(0)} | ${l.hires.toFixed(1)} | ${gbp(l.cph)}`));
  console.log('Platform | spend | applications | hires | cost per application');
  RAC.PLATFORMS.forEach(p => { const x = plan.platforms[p]; console.log(`${p} | ${gbp(x.spend)} | ${x.apps.toFixed(0)} | ${x.hires.toFixed(1)} | ${gbp(x.cpa)}`); });
}
const flagged = H.locations.flatMap(l => RAC.PLATFORMS.map(p => l.cells[p])).filter(c => c.spend > 0 && c.ceilingFlagged);
console.log(`\nH cells funded with no successful month (typical-month limit): ${flagged.map(c => `${c.region} ${c.platform} ${gbp(c.spend)}`).join('; ') || 'none'}`);
console.log(`October plan: settled months on rac_data.js (17 Sep) ${K ? '' : ''}${J.months ? Object.keys(J.months).filter(m => J.months[m].settled).slice(-8).join(', ') : ''}; window ${J.windowMonths.join(', ')}; with August uploaded on or after 24 Sep: ${K.windowMonths.join(', ')}`);

const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) fs.writeFileSync(out, JSON.stringify(rows.map(({ plan, ...r }) => r), null, 2));
