// Checks for what RAC sees: the Method and glossary text, the version stamp,
// and the automatic output checks the exports run before saving.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';

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
    for (const need of ['45 days', 'rate of 0.5', '3.00%', 'as if 350 further']) assert(t1.includes(need), 'changed text lacks ' + need);
    for (const gone of ['31 days', 'rate of 0.65', '2.00%']) assert(!t1.includes(gone), 'changed text still says ' + gone);
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
    ];
    cases.forEach(([t, why]) => assert(RAC.outputChecks.text(t).some(p => p.startsWith(why)), `not caught: ${why}`));
    assert(RAC.outputChecks.pdfRows([{ label: 'London Indeed', spend: 0, cph: '£11,535' }]).length === 1, '£0 row with cost per hire not caught');
    assert(RAC.outputChecks.pdfRows([{ label: 'London Indeed', spend: 0, cph: '-' }, { label: 'SE Meta', spend: 10, cph: '£900' }]).length === 0, 'false alarm on rows');
    const plan = { hireTarget: 30 };
    assert(RAC.outputChecks.title('September 2026 SMR plan: 1,469 applications', plan).length === 1, 'title without the hire target not caught');
    assert(RAC.outputChecks.title('September 2026 SMR plan for 30 hires', plan).length === 0, 'correct title flagged');
    return `${cases.length} text faults, a £0 row with a cost per hire, and a title without the target were all caught`;
  });
}
