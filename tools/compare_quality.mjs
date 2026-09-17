// Compares two Eploy imports, for the change of quality measure (user
// decision, 17 September 2026): Progressed Past Screening before, "Quality
// Applies" after. The imports stay outside the repo; this prints aggregates.
//
// Usage (from the repo folder):
//   node tools/compare_quality.mjs OLD.json NEW.json
//
// For each import, with the matching factor and other-source factor re-measured
// on it (agreed settings unchanged):
//   quality rate by platform and role (own and as used), role quality rate,
//   hire rate after quality, the successful-month quality test on September
//   SMR settings, and September SMR hires at cap multiples 1, 2 and 3 with
//   platform fees (planned as an October plan).
import fs from 'node:fs';
import { loadPlanner, loadAssumptions } from '../tests/lib/planner.mjs';
import { calibrationData } from '../tests/lib/calibration_data.mjs';
import { septSmrSettings } from '../tests/lib/fixtures.mjs';

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) { console.error('usage: node tools/compare_quality.mjs OLD.json NEW.json'); process.exit(1); }
const RAC = loadPlanner();
const A = loadAssumptions(RAC);
const D = calibrationData(RAC);
const F = RAC.text.fmt;
const SEPT = { ...septSmrSettings(RAC.plan.NO_SPEND), planMonth: '2026-10', daysInMonth: 30 };

function measure(label, file) {
  const eploy = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tested = { paid_hire_reconciliation_factor: {}, other_hires_credit_factor: {}, other_hires_monthly: {} };
  for (const role of RAC.ROLES) {
    const r = RAC.testing.reconciliation(D[role].ds, eploy, A, role);
    tested.paid_hire_reconciliation_factor[role] = r.paidFactor;
    tested.other_hires_credit_factor[role] = r.otherFactor;
    tested.other_hires_monthly[role] = r.otherMean;
  }
  const A1 = RAC.assumptions.withValues(A, tested);
  const out = { label, measure: eploy.quality_measure || 'Progressed Past Screening', file: eploy.dataset.file, roles: {} };
  for (const role of RAC.ROLES) {
    const r = RAC.rates.build(eploy, A1, role);
    out.roles[role] = {
      months: `${r.screenMonths[0]} to ${r.screenMonths[r.screenMonths.length - 1]}`,
      roleQuality: r.roleScreen, hireAfterQuality: r.roleHire,
      platforms: Object.fromEntries(RAC.PLATFORMS.map(p => [p, { apps: r.platform[p].apps, quality: r.platform[p].passed, own: r.platform[p].own, used: r.platform[p].used }])),
      matching: tested.paid_hire_reconciliation_factor[role], credit: tested.other_hires_credit_factor[role],
    };
  }
  const env = { ds: D.SMR.ds, A: A1, eploy };
  const plan = RAC.plan.build('SMR', { ...SEPT, capMultiple: 1 }, env);
  let considered = 0, costPass = 0, qualityApplied = 0, setAside = 0;
  const p2 = RAC.plan.build('SMR', { ...SEPT, capMultiple: 2 }, env);
  p2.locations.forEach(l => RAC.PLATFORMS.forEach(q => l.cells[q].ceilingMonths.forEach(m => {
    considered++;
    if (m.passCost && m.passLimit) { costPass++; if (m.quality.applied) qualityApplied++; if (!m.quality.pass) setAside++; }
  })));
  out.qualityTest = { considered, costPass, qualityApplied, setAside };
  out.reach = plan.reach ? plan.reach.byMultiple : null;
  out.atOne = { apps: plan.totals.apps, quality: plan.totals.passed, hires: plan.totals.allHires, paid: plan.totals.hires, budgetForTarget: plan.budgetForTarget };
  out.fees = plan.fees.total;
  return out;
}

const a = measure('before', oldPath), b = measure('after', newPath);
console.log(`Before: ${a.measure} (${a.file}); after: ${b.measure} (${b.file})`);
for (const role of RAC.ROLES) {
  const x = a.roles[role], y = b.roles[role];
  console.log(`\n${role} (application months ${y.months})`);
  console.log('| | Before: applications | quality | own rate | used | After: quality | own rate | used |');
  console.log('|---|---|---|---|---|---|---|---|');
  RAC.PLATFORMS.forEach(p => {
    const o = x.platforms[p], n = y.platforms[p];
    console.log(`| ${RAC.PLATFORM_LABELS[p]} | ${o.apps} | ${o.quality} | ${F.pct(o.own, 1)} | ${F.pct(o.used, 1)} | ${n.quality} | ${F.pct(n.own, 1)} | ${F.pct(n.used, 1)} |`);
  });
  console.log(`| Role (all sources) | | | ${F.pct(x.roleQuality, 1)} | | | ${F.pct(y.roleQuality, 1)} | |`);
  console.log(`Hire rate after quality: before ${F.pct(x.hireAfterQuality, 1)}, after ${F.pct(y.hireAfterQuality, 1)}. ` +
    `Matching factor: before ${x.matching.toFixed(4)}, after ${y.matching.toFixed(4)}; other-source credit factor ${x.credit.toFixed(4)} to ${y.credit.toFixed(4)}.`);
}
console.log(`\nSuccessful-month quality test (September SMR settings, multiple 2): before ${JSON.stringify(a.qualityTest)}; after ${JSON.stringify(b.qualityTest)}`);
console.log(`\nSeptember SMR, planned as October (fees ${F.gbp(b.fees, 2)}), £${SEPT.budget}, ${SEPT.hireTarget} hires:`);
console.log('| Cap multiple | Hires before | Hires after | Target or most hires before | after |');
console.log('|---|---|---|---|---|');
const t = (r) => (r.budgetForTarget ? `${SEPT.hireTarget} at ${F.gbp(r.budgetForTarget)}` : `most ${F.num(r.mostHires)} at ${F.gbp(r.saturationBudget)}`);
if (a.reach && b.reach) a.reach.forEach((r, i) => console.log(`| ${r.multiple} | ${F.num(r.hiresAtBudget)} | ${F.num(b.reach[i].hiresAtBudget)} | ${t(r)} | ${t(b.reach[i])} |`));
else console.log('before', JSON.stringify(a.atOne), 'after', JSON.stringify(b.atOne));
console.log(`At multiple 1: applications ${F.int(a.atOne.apps)} and ${F.int(b.atOne.apps)}; quality applications ${F.int(a.atOne.quality)} and ${F.int(b.atOne.quality)}; paid-media hires ${F.num(a.atOne.paid)} and ${F.num(b.atOne.paid)}.`);
