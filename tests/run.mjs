// Automatic checks for the RAC Tool Suite. Run from the repo folder:
//   node tests/run.mjs
// Needs Node 18 or later and nothing else. Exits with a failure code if any
// check fails. See tests/README.md for what each check covers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, loadEngine, readGzJson } from './lib/engine.mjs';
import { withRoleMonthly, cellsFromRaw, septSmrSettings, compareCells } from './lib/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const CURRENT = readSource(path.join(root, 'index.html'));
const LEGACY = fs.readFileSync(path.join(here, 'legacy/engine_46aaae2.js'), 'utf8');
const BASE = readGzJson(path.join(here, 'fixtures/rac_data_46aaae2.json.gz'));
const F2A = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/smr_sept_plan_2a.json'), 'utf8'));
const FLIVE = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/smr_sept_live_2026-09-16.json'), 'utf8'));

const results = [];
// A check passes by returning a note, fails by throwing, and is skipped by
// returning a note that starts with SKIPPED. Skipped checks are counted apart
// from passed ones.
function check(name, fn) {
  try {
    const notes = fn() || '';
    results.push({ name, status: notes.startsWith('SKIPPED') ? 'SKIP' : 'PASS', notes });
  } catch (e) {
    results.push({ name, status: 'FAIL', notes: process.env.RAC_TEST_STACK ? e.stack : e.message });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} (tolerance ${tol})`);
const sumCells = (f, key) => Object.values(f.cells).reduce((a, c) => a + c[key], 0);

// ---- September SMR plan 2a, as sent to RAC on 28 August -------------------
function plan2a(source) {
  const E = loadEngine(source, withRoleMonthly(BASE, F2A.raw, 'SMR'));
  const plan = E.buildFundingPlan('SMR', septSmrSettings(E.NO_SPEND));
  const c = compareCells(plan, F2A.cells, E.PLATFORMS);
  near(plan.predictedApps, sumCells(F2A, 'apps'), 0.05, 'Predicted applications');
  near(plan.predictedHires, sumCells(F2A, 'hires'), 0.005, 'Predicted hires');
  near(plan.aggBandPct, 21, 0, 'Range %');
  near(plan.beyondProven, 10483, 1, 'Spend above ceiling (PDF page 1)');
  // The PDF showed £101,950 and "matches your budget"; the solver works in £50 steps.
  near(plan.budgetForTarget, 101950, 50, 'Budget for 30 hires');
  assert(c.n === 32, `expected 32 location and platform rows, compared ${c.n}`);
  near(c.maxSpend, 0, 1, `Largest spend gap (${c.worstSpend})`);
  near(c.maxCpa, 0, 0.01, `Largest cost per application gap (${c.worstCpa})`);
  return `apps ${plan.predictedApps.toFixed(2)}, hires ${plan.predictedHires.toFixed(3)}, largest cell gaps £${c.maxSpend.toFixed(2)} spend, £${c.maxCpa.toFixed(3)} per application`;
}
check('Frozen engine rebuilds September SMR plan 2a', () => plan2a(LEGACY));
// Valid until Stage 2 replaces the forecast; after that only the frozen engine is held to plan 2a.
check('Current engine rebuilds September SMR plan 2a', () => plan2a(CURRENT));

// ---- Saved September SMR plan as the live app held it on 16 September ------
// Replays what the app did: open on the repo data file, then fold in the months
// from the shared database. On the frozen engine the month list is not
// refreshed, which is what produced the live export.
const liveMonths = [...new Set(FLIVE.raw.map(r => r[0]))].sort();
function foldInLive(E) {
  const cells = cellsFromRaw(FLIVE.raw, 'SMR');
  // Keep other roles' figures for the same months, since applyMonths clears a month for every role.
  for (const p of E.PLATFORMS) for (const k of Object.keys(BASE[p])) {
    if (k.endsWith('__SMR')) continue;
    for (const mo of liveMonths) { const v = BASE[p][k].monthly?.[mo]; if (v) ((cells[p] ||= {})[k] ||= {})[mo] = v; }
  }
  E.applyMonths(liveMonths, cells, null);
}
check('Frozen engine rebuilds the saved September SMR plan as held on 16 September', () => {
  const E = loadEngine(LEGACY, structuredClone(BASE));
  const P = septSmrSettings(E.NO_SPEND);
  E.buildFundingPlan('SMR', P);          // the app has opened and worked out its months
  foldInLive(E);                          // shared database months arrive
  E.setHireOverride(null);                // the hire rate read that follows clears the plan cache, not the month list
  const plan = E.buildFundingPlan('SMR', P);
  assert(E.benchWeight('2026-08') === 0, 'expected August to carry weight 0, as in the live export');
  near(plan.budgetForTarget, FLIVE.summary['Budget to hit the application target'], 0, 'Budget for 30 hires');
  near(plan.aggBandPct, 21, 0, 'Range %');
  // Plan against export on cost per application. Yorkshire & Humber Meta had no
  // months in the window, only August. The engine fell back to its all-time
  // figures, which include August, both for that row and inside the Meta
  // platform average every Meta row leans on. The export's column I formula
  // uses the window only. So the live plan and its workings disagreed on Meta
  // rows. Recorded here rather than hidden; Stage 2 replaces both methods.
  const metaRows = Object.keys(FLIVE.cells).filter(k => k.endsWith('|meta'));
  const c = compareCells(plan, FLIVE.cells, E.PLATFORMS, { skipCpa: metaRows });
  near(c.maxSpend, 0, 1, `Largest spend gap (${c.worstSpend})`);
  near(c.maxCpa, 0, 0.01, `Largest cost per application gap outside Meta (${c.worstCpa})`);
  const noWindow = Object.keys(E.DATA.meta).filter(k => k.endsWith('__SMR') &&
    Object.keys(E.DATA.meta[k].monthly || {}).length && !Object.keys(E.DATA.meta[k].monthly).some(mo => E.benchWeight(mo) > 0));
  assert(JSON.stringify(noWindow) === JSON.stringify(['Yorkshire & Humber__SMR']), 'Meta rows with data but no window months: ' + noWindow.join(', '));
  const gap = k => { const [r, p] = k.split('|'); const l = plan.locations.find(x => x.region === r); return l.platCpa[p] - FLIVE.cells[k].cpa; };
  const otherMeta = Math.max(...metaRows.filter(k => !k.startsWith('Yorkshire')).map(k => Math.abs(gap(k))));
  assert(otherMeta <= 0.25, 'Meta rows other than Yorkshire & Humber differ by up to £' + otherMeta.toFixed(3));
  const planApps = plan.predictedApps, exportApps = sumCells(FLIVE, 'apps');
  return `budget for 30 hires £${plan.budgetForTarget}; spend within £${c.maxSpend.toFixed(2)} in all ${c.n} rows; cost per application exact outside Meta. ` +
    `Meta rows differed from the export by up to £${otherMeta.toFixed(2)}, and Yorkshire & Humber Meta by £${gap('Yorkshire & Humber|meta').toFixed(2)}, ` +
    `so the plan showed ${planApps.toFixed(1)} applications against ${exportApps.toFixed(1)} in its workings`;
});

// ---- A month added after opening counts in the plan ----------------------
function addedMonthCounts(source) {
  const E = loadEngine(source, structuredClone(BASE));
  const P = septSmrSettings(E.NO_SPEND);
  E.buildFundingPlan('SMR', P);
  foldInLive(E);
  const after = E.buildFundingPlan('SMR', P);
  const fresh = loadEngine(source, structuredClone(E.DATA));   // a clean load of the same data
  const expected = fresh.buildFundingPlan('SMR', P);
  return { E, after, expected, fresh };
}
check('Frozen engine shows the fault: a month added after opening is ignored', () => {
  const { E, after, expected } = addedMonthCounts(LEGACY);
  assert(E.benchWeight('2026-08') === 0, 'expected the frozen engine to give August no weight');
  assert(Math.abs(after.predictedApps - expected.predictedApps) > 1, 'expected the frozen engine to differ from a clean load');
  return `after adding August: ${after.predictedApps.toFixed(1)} applications; clean load: ${expected.predictedApps.toFixed(1)}`;
});
check('Current engine: a month added after opening is weighted, and matches a clean load', () => {
  const { E, after, expected } = addedMonthCounts(CURRENT);
  const w = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map(m => E.benchWeight(m));
  assert(JSON.stringify(w) === JSON.stringify([1, 1, 2, 2, 2]), 'weights April to August were ' + w.join(', ') + ', expected 1, 1, 2, 2, 2');
  near(after.predictedApps, expected.predictedApps, 1e-9, 'Predicted applications against a clean load');
  near(after.predictedHires, expected.predictedHires, 1e-9, 'Predicted hires against a clean load');
  near(after.budgetForTarget, expected.budgetForTarget, 0, 'Budget for target against a clean load');
  return `weights April to August ${w.join(', ')}; ${after.predictedApps.toFixed(2)} applications, the same as a clean load`;
});

// ---- Test versions cannot save --------------------------------------------
check('Only rac-tools.vercel.app can write to the database', () => {
  assert(/const SAVE_HOST = 'rac-tools\.vercel\.app';/.test(html), 'SAVE_HOST is not rac-tools.vercel.app');
  assert(/const CAN_SAVE = typeof window !== 'undefined' && window\.location\.hostname === SAVE_HOST;/.test(html), 'CAN_SAVE is not tied to SAVE_HOST');
  const body = html.slice(html.indexOf('async function sbSet('), html.indexOf('async function sbSet(') + 200);
  assert(/^async function sbSet\(key, value\) \{\s*\n\s*if \(!CAN_SAVE\) return false;/.test(body), 'sbSet does not start with the CAN_SAVE guard');
  // Every other request to the database must be a read. Writes carry a method.
  const writes = [...html.matchAll(/fetch\([^)]*\{[^}]*method:\s*'(POST|PATCH|PUT|DELETE)'/gs)].map(m => m[0].slice(0, 80));
  const allowed = writes.filter(w => !w.includes('SB_URL') && (w.includes('/auth/v1/') || w.includes('/api/windsor-spend')));
  assert(writes.length === allowed.length, 'Unexpected write request outside sbSet: ' + writes.filter(w => !allowed.includes(w)).join(' | '));
  // Requests through sbFetch (the database helper) that carry a method are writes; only sbSet may make one.
  const sbSetStart = html.indexOf('async function sbSet('), sbSetEnd = html.indexOf('// The signed-in address');
  const dbWrites = [...html.matchAll(/sbFetch\([^;]*?method:\s*'[A-Z]+'/gs)].filter(m => m.index < sbSetStart || m.index > sbSetEnd);
  assert(dbWrites.length === 0, 'database write outside sbSet: ' + dbWrites.map(m => m[0].slice(0, 80)).join(' | '));
  assert(!/rest\/v1\/(?!rac_state)/.test(html), 'a database table other than rac_state is addressed directly');
  return 'sbSet is the only database write, and it returns before writing anywhere but the live address';
});

// ---- Patrol ---------------------------------------------------------------
check('September Patrol plan rebuild', () => {
  const f = path.join(here, 'fixtures/patrol_sept_plan.json');
  if (!fs.existsSync(f)) return 'SKIPPED: waiting for a Patrol workings export';
  throw new Error('Patrol fixture present but no check written yet');
});

// ---- Planner checks, one file per area in tests/checks ---------------------
for (const f of fs.readdirSync(path.join(here, 'checks')).filter(f => f.endsWith('.mjs')).sort()) {
  const mod = await import('./checks/' + f);
  await mod.default(check, { assert, near });
}

const count = (s) => results.filter(r => r.status === s).length;
for (const r of results) console.log(`${r.status}  ${r.name}\n      ${r.notes}`);
const [passed, skipped, failed] = ['PASS', 'SKIP', 'FAIL'].map(count);
console.log(`\n${results.length} checks: ${passed} passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
