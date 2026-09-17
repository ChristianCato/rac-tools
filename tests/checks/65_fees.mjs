// Checks for platform fees (user decisions, 17 September 2026): Indeed, Meta and Google
// spend includes a fee on top of media, from the first fee month onwards.
import { loadPlanner, loadAssumptions, readRoot } from '../lib/planner.mjs';
import { calibrationData } from '../lib/calibration_data.mjs';
import { septSmrSettings } from '../lib/fixtures.mjs';

export default function (check, { assert, near }) {
  const RAC = loadPlanner();
  const A = loadAssumptions(RAC);
  const eploy = JSON.parse(readRoot('data/eploy_rates.json'));
  const D = calibrationData(RAC);
  const env = { ds: D.SMR.ds, A, eploy };
  const SEPT = septSmrSettings(RAC.plan.NO_SPEND);
  const OCT = { ...SEPT, planMonth: '2026-10', daysInMonth: 31 };
  const P = RAC.PLATFORMS;
  const cells = (plan) => plan.locations.flatMap(l => P.map(p => l.cells[p]));
  const penny = (x) => Math.round(x * 100) / 100;
  const noFees = RAC.assumptions.withValues(A, { fee_rate_indeed: 0, fee_rate_meta: 0, fee_rate_google: 0 });
  const strip = (plan) => JSON.stringify({ t: plan.totals, l: plan.locations.map(l => [l.region, l.spend, l.apps, l.hires]), c: cells(plan).map(c => [c.spend, c.apps, c.hires, c.cap, c.plannedCpa]),
    u: plan.unplaced, h: plan.holdbacks.total, b: plan.budgetForTarget, m: plan.maxAchievable }, (k, v) => (k === 'cellsList' ? undefined : v));

  check('Fee rates are in assumptions.csv, agreed, and apply from October 2026', () => {
    const e = (k) => RAC.assumptions.entry(A, k, 'all');
    assert(e('fee_rate_indeed').parsed === 0.0175 && e('fee_rate_indeed').source === 'agreed', 'Indeed fee');
    assert(e('fee_rate_meta').parsed === 0.02 && e('fee_rate_meta').source === 'agreed', 'Meta fee');
    assert(e('fee_rate_google').parsed === 0.02 && e('fee_rate_google').source === 'agreed', 'Google fee');
    assert(e('fees_first_month').parsed === '2026-10', 'first fee month');
    const oct = RAC.plan.build('SMR', OCT, env), sep = RAC.plan.build('SMR', { ...SEPT, planMonth: '2026-09' }, env);
    assert(oct.fees.on && !sep.fees.on && sep.fees.total === 0, 'fees on in October only');
    assert(oct.fees.rates.indeed === 0.0175 && oct.fees.rates.meta === 0.02 && oct.fees.rates.google === 0.02 && oct.fees.rates.appcast === 0, 'rates by platform');
    P.filter(p => p !== 'appcast').forEach(p => assert(oct.fees.byPlatform[p].fee > 0, p + ' has no fee in October'));
    assert(oct.fees.byPlatform.appcast.fee === 0, 'Appcast has a fee');
    return `Indeed ${e('fee_rate_indeed').parsed}, Meta ${e('fee_rate_meta').parsed}, Google ${e('fee_rate_google').parsed}, Appcast none, from ${e('fees_first_month').parsed}; September plan fees £${sep.fees.total}, October £${oct.fees.total.toFixed(2)}`;
  });

  check('Fees add up to the penny, and the plan total never exceeds the budget', () => {
    const out = [];
    for (const [name, inputs] of [['October SMR', OCT], ['£250,000', { ...OCT, budget: 250000 }], ['£40,000', { ...OCT, budget: 40000 }],
      ['Scotland minimum', { ...OCT, regionMin: { Scotland: 9000 } }], ['no premium', { ...OCT, premiumCampaigns: 0 }]]) {
      const plan = RAC.plan.build('SMR', inputs, env);
      let feeSum = 0;
      for (const c of cells(plan)) {
        const rate = plan.fees.rates[c.platform];
        near(c.media + c.fee, c.spend, 1e-9, `${name} ${c.region} ${c.platform}: media + fee`);
        near(c.fee, c.media * rate, 1e-9, `${name} ${c.region} ${c.platform}: fee = media x ${rate}`);
        feeSum += c.fee;
      }
      const hb = plan.holdbacks;
      near(hb.premiumMedia, Math.round(inputs.premiumCampaigns * inputs.daysInMonth * 44), 0, `${name}: premium media`);
      near(hb.premiumFee, penny(hb.premiumMedia * 0.0175), 1e-9, `${name}: premium fee`);
      near(hb.premium, hb.premiumMedia + hb.premiumFee, 1e-9, `${name}: premium total`);
      near(plan.fees.total, feeSum + hb.premiumFee, 0.005, `${name}: total fees`);
      P.forEach(p => near(plan.fees.byPlatform[p].media + plan.fees.byPlatform[p].fee, plan.fees.byPlatform[p].total, 0.005, `${name} ${p} platform total`));
      near(P.reduce((a, p) => a + plan.fees.byPlatform[p].fee, 0) + hb.premiumFee, plan.fees.total, 0.005, `${name}: platform fees + premium fee`);
      near(hb.total + plan.placed + plan.unplaced.total, inputs.budget, 0.01, `${name}: hold-backs + placed + unplaced`);
      assert(hb.total + plan.placed <= inputs.budget + 0.005, `${name}: plan total £${hb.total + plan.placed} above the budget £${inputs.budget}`);
      assert(hb.combined === inputs.acReserve, `${name}: Combined Activity hold-back changed`);
      out.push(`${name}: fees £${plan.fees.total.toFixed(2)} (premium £${hb.premiumFee.toFixed(2)}), plan total £${(hb.total + plan.placed).toFixed(2)} of £${inputs.budget}`);
    }
    return out.join('; ');
  });

  check('Predictions use media after the fee; costs use the total including it', () => {
    const plan = RAC.plan.build('SMR', OCT, env);
    const base = RAC.plan.prepare('SMR', OCT, env);
    const bare = RAC.plan.prepare('SMR', { ...OCT, overrides: { fee_rate_indeed: 0, fee_rate_meta: 0, fee_rate_google: 0 } }, env);
    let n = 0;
    for (const c of cells(plan).filter(x => x.spend > 0)) {
      const noFee = RAC.forecast.at(bare.cells[c.region][c.platform].pc, c.media);
      near(c.apps, noFee.apps, 1e-9, `${c.region} ${c.platform}: applications at media`);
      near(c.plannedCpa, c.spend / c.apps, 1e-9, `${c.region} ${c.platform}: cost per application on the total`);
      if (c.hires > 0) near(c.cph, c.spend / c.hires, 1e-9, `${c.region} ${c.platform}: cost per hire on the total`);
      // Caps: past media spend x multiple, plus the fee.
      const cell = base.cells[c.region][c.platform];
      near(cell.cap, Math.min(cell.ceiling.ceiling * (1 + c.feeRate), cell.cpaCap), 1e-9, `${c.region} ${c.platform}: cap`);
      assert(c.media <= cell.ceiling.ceiling + 0.01, `${c.region} ${c.platform}: media £${c.media} above its media cap £${cell.ceiling.ceiling}`);
      n++;
    }
    // A cost per application limit binds on the total cost.
    const limit = { cpa: { 'South West': { indeed: 70 } } };
    const lim = RAC.plan.build('SMR', { ...OCT, limits: limit }, env).locations.find(l => l.region === 'South West').cells.indeed;
    assert(lim.spend > 0 && lim.plannedCpa <= 70 + 1e-6, `South West Indeed £${lim.plannedCpa} above the £70 limit`);
    // The split equalises the next hire's total cost across platforms.
    const sw = plan.locations.find(l => l.region === 'South West');
    const marg = P.filter(p => sw.cells[p].spend > 1 && sw.cells[p].spend < sw.cells[p].cap - 1)
      .map(p => RAC.forecast.marginalCostPerHire(base.cells['South West'][p].pc, sw.cells[p].spend));
    if (marg.length > 1) assert(Math.max(...marg) / Math.min(...marg) - 1 < 1e-6, 'marginal cost per hire differs across South West platforms: ' + marg);
    return `${n} funded rows: applications from media, costs on the total, caps on media plus fee; a £70 cost per application limit held at £${lim.plannedCpa.toFixed(2)}; South West next-hire cost equal on ${marg.length} uncapped platforms`;
  });

  check('With both fee rates at 0% an October plan is the same as before fees', () => {
    const zero = RAC.plan.build('SMR', OCT, { ...env, A: noFees });
    const before = RAC.plan.build('SMR', { ...OCT, planMonth: null }, env);
    assert(strip(zero) === strip(before), 'a 0% fee plan differs from a plan without fees');
    assert(zero.fees.total === 0, 'fees at 0%');
    const withFees = RAC.plan.build('SMR', OCT, env);
    assert(strip(withFees) !== strip(before), 'fees made no difference');
    return `identical: ${zero.totals.apps.toFixed(1)} applications, ${zero.totals.allHires.toFixed(2)} hires, budget for target ${zero.budgetForTarget || 'out of reach'}; with fees ${withFees.totals.apps.toFixed(1)} applications, ${withFees.totals.allHires.toFixed(2)} hires`;
  });

  check('September plans have no fees and pace as before; later plans pace on media spend', () => {
    const html = readRoot('index.html');
    assert(/planMonth: s\.planMonth \|\| null/.test(html), 'planParams does not pass the plan month');
    assert(/planSpend: r\.mediaSpend != null \? r\.mediaSpend : r\.spend/.test(html), 'pacing does not use media spend');
    const shaped = RAC.legacyShape.toLegacy(RAC.plan.build('SMR', OCT, env));
    const row = shaped.regionChannel.indeed.find(r => r.spend > 0);
    near(row.mediaSpend + row.fee, row.spend, 1e-9, 'pacing row media + fee');
    assert(row.mediaSpend < row.spend, 'October pacing row carries no fee');
    const sep = RAC.legacyShape.toLegacy(RAC.plan.build('SMR', { ...SEPT, planMonth: '2026-09' }, env));
    sep.regionChannel.indeed.forEach(r => assert(r.mediaSpend === r.spend, 'September row has a fee'));
    return `October South East Indeed pacing row: plan spend £${row.spend.toFixed(2)}, paced on media £${row.mediaSpend.toFixed(2)}; September rows have no fee (and September plans pace on the previous engine)`;
  });
}
