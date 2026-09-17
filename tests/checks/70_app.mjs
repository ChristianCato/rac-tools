// Checks for the connection between the planner and the app (index.html),
// the screens' plan shape, and pacing for plans made before the release.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadPlannerContext, loadAssumptions, readRoot, manifest, ROOT } from '../lib/planner.mjs';
import { loadEngine, readGzJson } from '../lib/engine.mjs';
import { cellsFromRaw, septSmrSettings, compareCells, withRoleMonthly, PMAP } from '../lib/fixtures.mjs';
import { readDataFile } from '../lib/calibration_data.mjs';

const T = path.join(ROOT, 'tests');
const BASE = readGzJson(path.join(T, 'fixtures/rac_data_46aaae2.json.gz'));
const FLIVE = JSON.parse(fs.readFileSync(path.join(T, 'fixtures/smr_sept_live_2026-09-16.json'), 'utf8'));
const LEGACY = fs.readFileSync(path.join(T, 'legacy/engine_46aaae2.js'), 'utf8');
const html = readRoot('index.html');

// The shared database's upload record as the live app held it on 16 September.
function liveBench() {
  const months = [...new Set(FLIVE.raw.map(r => r[0]))].sort();
  const cells = cellsFromRaw(FLIVE.raw, 'SMR');
  for (const p of ['indeed', 'meta', 'google', 'appcast']) for (const k of Object.keys(BASE[p])) {
    if (k.endsWith('__SMR')) continue;
    for (const mo of months) { const v = BASE[p][k].monthly?.[mo]; if (v) ((cells[p] ||= {})[k] ||= {})[mo] = v; }
  }
  return { at: '2026-09-16', months, cells };
}

// Hire rates as the shared database held them: the same values as the repo
// file, which is what the live export was reproduced with.
function fileHireRates() {
  const rates = {};
  for (const p of ['indeed', 'meta', 'google', 'appcast']) for (const [k, c] of Object.entries(BASE[p])) {
    const [region, role] = k.split('__');
    if (!role || c.all_time?.hireCvr == null) continue;
    (((rates[role] ||= {})[region] ||= {}))[p] = c.all_time.hireCvr;
  }
  return { at: '2026-08-18', note: 'as the repo file', rates };
}

// The app as loaded on a given data file (by default the repo's rac_data.js).
function appWith({ bench = liveBench(), hire = fileHireRates(), csv, data = readDataFile(readRoot('rac_data.js')) } = {}) {
  const { RAC, window } = loadPlannerContext({ __AVP_DATA__: structuredClone(data) });
  const A = RAC.assumptions.parse(csv || readRoot('assumptions.csv'));
  RAC.app.use({ A, eploy: JSON.parse(readRoot('data/eploy_rates.json')), backtest: JSON.parse(readRoot('data/backtest_results.json')),
    legacySource: readRoot('planner/legacy_engine_46aaae2.js'), legacyDataText: readRoot('planner/legacy_rac_data_46aaae2.js') });
  window.__RAC_BENCH__ = bench;
  window.__RAC_HIRE__ = hire;
  return { RAC, window };
}

