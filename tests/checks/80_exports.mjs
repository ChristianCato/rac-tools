// Checks for what RAC sees: the Method and glossary text, the version stamp,
// and the automatic output checks the exports run before saving.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';
import { FakePDF } from '../lib/fake_pdf.mjs';

export default function (check, { assert }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const bt = JSON.parse(readRoot('data/backtest_results.json'));
  const D = calibrationData(RAC);
  const OCT = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 };
  const build = (role, inputs = OCT, A_ = A) => RAC.plan.build(role, inputs, { ds: D[role].ds, A: A_, eploy });
  const allText = (A_, role, plan) => [
    ...RAC.text.method(A_, role, plan, bt).flatMap(s => [s.heading, ...s.paras]),
    ...RAC.text.glossary(A_, role, plan).flatMap(g => [g.term, g.text]),
  ].join('\n');

  check('Method and glossary text pass the output checks, for both roles, with and without a plan', () => {
    const out = [];
    for (const role of RAC.ROLES) {
      for (const plan of [null, build(role), build(role, { ...OCT, planMonth: '2026-09' })]) {
        const t = allText(plan ? plan.A : A, role, plan);
        const problems = RAC.outputChecks.text(t);
        assert(!problems.length, `${role}: ${problems.join('; ')}`);
        assert(!/[—–]/.test(t), `${role}: dash character in the text`);
      }
      out.push(`${role}: ${allText(A, role, null).split(/\s+/).length} words`);
    }
    return out.join('; ') + '; no em-dashes, no Hiring Lab, no application targets, no broken figures';
  });

  check('The text quotes the values the plan used, so a changed value changes the words', () => {
    const t0 = allText(A, 'SMR', build('SMR'));
    for (const need of ['31 days', '0.65', '£48.20', '1.75%', '2.00%', 'October 2026', '1.096', 'testing gave 0.7', '200 further applications', '800', '12 test months', RAC.text.ATTRIBUTION]) {
      assert(t0.includes(need), 'SMR text lacks ' + need);
    }
    const changed = RAC.assumptions.withValues(A, { data_settle_days: 45, d1_role_rate: 0.5, fee_rate_meta: 0.03, screen_blend_n: { SMR: 350 } });
    const t1 = allText(changed, 'SMR', build('SMR', OCT, changed));
    for (const need of ['45 days', 'rate of 0.5', 'Meta 3.00%', 'as if 350 further']) assert(t1.includes(need), 'changed text lacks ' + need);
    for (const gone of ['31 days', 'rate of 0.65', 'Meta 2.00%']) assert(!t1.includes(gone), 'changed text still says ' + gone);
    const plan = build('SMR', { ...OCT, otherHiresMonthly: 12, remainingError: 1.2, capMultiple: 3 });
    const t2 = allText(plan.A, 'SMR', plan);
    for (const need of ['12.0 a month (set for this plan', 'set it to 1.200 (default 1.096)', '300% in this plan']) assert(t2.includes(need), 'plan text lacks ' + need);
    const patrol = allText(A, 'Patrol', build('Patrol'));
    assert(/For Patrol it did not hold, so the default is 1\.00/.test(patrol), 'Patrol text does not say its adjustment did not hold');
    assert(/September 2026|earlier month, so it includes no fees/.test(allText(A, 'SMR', build('SMR', { ...OCT, planMonth: '2026-09' }))), 'September plan text does not say it has no fees');
    return 'settle days, rates, fees, benchmark, adjustment and its rule, tested figures, row widening, switch rule and the agreed attribution wording all follow the values';
  });

  check('Version stamp: code, Eploy file and date, data month, assumptions date and fingerprint', () => {
    const plan = build('SMR');
    const code = { commit: '0123456789abcdef', branch: 'c3-build' };
    const s = RAC.stamp.of(plan, code), line = RAC.stamp.line(plan, code);
    assert(s.code === '0123456' && s.eployFile === eploy.dataset.file && s.eployDate === eploy.dataset.file_date.slice(0, 10), JSON.stringify(s));
    assert(s.dataTo === plan.stamps.data.settledTo && s.assumptionsDate === A.date && s.assumptionsFingerprint === A.fingerprint, JSON.stringify(s));
    assert(line.startsWith('Code 0123456 · Eploy ') && line.includes('ad platform data to July 2026') && line.includes(A.fingerprint), line);
    assert(!RAC.outputChecks.text(line).length, line);
    const over = build('SMR', { ...OCT, overrides: { fee_rate_meta: 0.03 } });
    assert(/plan overrides [0-9a-f]{8}/.test(RAC.stamp.line(over, code)), 'overrides not stamped');
    const unknown = RAC.stamp.line(plan, { commit: null });
    assert(unknown.startsWith('Code unknown'), unknown);
    const settling = build('SMR', { ...OCT, includeSettling: true });
    assert(/with August 2026 not yet settled/.test(RAC.stamp.line(settling, code)), 'settling month not stamped');
    return line;
  });

  check('The output checks catch what they are for (broken on purpose)', () => {
    const cases = [
      ['An em—dash', 'em-dash'], ['Source: Indeed Hiring Lab, 4.2%', 'Hiring Lab'], ['London app target 330', 'location application target'],
      ['Cost per application £NaN', 'broken figure'],
      ['Values live in the repository', 'names the repository'], ['Kept on GitHub', 'names the repository'], ['the git history', 'names the repository'],
      ['Hosted on Vercel', 'names the repository'], ['saved to Supabase', 'names the repository'], ['the data file is public', 'names the repository'],
      ['publicly downloadable', 'names the repository'], ['Repo data file', 'names the repository'],
      ["SMR data from rac_data.js (the live app's data)", 'refers to the app'], ['Set on Setup', 'refers to the app'],
      ['written by tools/calibrate.mjs', 'refers to the app'], ['Values live in assumptions.csv', 'refers to the app'],
      ['the Method tab in the app', 'refers to the app'], ['Window: [object Object].', 'refers to the app'],
    ];
    // Ordinary words that must not trip it.
    ['Published plans', 'the reporting period', 'digital', 'Report data file', 'set for this plan', 'Corrected RAC Eploy Data Oct 2025 - Aug 2026 v2.xlsx', 'applications', 'a plan can set it'].forEach(t =>
      assert(!RAC.outputChecks.text(t).length, `false alarm on "${t}": ${RAC.outputChecks.text(t).join('; ')}`));
    cases.forEach(([t, why]) => assert(RAC.outputChecks.text(t).some(p => p.startsWith(why)), `not caught: ${why}`));
    assert(RAC.outputChecks.pdfRows([{ label: 'London Indeed', spend: 0, cph: '£11,535' }]).length === 1, '£0 row with cost per hire not caught');
    assert(RAC.outputChecks.pdfRows([{ label: 'London Indeed', spend: 0, cph: '-' }, { label: 'SE Meta', spend: 10, cph: '£900' }]).length === 0, 'false alarm on rows');
    const plan = { hireTarget: 30 };
    assert(RAC.outputChecks.title('September 2026 SMR plan: 1,469 applications', plan).length === 1, 'title without the hire target not caught');
    assert(RAC.outputChecks.title('September 2026 SMR plan for 30 hires', plan).length === 0, 'correct title flagged');
    return `${cases.length} text faults, a £0 row with a cost per hire, and a title without the target were all caught`;
  });

  // Nothing RAC sees may mention the repository, GitHub, Vercel, Supabase, or
  // that any data or code is public (user, 18 September 2026). Built for real
  // and read as drawn, the same way as the Hiring Lab check.
  check('Nothing RAC sees names the repository, GitHub, Vercel or Supabase, or says anything is public', () => {
    const RE = /\b(repositor(y|ies)|repo|github|git|vercel|supabase|public(ly)?)\b/i;
    const code = { commit: '0123456789abcdef', branch: 'c3-build', environment: 'preview' };
    const bad = [];
    const scan = (where, texts) => texts.forEach(t => {
      const m = String(t).match(RE);
      if (m) bad.push(`${where}: "${String(t).slice(Math.max(0, m.index - 40), m.index + 40)}"`);
    });
    const opts = { monthLabel: 'October 2026', planName: 'RAC Media Budgets - October 2026 v1', backtest: bt, code };
    const docs = [];
    for (const role of RAC.ROLES) {
      const plan = build(role);
      docs.push({ role, roleName: role, plan, commentary: { legacy: [], plan: [] } });
      scan(`${role} method and glossary`, [...RAC.text.method(plan.A, role, plan, bt).flatMap(s => [s.heading, ...s.paras]),
        ...RAC.text.glossary(plan.A, role, plan).flatMap(g => [g.term, g.text])]);
    }
    const VAC = { SMR: { London: 18, 'West Midlands': 8 }, Patrol: { London: 12, 'West Midlands': 5 } };
    const one = RAC.onerac.build({ ...OCT, regions: ['London', 'West Midlands'], vacancies: VAC, budget: 20000, hireTarget: 6, premiumCampaigns: 0,
      acReserve: 0, platMin: {}, platMax: {}, coverage: {}, comboMin: {}, regionMin: {}, regionMax: {}, limits: {}, secondScenario: 0.15 },
      { ds: D.SMR.ds, A, eploy });
    docs.push({ role: 'OneRAC', roleName: 'OneRAC (SMR and Patrol)', plan: one, commentary: { legacy: [], plan: [] } });
    scan('OneRAC method', RAC.text.method(one.A, 'OneRAC', one, null).flatMap(s => [s.heading, ...s.paras]));
    let pdfs = 0, sheets = 0;
    for (const doc of docs) {
      const pdf = RAC.pdf.build(FakePDF, [doc], opts);
      scan(`${doc.role} PDF`, pdf.texts); pdfs++;
      assert(!pdf.problems.length, `${doc.role} PDF: ${pdf.problems.join('; ')}`);
      const w = RAC.workings.build([doc], opts);
      scan(`${doc.role} workings`, w.texts); sheets++;
      assert(!w.problems.length, `${doc.role} workings: ${w.problems.join('; ')}`);
      // The version stamp: a short code and nothing else of where it came from.
      const line = RAC.stamp.line(doc.plan, code);
      scan(`${doc.role} version stamp`, [line]);
      assert(!/https?:|www\.|\.app\b|\.com\b|c3-build|preview|0123456789abcdef/.test(line), 'the version stamp carries a link, the branch or the full code: ' + line);
      assert(line.startsWith('Code 0123456 · '), line);
    }
    // The in-app changelog, every entry, as the Changelog screen shows it.
    const html = readRoot('index.html');
    const i = html.indexOf('const CHANGELOG = ['), j = html.indexOf('\n];', i);
    const CL = new Function('return ' + html.slice(i + 'const CHANGELOG = '.length, j + 2))();
    const items = CL.flatMap(e => [e.date, ...(e.items || [])]);
    scan('in-app changelog', items);
    // The Changelog screen and the Method tab themselves: no link to where the code is kept.
    const clStart = html.indexOf('What has been changed in the plans'), clEnd = html.indexOf('data-panel="plan-changes"', clStart);
    assert(clStart > 0 && clEnd > clStart, 'Changelog screen text not found');
    scan('Changelog screen', [html.slice(clStart, clEnd)]);
    const methodTab = readRoot('ui/method_tab.jsx');
    scan('Method tab', [methodTab]);
    assert(!/github\.com|vercel\.app|supabase\.co/i.test(html.slice(clStart, clEnd) + methodTab), 'a link to where the app is kept');
    assert(!bad.length, bad.length + ' found: ' + bad.slice(0, 6).join(' | '));
    return `${pdfs} PDFs and ${sheets} workings (SMR, Patrol, OneRAC), Method and glossary text, the version stamp, ` +
      `${items.length} changelog lines, the Changelog screen and the Method tab: none names the repository, GitHub, Vercel or Supabase, or says anything is public`;
  });
}
