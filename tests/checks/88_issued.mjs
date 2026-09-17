// Checks for issued plans (planner/snapshot.js, C1 and C2): a snapshot holds
// everything the exports read, it comes back exactly as it went in, and the
// exports built from it are identical to the exports built from the plan.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';
import { FakePDF } from '../lib/fake_pdf.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const bt = JSON.parse(readRoot('data/backtest_results.json'));
  const D = calibrationData(RAC);
  const OCT = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 31 };
  const plan = RAC.plan.build('SMR', OCT, { ds: D.SMR.ds, A, eploy });
  const docs = [{ role: 'SMR', roleName: 'SMR (test)', plan, commentary: { legacy: [], plan: ['London is off this month.'] } }];
  const opts = { monthLabel: 'October 2026', planName: 'RAC Media Budgets - October 2026 v1', planId: 'v1', month: '2026-10',
    backtest: bt, code: { commit: 'feedface00' }, issuedBy: 'someone@enhancemedia.co.uk' };
  RAC.stamp.set({ commit: 'feedface00' });

  check('Issued plans: a snapshot carries the plan whole, including the figures JSON cannot write', () => {
    const snap = RAC.snapshot.of(docs, opts);
    const back = RAC.snapshot.restore(JSON.parse(JSON.stringify(snap)));
    const p = back.docs[0].plan;
    // Every figure on the plan comes back the same, including the ones JSON
    // cannot write: the plan uses Infinity for "no cap", and JSON turns that
    // into null on its own.
    [Infinity, -Infinity, NaN].forEach(v => {
      const out = RAC.snapshot.unpack(JSON.parse(JSON.stringify(RAC.snapshot.pack({ v }))));
      assert(String(out.v) === String(v), `${v} came back as ${out.v}`);
      assert(JSON.parse(JSON.stringify({ v })).v === null, 'JSON should lose ' + v + ' without the encoding');
    });
    const count = (o, seen = new Set()) => {
      if (typeof o === 'number') return Number.isFinite(o) ? 0 : 1;
      if (!o || typeof o !== 'object' || seen.has(o)) return 0;
      seen.add(o);
      return Object.values(o).reduce((a, x) => a + count(x, seen), 0);
    };
    const specials = count(plan);
    const caps = plan.locations.map(l => l.cap);
    plan.locations.forEach((l, i) => {
      const m = p.locations[i];
      assert(String(m.cap) === String(l.cap), `${l.region} cap ${m.cap} against ${l.cap}`);
      near(m.spend, l.spend, 1e-12, l.region + ' spend');
      RAC.PLATFORMS.forEach(q => {
        near(m.cells[q].hires, l.cells[q].hires, 1e-12, `${l.region} ${q} hires`);
        near(m.cells[q].plannedCpa, l.cells[q].plannedCpa, 1e-12, `${l.region} ${q} planned cost`);
        assert(m.cells[q].ceilingMonths.length === l.cells[q].ceilingMonths.length, `${l.region} ${q} cap months`);
      });
    });
    near(p.totals.apps, plan.totals.apps, 1e-12, 'applications');
    near(p.totals.allHires, plan.totals.allHires, 1e-12, 'hires');
    near(p.totals.range.hires.low, plan.totals.range.hires.low, 1e-12, 'hire range');
    assert(p.raw.rows.length === plan.raw.rows.length, 'monthly figures');
    assert(p.A.fingerprint === plan.A.fingerprint, 'assumptions fingerprint');
    assert(snap.issuedBy === opts.issuedBy && snap.month === '2026-10' && snap.planId === 'v1', 'who and what is recorded');
    assert(snap.code === 'feedface00' && /^Code feedfac · /.test(snap.stamp), 'the stamp records the code that produced it: ' + snap.stamp);
    return `${Math.round(RAC.snapshot.size(snap) / 1024)} KB of JSON; ${plan.locations.length} locations, ` +
      `${plan.raw.rows.length} monthly figures and ${specials} figures JSON cannot write (${caps.filter(c => !Number.isFinite(c)).length} of them location caps), all identical after a round trip`;
  });

  check('Issued plans: the PDF and the workings from a snapshot are identical to the ones from the plan', () => {
    const snap = JSON.parse(JSON.stringify(RAC.snapshot.of(docs, opts)));
    const back = RAC.snapshot.restore(snap);
    const live = RAC.pdf.build(FakePDF, docs, opts);
    const stored = RAC.pdf.build(FakePDF, back.docs, back.opts);
    assert(!stored.problems.length, 'PDF from the snapshot: ' + stored.problems.join('; '));
    assert(stored.texts.length === live.texts.length, `${stored.texts.length} strings against ${live.texts.length}`);
    const differ = live.texts.filter((t, i) => t !== stored.texts[i]);
    assert(!differ.length, 'PDF text differs: ' + differ.slice(0, 3).join(' | '));
    const wLive = RAC.workings.build(docs, opts);
    const wStored = RAC.workings.build(back.docs, back.opts);
    assert(wLive.checks.length === wStored.checks.length, 'workings formulas differ in number');
    const bad = wLive.checks.filter((c, i) => {
      const o = wStored.checks[i];
      return !o || o.sheet !== c.sheet || o.ref !== c.ref || o.formula !== c.formula
        || (c.value === null ? o.value !== null : Math.abs(o.value - c.value) > 1e-12);
    });
    assert(!bad.length, 'workings differ at ' + bad.slice(0, 3).map(c => c.sheet + '!' + c.ref).join(', '));
    return `PDF: ${live.texts.length} strings identical, ${live.pages} pages; workings: ${wLive.checks.length} formulas identical`;
  });

  check('Issued plans: the screens read a snapshot the same way they read a plan', () => {
    const snap = JSON.parse(JSON.stringify(RAC.snapshot.of(docs, opts)));
    const back = RAC.snapshot.restore(snap);
    const live = RAC.legacyShape.toLegacy(plan);
    const stored = RAC.legacyShape.toLegacy(back.docs[0].plan);
    ['predictedApps', 'predictedHires', 'paidHires', 'otherSourcesHires', 'deployable', 'unplacedBudget', 'beyondProven']
      .forEach(k => near(stored[k], live[k], 1e-12, k));
    assert(stored.locations.length === live.locations.length, 'locations');
    stored.locations.forEach((l, i) => near(l.spend, live.locations[i].spend, 1e-12, l.region + ' spend'));
    return `${stored.locations.length} locations and every headline figure identical, so a loaded issued plan shows what was issued`;
  });

  check('Issued plans: a snapshot from another version of the app is refused, not half read', () => {
    const snap = RAC.snapshot.of(docs, opts);
    let stopped = '';
    try { RAC.snapshot.restore({ ...snap, snapshotVersion: 99 }); } catch (e) { stopped = e.message; }
    assert(/different version/.test(stopped), 'a snapshot from another version was not refused: ' + stopped);
    assert(RAC.snapshot.key('2026-10', 'v1') === 'issued:2026-10:v1', 'key ' + RAC.snapshot.key('2026-10', 'v1'));
    return 'a snapshot with an unknown version is refused with a message; the key is issued:<month>:<plan>';
  });
}
