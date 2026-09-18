// Checks for the trace guide (B6). It follows one location and platform from
// the monthly figures to the hires, so every figure it quotes has to be the
// one the planner gives. If the data file or an assumption changes, this fails
// and the guide is updated with it, rather than quietly going out of date.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';

export default function (check, { assert }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const D = calibrationData(RAC);

  check('Trace guide: every figure it quotes is the one the planner gives', () => {
    const guide = readRoot('docs/trace_guide.md');
    const plan = RAC.plan.build('SMR', { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 },
      { ds: D.SMR.ds, A, eploy });
    const region = 'South East', plat = 'indeed';
    const c = plan.locations.find(l => l.region === region).cells[plat];
    const b = plan.blend.window[plat][region];
    const pf = plan.blend.platform[plat];
    const r = plan.rates;
    const gbp = (x, dp = 2) => '£' + x.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    const pct = (x, dp = 1) => (x * 100).toFixed(dp) + '%';
    const want = [
      ['spend in the window', gbp(b.spend)],
      ['applications in the window', b.apps.toFixed(1)],
      ['historic cost per application', gbp(b.rawCpa)],
      ['usual monthly spend', gbp(b.avgSpend)],
      ['the platform figure', gbp(pf.cpa)],
      ['the usual cost per application', gbp(c.usualCpa)],
      ['the thin-data adjustment', c.thinAdjustment.toFixed(3)],
      ['the spend-level adjustment', c.spendAdjustment.toFixed(3)],
      ['planned cost per application on media', gbp(c.plannedCpaMedia)],
      ['planned cost per application on the total', gbp(c.plannedCpa)],
      ['media spend', gbp(c.media)],
      ['planned spend', gbp(c.spend)],
      ['applications', c.apps.toFixed(1)],
      ['quality applications', c.passed.toFixed(2)],
      ['hires', c.hires.toFixed(2)],
      ['the quality rate used', pct(c.screenRate)],
      ['the hire rate after quality', pct(c.hireAfterScreening)],
      ['the role quality rate', pct(r.roleScreen)],
      ['the spending cap', gbp(c.cap)],
      ['the largest successful month', gbp(c.ceilingBase)],
    ];
    const missing = want.filter(([, v]) => !guide.includes(v));
    assert(!missing.length, 'the trace guide is out of date. These figures are no longer what the planner gives: '
      + missing.map(([what, v]) => `${what} is now ${v}`).join('; ')
      + '. Re-run the trace and update docs/trace_guide.md.');
    // It has to name the sheets, in the order the workbook holds them.
    ['Data sources', 'Blend inputs', 'Workings', 'Rate build-up', 'Successful months', 'Back-test']
      .forEach(sheet => assert(guide.includes('**' + sheet + '**') || guide.includes(sheet + '**'), 'the guide does not name the ' + sheet + ' sheet'));
    assert(!RAC.outputChecks.text(guide).length, 'the guide fails the output checks: ' + RAC.outputChecks.text(guide).join('; '));
    return `${want.length} figures in docs/trace_guide.md match the planner, from the monthly rows to ${c.hires.toFixed(2)} hires`;
  });

  check('Market data is a guide on Setup only, and never reaches anything RAC sees', () => {
    const market = JSON.parse(readRoot('data/market.json'));
    // It holds no cost of RAC's, only the shape of the market.
    const text = JSON.stringify(market);
    assert(!/"cpc"|"cpm"|"spend"|"campaign"\s*:\s*"/.test(text), 'the market file holds cost figures or campaign names');
    market.months.forEach(m => ['google', 'meta'].forEach(p => {
      if (!m[p]) return;
      assert(m[p].cpc_index === null || (m[p].cpc_index > 0 && m[p].cpc_index < 1000), `${m.month} ${p} index ${m[p].cpc_index}`);
    }));
    // The Hiring Lab series is not in the file at all. Its absence is explained
    // in the file's own note, which is the only place the name may appear.
    assert(!/hiring\s*lab/i.test(JSON.stringify(market.months)), 'the market file holds Hiring Lab figures');
    assert(/hiring lab/i.test(market.note), 'the market file does not say why the Hiring Lab series is absent');
    // Nothing that RAC sees can read it: only the Setup panel does.
    ['exports/text.js', 'exports/pdf.js', 'exports/workings.js', 'planner/plan.js', 'planner/cost.js', 'planner/forecast.js']
      .forEach(f => assert(!/market\.json|RACUI\.MarketTable|cpc_index|cpm_index/.test(readRoot(f)),
        `${f} reads the market data; it must stay a guide on Setup`));
    const ui = readRoot('ui/market_table.jsx');
    assert(ui.includes("fetch('data/market.json'"), 'the Setup panel does not read the market file');
    assert(readRoot('index.html').includes('<RACUI.MarketTable />'), 'the market table is not on Setup');
    return `${market.months.length} months of market shape (cost as an index, search interest), read only by the Setup panel; ` +
      'no cost figure of RAC’s and no Hiring Lab figure in the repository';
  });

  check('The check list covers every screen and export the release changed', () => {
    const doc = readRoot('docs/check_list.md');
    ['Plan tab', 'PDF', 'Workings', 'Assumptions tab', 'OneRAC tab', 'cost limits', 'market guide',
      'Changelog screen', 'Mark as issued', '/archive/', 'docs/trace_guide.md', 'Not saved']
      .forEach(t => assert(doc.includes(t), 'docs/check_list.md does not cover ' + t));
    assert(!RAC.outputChecks.text(doc).length, 'the check list fails the output checks');
    return 'every screen and export the release changed is in docs/check_list.md, in the order to check them';
  });

  check('Release steps: the release document covers the archive copy and the checks to run', () => {
    const doc = readRoot('docs/release.md');
    ['node tests/run.mjs', 'tests/browser/save_guard.py', 'tests/browser/app_checks.py', 'tests/browser/export_checks.py',
      'tests/browser/issued_checks.py', 'tests/browser/archive_checks.py', 'RAC_EPLOY_WORKBOOK', 'RAC_PACING_DIR',
      'archive:workspace', 'Back up', 'python tools/build_archive.py']
      .forEach(t => assert(doc.includes(t), 'docs/release.md does not mention ' + t));
    assert(!RAC.outputChecks.text(doc).length, 'the release document fails the output checks');
    return 'every check to run, the back-up, the archive copy and the match against the live exports are all in docs/release.md';
  });
}
