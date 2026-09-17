// Checks for the plan PDF (exports/pdf.js), run with a stand-in for jsPDF that
// records every string drawn. The browser check reads the real PDF.
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
  const build = (role, inputs = OCT) => RAC.plan.build(role, inputs, { ds: D[role].ds, A, eploy });
  const F = RAC.text.fmt;
  const doc = (role, plan, commentary = { legacy: ['The legacy plan put London first.'], plan: ['London is off this month.', 'Scotland is capped at £2,500.'] }) =>
    ({ role, roleName: `${role} (test)`, plan, commentary });
  const opts = { monthLabel: 'October 2026', planName: 'RAC Media Budgets - October 2026 v1', backtest: bt, code: { commit: 'feedface00' } };

  check('PDF: sections in the agreed order, every figure from the plan, checks clean', () => {
    const plan = build('SMR');
    const out = RAC.pdf.build(FakePDF, [doc('SMR', plan)], opts);
    assert(!out.problems.length, out.problems.join('; '));
    const pages = out.pdf.pages.map((_, i) => out.pdf.pageText(i));
    const firstLine = pages.map(p => p.split('\n')[0]);
    const order = ['Notes on the legacy plan', 'Notes on this plan', 'plan for 30 hires', 'plan for 30 hires'];
    order.forEach((t, i) => assert(firstLine[i].includes(t), `page ${i + 1} starts "${firstLine[i]}"`));
    const subs = pages.map(p => p.split('\n')[1]);
    const kinds = subs.map(s => (/summary/.test(s) ? 'summary' : /· by location ·/.test(s) ? 'locations' : /· by platform ·/.test(s) ? 'platforms' : /by location/.test(s) ? 'cells' : /method/.test(s) ? 'method' : 'notes'));
    const firstOf = (k) => kinds.indexOf(k);
    assert(firstOf('notes') < firstOf('summary') && firstOf('summary') < firstOf('locations') && firstOf('locations') < firstOf('platforms') &&
      firstOf('platforms') < firstOf('cells') && firstOf('cells') < firstOf('method'), 'section order ' + kinds.join(','));
    const all = out.texts.join('\n');
    const must = [F.gbp(plan.budget), F.gbp(plan.deployable), F.gbp(plan.placed), F.gbp(plan.unplaced.total), F.gbp(plan.fees.total, 2),
      F.num(plan.totals.allHires), F.num(plan.totals.hires), F.num(plan.totals.otherHires), F.int(plan.totals.apps), F.int(plan.totals.passed),
      `${F.num(plan.totals.range.allHires.low, 0)} to ${F.num(plan.totals.range.allHires.high, 0)}`,
      'Budget the plan could not place efficiently', 'Assumptions and risks', 'What the spending caps allow', RAC.text.ATTRIBUTION.slice(0, 60),
      'Cost limits: none set for this plan.'];
    plan.locations.forEach(l => { must.push(l.region, F.gbp(l.spend)); RAC.PLATFORMS.forEach(p => { if (l.cells[p].spend > 0) must.push(F.gbp(l.cells[p].spend), F.gbp(l.cells[p].plannedCpa, 2)); }); });
    RAC.PLATFORMS.forEach(p => must.push(F.gbp(plan.platforms[p].spend), F.gbp(plan.platforms[p].media)));
    plan.reach.byMultiple.forEach(m => must.push(F.num(m.hiresAtBudget)));
    const missing = must.filter(m => !all.includes(m));
    assert(!missing.length, 'PDF lacks: ' + missing.slice(0, 8).join(' | '));
    // Every page has the stamp and its page number.
    pages.forEach((p, i) => {
      assert(p.includes('Code feedfac · Eploy '), `page ${i + 1} has no stamp`);
      assert(p.includes(`Page ${i + 1} of ${pages.length}`), `page ${i + 1} number`);
    });
    // Method pages carry the shared text.
    const method = RAC.text.method(plan.A, 'SMR', plan, bt);
    method.forEach(s => assert(all.includes(s.heading), 'method heading missing: ' + s.heading));
    return `${pages.length} pages: ${[...new Set(kinds)].join(', ')}; ${must.length} planner figures found; stamp and page number on every page`;
  });

  check('PDF: cost limits set for a plan are printed with it', () => {
    const plan = build('SMR', { ...OCT, limits: { cph: { 'South East': 4000 }, cpa: { 'South East': { indeed: 45 } } } });
    const out = RAC.pdf.build(FakePDF, [doc('SMR', plan)], opts);
    assert(!out.problems.length, out.problems.join('; '));
    const all = out.texts.join(String.fromCharCode(10));
    assert(all.includes('Cost per hire limits: South East £4,000'), 'the cost per hire limit is not printed');
    assert(all.includes('Cost per application limits: South East Indeed £45.00'), 'the cost per application limit is not printed');
    const w = RAC.workings.build([doc('SMR', plan)], opts);
    const summary = w.sheets[0].rows.map(r => String(r.cells[0]));
    assert(summary.some(t => t === 'Most a hire may cost: South East'), 'the workings do not list the cost per hire limit');
    assert(summary.some(t => t === 'Most an application may cost: South East Indeed'), 'the workings do not list the cost per application limit');
    const c = plan.locations.find(l => l.region === 'South East').cells.indeed;
    assert(c.spend === 0 || c.plannedCpa <= 45 + 1e-6, `South East Indeed planned at £${c.plannedCpa.toFixed(2)} against a £45 limit`);
    return `both limits printed in the PDF and the workings; South East Indeed planned at £${c.plannedCpa.toFixed(2)} within its £45 limit`;
  });

  check('PDF: no cost per hire on £0 rows, no location application targets, title names the target', () => {
    const plan = build('SMR');
    const out = RAC.pdf.build(FakePDF, [doc('SMR', plan)], opts);
    const zero = out.rows.filter(r => !(r.spend > 0.005));
    assert(zero.length > 0, 'expected some £0 rows (London is set to no spend)');
    zero.forEach(r => assert(r.cph === '-', `£0 row ${r.label} shows ${r.cph}`));
    assert(out.titles.length === 1 && /plan for 30 hires$/.test(out.titles[0].title), out.titles.map(t => t.title).join());
    const noTarget = RAC.pdf.build(FakePDF, [doc('SMR', build('SMR', { ...OCT, hireTarget: 0 }))], opts);
    assert(!noTarget.problems.length && /October 2026 SMR \(test\) plan$/.test(noTarget.titles[0].title), noTarget.titles[0].title);
    assert(!/app(lication)?s? target/i.test(out.texts.join('\n')), 'application target in the PDF');
    return `${zero.length} £0 rows show no cost per hire; title "${out.titles[0].title}"`;
  });

  check('PDF: notes off drops only the notes; September has no fees; Patrol builds; a failing document is not saved', () => {
    const plan = build('SMR');
    const withNotes = RAC.pdf.build(FakePDF, [doc('SMR', plan)], opts);
    const without = RAC.pdf.build(FakePDF, [doc('SMR', plan)], { ...opts, notes: false });
    assert(withNotes.pages - without.pages === 2, `notes pages ${withNotes.pages} against ${without.pages}`);
    assert(!without.texts.some(t => t.includes('Notes on')), 'notes still present');
    const sep = RAC.pdf.build(FakePDF, [doc('SMR', build('SMR', { ...OCT, planMonth: '2026-09' }))], { ...opts, monthLabel: 'September 2026' });
    assert(!sep.problems.length && sep.texts.some(t => t.startsWith('Platform fees: none in this plan')), 'September fees line');
    assert(!sep.texts.some(t => t.includes('(including platform fees)')), 'September budget says it includes fees');
    const patrol = RAC.pdf.build(FakePDF, [doc('Patrol', build('Patrol', { ...OCT, hireTarget: 16 }))], opts);
    assert(!patrol.problems.length, patrol.problems.join('; '));
    // Broken on purpose: a note naming Hiring Lab, and a dash, stop the save.
    let saved = null;
    class Recording extends FakePDF { save(n) { saved = n; } }
    let refused = '';
    try { RAC.pdf.save(Recording, [doc('SMR', plan, { legacy: [], plan: ['Indeed Hiring Lab said demand fell 4%.', 'Costs rose — again.'] })], opts); }
    catch (e) { refused = e.message; }
    assert(/Hiring Lab named/.test(refused) && /em-dash/.test(refused) && saved === null, 'bad document was saved: ' + refused);
    const name = RAC.pdf.save(Recording, [doc('SMR', plan)], opts);
    assert(saved === name && name === 'RAC_October_2026_SMR_Plan.pdf', name);
    return `notes pages 2; September states no fees; Patrol ${patrol.pages} pages clean; a note naming Hiring Lab was refused; saved as ${name}`;
  });
}