export default function (check, { assert, near }) {
  check('index.html loads the planner files in the manifest order', () => {
    const tags = [...html.matchAll(/<script src="((?:planner|exports)\/[^"]+)"><\/script>/g)].map(m => m[1]);
    assert(JSON.stringify(tags) === JSON.stringify(manifest().files), 'index.html: ' + tags.join(', '));
    assert(html.indexOf('src="rac_data.js"') < html.indexOf('src="planner/core.js"'), 'planner must load after rac_data.js');
    assert(html.indexOf('src="exports/checks.js"') < html.indexOf('<script type="text/babel"'), 'planner and export files must load before the app script');
    const ui = ['benchmarks_tab', 'plan_panels', 'method_tab'];
    const uiRe = new RegExp(ui.map(u => `<script type="text/babel" src="ui/${u}\\.jsx"></script>\\s*`).join('') + '<script type="text/babel" data-type="module">');
    assert(uiRe.test(html), 'UI files not loaded before the app');
    return `${tags.length} planner and export files, then ${ui.map(u => 'ui/' + u + '.jsx').join(', ')}, then the app`;
  });

  check('The pacing copy of the previous engine is the frozen engine, unchanged', () => {
    assert(readRoot('planner/legacy_engine_46aaae2.js') === LEGACY, 'planner/legacy_engine_46aaae2.js differs from tests/legacy/engine_46aaae2.js');
    return 'byte-identical';
  });

  check('index.html plans through the planner; the previous engine is marked legacy', () => {
    const wrapper = html.match(/function buildFundingPlan\(role, p\) \{[\s\S]*?\n\}/);
    assert(wrapper && /RAC\.app\.buildFundingPlan\(role, p, DATA, DATA_VERSION\)/.test(wrapper[0]), 'buildFundingPlan does not call the planner');
    assert((html.match(/function buildFundingPlan\(/g) || []).length === 1, 'more than one buildFundingPlan');
    const legacyCalls = [...html.matchAll(/legacyBuildFundingPlan\(/g)].length;
    assert(legacyCalls === 3, `legacyBuildFundingPlan named ${legacyCalls} times (definition and its own two trial runs expected)`);
    assert(/\/\/ LEGACY \(not used for plans since 18 September 2026/.test(html), 'legacy marker missing on the previous engine');
    assert(/DATA_VERSION \+= 1;\s*\n\s*if \(window\.RAC && window\.RAC\.app\) window\.RAC\.app\.invalidate\(\);/.test(html), 'resetDataCaches does not clear the planner');
    assert(/RAC\.app\.pacingPlan\(month, role,/.test(html), 'pacing does not go through RAC.app.pacingPlan');
    assert(/<RACUI\.BenchmarksTab /.test(html) && !/<BenchmarksTab /.test(html), 'Benchmarks tab not switched');
    assert((html.match(/Uses the previous cost method/g) || []).length >= 1 && /Historic CPA uses the previous cost method/.test(html), 'previous cost method labels missing');
    assert(/RAC\.app\.load\(\)/.test(html) && /planner === 'error'/.test(html), 'app does not wait for the planner files or show their errors');
    return 'one plan function, through the planner; legacy engine marked; caches cleared together; pacing, Benchmarks and labels connected';
  });

  check('The SMR and Patrol buttons beside the export buttons call the shared role switch', () => {
    assert(!/setExportRole/.test(html), 'setExportRole is still referenced');
    const header = html.slice(html.indexOf("{tool === 'planner' && ("), html.indexOf('exportWorkings(plannerState, roleView)'));
    assert(/onClick=\{\(\) => setRoleView\(r\)\}/.test(header), 'header buttons do not call setRoleView');
    assert(/const \[roleView, setRoleView\] = useState\('SMR'\);/.test(html), 'roleView state missing');
    return 'setRoleView(r); the browser check clicks both buttons';
  });

  check('Setup passes the core fields and the multiple to the planner; the file defaults are 0% and 1', () => {
    for (const f of ['otherHiresShare', 'otherHiresMonthly', 'remainingError']) {
      assert(html.includes(`${f}: (s.${f} && s.${f}[role] != null) ? s.${f}[role] : null,`), 'planParams does not pass ' + f);
    }
    assert(/includeSettling: !!s\.includeSettling,/.test(html), 'planParams does not pass includeSettling');
    assert(/<RACUI\.CoreSettings role=\{role\}/.test(html), 'Setup core settings panel missing');
    const ui = readRoot('ui/plan_panels.jsx');
    for (const f of ["'other-hires-share-' + role", "'other-hires-monthly-' + role", "'remaining-error-' + role", '"include-settling"', '"cap-multiple"']) {
      assert(ui.includes('field=' + (f.startsWith('"') ? f : '{' + f + '}')) || ui.includes('data-field=' + f), 'Setup field missing: ' + f);
    }
    const { RAC } = appWith();
    assert(RAC.app.defaultCapMultiple() === 1, 'default multiple ' + RAC.app.defaultCapMultiple());
    const a = RAC.app.buildFundingPlan('SMR', { ...septSmrSettings(-1), otherHiresShare: null }, BASE, 1);
    const b = RAC.app.buildFundingPlan('SMR', { ...septSmrSettings(-1), otherHiresShare: 0.3 }, BASE, 1);
    assert(a.otherHiresShare === 0 && b.otherHiresShare === 0.3, `shares ${a.otherHiresShare}, ${b.otherHiresShare}`);
    near(a.predictedHires, a.paidHires + a.otherSourcesHires, 1e-9, 'headline hires are paid media plus other sources');
    near(a.locations.reduce((x, l) => x + l.predHires, 0), a.paidHires, 1e-9, 'location rows are paid media only');
    return `blank share uses 0%; 30% reaches the plan (other sources ${a.otherSourcesHires.toFixed(2)} to ${b.otherSourcesHires.toFixed(2)})`;
  });

  check('The version source returns the deployed commit before any sign-in', () => {
    const api = readRoot('api/windsor-spend.mjs');
    const v = api.indexOf('if ((req.query || {}).version)');
    assert(v > 0 && v < api.indexOf('WINDSOR_API_KEY, SUPABASE_URL'), 'version branch missing or after the secret checks');
    assert(/commit: process\.env\.VERCEL_GIT_COMMIT_SHA \|\| null/.test(api), 'commit not returned');
    return 'GET /api/windsor-spend?version=1 returns VERCEL_GIT_COMMIT_SHA (null until Vercel exposes system variables)';
  });

  check('The pacing copy of the data file is the one the live app opened on (46aaae2)', () => {
    const D = readDataFile(readRoot('planner/legacy_rac_data_46aaae2.js'));
    assert(JSON.stringify(D) === JSON.stringify(BASE), 'planner/legacy_rac_data_46aaae2.js differs from the 46aaae2 data fixture');
    return `generated ${D.generated_at}, months ${D.data_months[0]} to ${D.data_months[D.data_months.length - 1]}`;
  });

  check('rac_data.js holds the previous file\'s months plus August; SMR equals the 16 September export', () => {
    const D = readDataFile(readRoot('rac_data.js'));
    const P = Object.values(PMAP);
    const months = (X) => [...new Set(P.flatMap(p => Object.values(X[p]).flatMap(c => Object.keys(c.monthly || {}))))].sort();
    assert(JSON.stringify(months(D)) === JSON.stringify([...months(BASE), '2026-08']), 'months ' + months(D).join(', '));
    for (const k of Object.keys(BASE)) {
      if (P.includes(k) || ['generated_at', 'data_current_through', 'data_months'].includes(k)) continue;
      assert(JSON.stringify(BASE[k]) === JSON.stringify(D[k]), `field ${k} changed`);
    }
    let same = 0;
    for (const p of P) {
      assert(JSON.stringify(Object.keys(D[p]).sort()) === JSON.stringify(Object.keys(BASE[p]).sort()), p + ' locations changed');
      for (const [k, c] of Object.entries(BASE[p])) for (const [mo, v] of Object.entries(c.monthly || {})) {
        if (mo >= '2026-01') continue;
        assert(JSON.stringify(D[p][k].monthly[mo]) === JSON.stringify(v), `${p} ${k} ${mo} changed`);
        same++;
      }
    }
    let rows = 0;
    for (const [mo, region, plat, spend, apps] of FLIVE.raw) {
      const c = D[PMAP[plat]][region + '__SMR'].monthly[mo];
      assert(c && Math.abs(c.spend - spend) < 0.005 && c.completes === apps, `SMR ${mo} ${region} ${plat} differs from the export`);
      rows++;
    }
    return `generated ${D.generated_at}; months ${months(D)[0]} to 2026-08; ${same} location-months before 2026 unchanged; all ${rows} SMR rows of the 16 September export matched`;
  });

  check('Pre-release plans pace exactly as the live app did: previous engine, same load order', () => {
    const P = septSmrSettings(-1);
    // Whatever rac_data.js now holds, pacing starts from the file the live app opened on.
    for (const data of [BASE, readDataFile(readRoot('rac_data.js'))]) {
      const { RAC } = appWith({ data });
      const p = RAC.app.pacingPlan('2026-09', 'SMR', P);
      const c = compareCells(p, FLIVE.cells, RAC.PLATFORMS);
      near(c.maxSpend, 0, 1, `starting from data generated ${data.generated_at}: largest spend gap (${c.worstSpend})`);
    }
    const { RAC } = appWith();
    const paced = RAC.app.pacingPlan('2026-09', 'SMR', P);
    // The replay that reproduced the live export (tests/run.mjs).
    const E = loadEngine(LEGACY, structuredClone(BASE));
    E.buildFundingPlan('SMR', P);
    const b = liveBench();
    E.applyMonths(b.months, b.cells, b.lastDate);
    E.setHireOverride(fileHireRates());
    const replay = E.buildFundingPlan('SMR', P);
    assert(JSON.stringify(paced.regionChannel) === JSON.stringify(replay.regionChannel), 'pacing rows differ from the replay');
    assert(E.benchWeight('2026-08') === 0, 'replay should leave August unweighted, as the live app did');
    const c = compareCells(paced, FLIVE.cells, RAC.PLATFORMS);
    near(c.maxSpend, 0, 1, `largest spend gap against the live export (${c.worstSpend})`);
    near(paced.budgetForTarget, FLIVE.summary['Budget to hit the application target'], 0, 'budget for 30 hires');
    const later = RAC.app.pacingPlan('2026-10', 'SMR', P, BASE, 1);
    assert(later.v2 && !paced.v2, 'October should pace on the planner and September on the previous engine');
    return `September SMR pacing rows equal the replay and the 16 September export (spend within £${c.maxSpend.toFixed(2)} on ${c.n} rows, £${paced.budgetForTarget} for 30 hires); October uses the planner`;
  });

  // The exports hold RAC spend figures, so they stay in the data folder: set
  // RAC_PACING_DIR to it. Each LIVE_pacing_<name>.xlsx is compared with
  // TEST_pacing_<name>.xlsx by tools/compare_pacing.py.
  check('Pacing for saved September plans matches the live app today', () => {
    const dir = process.env.RAC_PACING_DIR;
    if (!dir || !fs.existsSync(dir)) return 'SKIPPED: set RAC_PACING_DIR to the folder holding LIVE_pacing_*.xlsx and TEST_pacing_*.xlsx (Performance Pacing exports of the same saved September plans from the live app and the c3-build test link; never committed)';
    const pairs = fs.readdirSync(dir).filter(n => /^LIVE_pacing_.+\.xlsx$/.test(n)).map(n => [n, n.replace(/^LIVE_/, 'TEST_')]);
    assert(pairs.length > 0, 'no LIVE_pacing_*.xlsx in ' + dir);
    const out = [];
    for (const [live, test] of pairs) {
      assert(fs.existsSync(path.join(dir, test)), 'missing ' + test);
      const r = spawnSync('python', [path.join(ROOT, 'tools/compare_pacing.py'), path.join(dir, live), path.join(dir, test)], { encoding: 'utf8' });
      const text = (r.stdout || '') + (r.stderr || '');
      assert(r.status === 0 && /^MATCH:/m.test(text), `${live} against ${test}:
${text}`);
      const plan = (text.match(/^Plan: (.*?) \(/m) || [])[1] || '?';
      out.push(`${live.replace(/^LIVE_pacing_|\.xlsx$/g, '')}: ${plan}, every plan figure identical`);
    }
    return out.join('; ');
  });

  check('Screens get every field they read, and the figures add up', () => {
    const { RAC } = appWith();
    const plan = RAC.app.buildFundingPlan('SMR', { ...septSmrSettings(-1), appTarget: 700 }, BASE, 7);
    const top = ['appTarget', 'predictedApps', 'predLow', 'predHigh', 'predictedHires', 'predictedHiresLow', 'predictedHiresHigh',
      'budgetForTarget', 'deployable', 'demandPool', 'premiumHoldback', 'acHoldback', 'unplacedBudget', 'beyondProven',
      'totalVac', 'totalCount', 'coverageRate', 'pctOfTarget', 'aggBandPct'];
    top.forEach(k => assert(typeof plan[k] === 'number' && isFinite(plan[k]), 'missing or not a number: ' + k));
    ['budgetPinned', 'targetUnreachable', 'capsBinding', 'onTarget', 'solveOnHires'].forEach(k => assert(typeof plan[k] === 'boolean', 'not a flag: ' + k));
    const locKeys = ['region', 'vacancies', 'spend', 'predApps', 'appSubTarget', 'cpaSource', 'cpa', 'bandPct', 'predHires', 'hireCvr', 'platSpend', 'platShare', 'predLow', 'predHigh'];
    plan.locations.forEach(l => locKeys.forEach(k => assert(l[k] !== undefined, `${l.region}: missing ${k}`)));
    const platSum = RAC.PLATFORMS.reduce((a, p) => a + plan.platformTotals[p], 0);
    near(platSum, plan.locations.reduce((a, l) => a + l.spend, 0), 0.01, 'platform totals against location spend');
    RAC.PLATFORMS.forEach(p => {
      assert(plan.regionChannel[p].length === 12, p + ' regionChannel should list all 12 locations');
      near(plan.regionChannel[p].reduce((a, r) => a + r.spend, 0), plan.platformTotals[p], 0.01, p + ' regionChannel spend');
      near(plan.channelSummary.find(c => c.platform === p).predApps, plan.v2.platforms[p].apps, 1e-9, p + ' channel applications');
    });
    near(plan.locations.reduce((a, l) => a + l.appSubTarget, 0), 700, 1e-6, 'location application targets add up to the target');
    near(plan.predictedApps, plan.v2.totals.apps, 1e-9, 'applications');
    near(plan.deployable - plan.unplacedBudget, plan.locations.reduce((a, l) => a + l.spend, 0), 0.01, 'deployable less unplaced equals placed');
    return `${top.length} plan figures and ${locKeys.length} location fields present; totals agree; location application targets follow predicted applications`;
  });

  check('A broken assumptions file stops the app with the rows named', () => {
    const bad = readRoot('assumptions.csv').replace(/^(cap_multiple_default,[^,]*,)1,/m, '$1' + 'one,');
    const { RAC } = appWith({ csv: bad });
    assert(RAC.app.status() === 'error', 'status ' + RAC.app.status());
    assert(RAC.app.state.error.lines.some(l => /cap_multiple_default\): value should be a number/.test(l)), RAC.app.state.error.lines.join('; '));
    let threw = false;
    try { RAC.app.buildFundingPlan('SMR', septSmrSettings(-1), BASE, 1); } catch (e) { threw = true; }
    assert(threw, 'planned on an invalid file');
    return RAC.app.state.error.title + ' ' + RAC.app.state.error.lines[0];
  });

  check('New data in the app reaches the plan (data version and uploads)', () => {
    const { RAC, window } = appWith();
    const D = withRoleMonthly(BASE, FLIVE.raw, 'SMR');   // the app lays uploaded months into its data
    const a = RAC.app.buildFundingPlan('SMR', septSmrSettings(-1), D, 1).predictedApps;
    Object.values(D.indeed).forEach(c => { if (c.monthly && c.monthly['2026-05']) c.monthly['2026-05'].completes *= 3; });
    const same = RAC.app.buildFundingPlan('SMR', septSmrSettings(-1), D, 1).predictedApps;
    RAC.app.invalidate();
    const b = RAC.app.buildFundingPlan('SMR', septSmrSettings(-1), D, 2).predictedApps;
    assert(a === same, 'without a version change the stored plan should be reused');
    assert(Math.abs(b - a) > 1, 'the plan did not move after the data version changed');
    window.__RAC_BENCH__ = { ...window.__RAC_BENCH__, at: '2026-10-01' };
    const c = RAC.app.buildFundingPlan('SMR', septSmrSettings(-1), D, 2);
    assert(c.v2.months['2026-08'].settled, 'August should count once uploaded on 1 October');
    return `applications ${a.toFixed(1)} to ${b.toFixed(1)} after the data changed; August counted once the upload date moved past the settle period`;
  });
}
