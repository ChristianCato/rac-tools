// Checks for the workings export (exports/workings.js). These read the sheet
// model the export builds. The browser check writes the real workbook,
// recalculates it in LibreOffice and compares every formula with the planner.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const bt = JSON.parse(readRoot('data/backtest_results.json'));
  const D = calibrationData(RAC);
  const OCT = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 };
  const build = (role, inputs = OCT) => RAC.plan.build(role, inputs, { ds: D[role].ds, A, eploy });
  const opts = { monthLabel: 'October 2026', planName: 'RAC Media Budgets - October 2026 v1', backtest: bt, code: { commit: 'feedface00' } };
  const doc = (role, plan) => ({ role, roleName: `${role} (test)`, plan });

  // The value in a cell of the built model, whether a plain value or a formula.
  function cellValue(built, ref) {
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/.exec(ref);
    if (!m) return undefined;
    const sheet = built.sheets.find(s => s.name === m[1]);
    if (!sheet) return undefined;
    let col = 0;
    for (const ch of m[2]) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = sheet.rows[Number(m[3]) - 1];
    if (!row) return undefined;
    const v = row.cells[col - 1];
    return v && typeof v === 'object' && 'formula' in v ? v.value : v;
  }

  check('Workings export: the sheets the plan needs, in order, with no output-check problems', () => {
    const plan = build('SMR');
    const out = RAC.workings.build([doc('SMR', plan)], opts);
    assert(!out.problems.length, out.problems.join('; '));
    const names = out.sheets.map(s => s.name);
    const want = ['Summary', 'Workings', 'Assumptions', 'Data sources', 'Blend inputs', 'Rate build-up', 'Back-test', 'Successful months', 'Allocation steps', 'Method'];
    assert(names.join(',') === want.join(','), 'sheets: ' + names.join(', '));
    const rows = out.sheets.map(s => `${s.name} ${s.rows.length}`);
    assert(out.checks.length > 200, 'only ' + out.checks.length + ' formulas carry a planner value');
    return `${names.length} sheets (${rows.join(', ')}); ${out.checks.length} formulas, each carrying the planner's figure`;
  });

  check('Workings export: every reference points at the cell holding that figure', () => {
    const plan = build('SMR');
    const out = RAC.workings.build([doc('SMR', plan)], opts);
    const refRe = /(?:'[^']+'|[A-Za-z][A-Za-z0-9_]*)!\$[A-Z]+\$\d+/g;
    let plain = 0, inside = 0;
    out.checks.forEach(c => {
      const refs = c.formula.match(refRe) || [];
      refs.forEach(r => {
        const v = cellValue(out, r);
        assert(v !== undefined, `${c.sheet}!${c.ref} points at ${r}, which is not a cell`);
        inside += 1;
      });
      // A formula that is only a reference must equal what it points at.
      if (refs.length === 1 && c.formula === refs[0]) {
        near(cellValue(out, refs[0]), c.value, Math.max(1e-9, Math.abs(c.value) * 1e-12), `${c.sheet}!${c.ref} -> ${refs[0]}`);
        plain += 1;
      }
    });
    assert(plain > 20, `only ${plain} plain references checked`);
    return `${inside} references resolve; ${plain} of them are a single reference and match the figure they point at`;
  });

  check('Workings export: the Workings sheet holds the planner’s figures for every location and platform', () => {
    const plan = build('SMR');
    const out = RAC.workings.build([doc('SMR', plan)], opts);
    const sheet = out.sheets.find(s => s.name === 'Workings');
    const head = sheet.rows.findIndex(r => r.kind === 'head');
    const cols = sheet.rows[head].cells;
    const ix = (label) => { const i = cols.indexOf(label); assert(i >= 0, 'no column ' + label); return i; };
    const get = (row, label) => { const v = row.cells[ix(label)]; return v && typeof v === 'object' ? v.value : v; };
    let n = 0;
    plan.locations.forEach(loc => RAC.PLATFORMS.forEach(plat => {
      const c = loc.cells[plat];
      const row = sheet.rows.find(r => r.kind === 'body' && r.cells[0] === loc.region && r.cells[1] === RAC.PLATFORM_LABELS[plat]);
      assert(row, `no row for ${loc.region} ${plat}`);
      near(get(row, 'Planned spend'), c.spend, 1e-9, `${loc.region} ${plat} spend`);
      near(get(row, 'Hires'), c.hires, 1e-9, `${loc.region} ${plat} hires`);
      near(get(row, 'Applications'), c.apps, 1e-9, `${loc.region} ${plat} applications`);
      near(get(row, 'Quality applications'), c.passed, 1e-9, `${loc.region} ${plat} quality applications`);
      near(get(row, 'Spending cap'), c.cap, 1e-9, `${loc.region} ${plat} cap`);
      if (c.spend > 0.005) {
        near(get(row, 'Planned cost per application (total)'), c.plannedCpa, 1e-9, `${loc.region} ${plat} planned cost`);
        near(get(row, 'Media spend'), c.media, 1e-9, `${loc.region} ${plat} media`);
        near(get(row, 'Platform fee'), c.fee, 1e-9, `${loc.region} ${plat} fee`);
      }
      n += 1;
    }));
    const total = sheet.rows[out.totalRow - 1];
    near(get(total, 'Planned spend'), plan.totals.spend, 1e-9, 'plan total spend');
    near(get(total, 'Hires'), plan.totals.hires, 1e-9, 'plan total hires');
    near(get(total, 'Applications'), plan.totals.apps, 1e-9, 'plan total applications');
    return `${n} location and platform rows and the plan total match the planner`;
  });

  check('Workings export: the monthly figures and their weights are the ones the plan used', () => {
    const plan = build('SMR');
    const out = RAC.workings.build([doc('SMR', plan)], opts);
    const sheet = out.sheets.find(s => s.name === 'Data sources');
    const body = sheet.rows.filter(r => r.kind === 'body');
    assert(body.length === plan.raw.rows.length, `${body.length} rows against ${plan.raw.rows.length} monthly figures`);
    // Add the rows up by hand and compare with the window figures the plan used.
    let checked = 0;
    RAC.PLATFORMS.forEach(plat => plan.allRegions.forEach(region => {
      const mine = body.filter(r => r.cells[0] === RAC.PLATFORM_LABELS[plat] && r.cells[1] === region);
      const w = mine.reduce((a, r) => a + r.cells[9], 0);
      const spend = mine.reduce((a, r) => a + r.cells[9] * r.cells[3], 0);
      const apps = mine.reduce((a, r) => a + r.cells[9] * r.cells[4], 0);
      const st = plan.blend.window[plat][region];
      near(w, st.wsum, 1e-9, `${region} ${plat} weight`);
      near(spend, st.wspend, 1e-6, `${region} ${plat} weighted spend`);
      near(apps, st.wapps, 1e-6, `${region} ${plat} weighted applications`);
      near(w > 0 ? spend * plan.raw.monthCount / w : 0, st.spend, 1e-6, `${region} ${plat} spend in the window`);
      checked += 1;
    }));
    const weights = [...new Set(body.map(r => r.cells[9]))].sort();
    return `${body.length} monthly figures over ${checked} location and platform cells add up to the plan's window figures; weights used: ${weights.join(', ')}`;
  });

  check('Workings export: a plan with no fees, and Patrol, both build cleanly', () => {
    const sept = RAC.workings.build([doc('SMR', build('SMR', { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-09', daysInMonth: 30 }))],
      { ...opts, monthLabel: 'September 2026' });
    assert(!sept.problems.length, 'September: ' + sept.problems.join('; '));
    const summary = sept.sheets[0].rows.map(r => r.cells[0]).filter(x => typeof x === 'string');
    assert(summary.some(t => t === 'Platform fees in the plan'), 'the fees line is missing');
    const patrol = RAC.workings.build([doc('Patrol', build('Patrol'))], opts);
    assert(!patrol.problems.length, 'Patrol: ' + patrol.problems.join('; '));
    assert(RAC.workings.fileName([doc('SMR', build('SMR'))], opts) === 'RAC_October_2026_SMR_Workings.xlsx', 'file name');
    return `September (no fees) ${sept.checks.length} formulas; Patrol ${patrol.checks.length} formulas; file name RAC_October_2026_SMR_Workings.xlsx`;
  });

  check('Workings export: a document that fails the output checks is caught', () => {
    const plan = build('SMR');
    const broken = { ...plan, unplaced: { ...plan.unplaced, reasons: ['Hiring Lab said so'] } };
    const out = RAC.workings.build([doc('SMR', broken)], opts);
    assert(out.problems.some(p => /Hiring Lab/.test(p)), 'problems: ' + out.problems.join('; '));
    // A cost per hire on a row with no spend is caught too.
    const rows = [{ label: 'London Indeed', spend: 0, cph: 11535 }];
    assert(RAC.outputChecks.pdfRows(rows).length === 1, 'a £0 row with a cost per hire was not caught');
    return 'a banned name and a cost per hire on a £0 row were both caught';
  });
}
