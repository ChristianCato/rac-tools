// RAC planner: the words that explain the plan. One source for the Method
// tab, the PDF's method and glossary pages, and the workings export.
//
// Every figure quoted comes from assumptions.csv (and, where a plan is given,
// from that plan), so the text cannot drift from what the planner does.
// Writing rules: plain language, no em-dashes, data in the past tense, "we"
// means Enhance. tests/checks/80_exports.mjs scans the output.
//
//   RAC.text.method(A, role, plan?, backtest?)   [{ heading, paras: [..] }]
//   RAC.text.glossary(A, role, plan?)            [{ term, text }]
//   RAC.text.assumptionRows(A, role, plan?)      the values the plan used,
//                                                with source and tested figure
//   RAC.text.fmt                                 formatting helpers
(function (RAC) {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmt = {
    month: (mo) => (mo ? `${MONTHS[Number(mo.slice(5, 7)) - 1]} ${mo.slice(0, 4)}` : ''),
    monthShort: (mo) => (mo ? `${MONTHS[Number(mo.slice(5, 7)) - 1].slice(0, 3)} ${mo.slice(2, 4)}` : ''),
    gbp: (x, dp = 0) => (x === null || x === undefined || !isFinite(x) ? '-'
      : (x < 0 ? '-' : '') + '£' + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
    int: (x) => (x === null || x === undefined || !isFinite(x) ? '-' : Math.round(x).toLocaleString('en-GB')),
    num: (x, dp = 1) => (x === null || x === undefined || !isFinite(x) ? '-' : x.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
    pct: (x, dp = 0) => (x === null || x === undefined || !isFinite(x) ? '-' : (x * 100).toFixed(dp) + '%'),
    signedPct: (x, dp = 0) => (x === null || x === undefined || !isFinite(x) ? '-' : (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(dp) + '%'),
    list: (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]),
  };

  // Agreed wording (addendum 2.2).
  const ATTRIBUTION = 'Quality and hire rates by platform came from RAC’s applicant tracking data, which credited each application to the last source a candidate used before applying. ' +
    'Earlier interactions, particularly with Meta and Google, likely had more influence than this shows, so their contribution to quality applications and hires may have been undervalued. ' +
    'For this reason, Meta and Google rates were moved towards the role average. We will assess this separately.';
  // Agreed wording for the quality measure (user, 17 September 2026).
  const QUALITY_DEFINITION = 'A quality application is one that progressed past screening, or was closed at screening for a reason other than the candidate’s suitability, ' +
    'such as location, salary, the role being filled, withdrawal, or being banked for future roles. Repeat applications from the same candidate are not counted.';
  const RANGE_LINE = 'The range shows how far our model has missed in testing, and it is wider wherever there is less evidence behind the figure.';
  const ROW_RANGE_LINE = 'Row ranges are wider than the total and do not add up to it, because single locations swing more than the plan as a whole.';

  const OFF = 100000;

  function values(A, role, plan) {
    const g = (k) => RAC.assumptions.get(A, k, role);
    const e = (k) => RAC.assumptions.entry(A, k, role) || {};
    const fees = plan && plan.fees;
    return {
      premiumRate: g('indeed_premium_rate'),
      benchmark: g('role_cpa_benchmark'),
      cpaPrior: g('cpa_prior_apps'),
      settleDays: g('data_settle_days'),
      typicalMin: g('typical_month_min_spend'),
      eployFirst: g('eploy_first_month'),
      hireMaturity: g('hire_maturity_months'),
      screenMaturity: g('screening_maturity_months'),
      screenBlend: g('screen_blend_n'), screenBlendTested: e('screen_blend_n').testedValue,
      pull: g('meta_google_pull'),
      locBlend: g('location_screen_blend_n'), locBlendTested: e('location_screen_blend_n').testedValue,
      regionBlend: g('region_hire_blend_n'), regionBlendTested: e('region_hire_blend_n').testedValue,
      paidFactor: g('paid_hire_reconciliation_factor'),
      creditFactor: g('other_hires_credit_factor'),
      otherMonthly: plan ? plan.otherHiresMonthly : g('other_hires_monthly'),
      otherMonthlyDefault: g('other_hires_monthly'),
      share: plan ? plan.otherHiresShare : g('other_hires_credited_share'),
      recentFrom: g('other_hires_recent_from'),
      d1Rate: g('d1_role_rate'), d1RateTested: e('d1_role_rate').testedValue,
      d1Strength: g('d1_prior_strength'),
      bias: plan ? plan.remainingError : g('remaining_error_factor'),
      biasDefault: g('remaining_error_factor'), biasTested: e('remaining_error_factor').testedValue,
      rangeLow: g('range_apps_low'), rangeHigh: g('range_apps_high'),
      widen: g('row_widen_apps'), widenTested: e('row_widen_apps').testedValue,
      lowRateSd: g('low_confidence_rate_sd'), lowApps: g('low_confidence_min_apps'),
      draws: g('hire_range_draws'),
      testFirst: g('backtest_first_month'), minHistory: g('test_min_history_months'),
      minGain: g('own_figure_min_gain'), switchMonths: g('switch_min_test_months'),
      pLow: g('range_low_percentile'), pHigh: g('range_high_percentile'), hitRateMonths: g('range_hit_rate_min_months'),
      capFirst: g('ceiling_first_month'), capMinSpend: g('ceiling_min_spend'), capMinApps: g('ceiling_min_apps'),
      qualityDrop: g('quality_test_drop'), qualityMin: g('quality_test_min_expected'),
      capMultiple: plan ? plan.capMultiple : g('cap_multiple_default'), capDefault: g('cap_multiple_default'),
      feeIndeed: g('fee_rate_indeed'), feeMeta: g('fee_rate_meta'), feeGoogle: g('fee_rate_google'), feesFrom: g('fees_first_month'),
      feesOn: fees ? fees.on : null,
      includesDisplay: g('combined_activity_includes_display') === 1,
    };
  }

  function method(A, role, plan, backtest) {
    const v = values(A, role, plan);
    const f = fmt;
    const tested = (x) => (x === null || x === undefined ? '' : ` (testing gave ${x >= OFF ? 'the role average' : x})`);
    const btRole = backtest && backtest.roles && backtest.roles[role];
    const testMonths = btRole ? btRole.applications.map(o => o.month) : [];
    const window = plan && plan.windowMonths && plan.windowMonths.length
      ? `This plan used ${f.month(plan.windowMonths[0])} to ${f.month(plan.windowMonths[plan.windowMonths.length - 1])}.` : '';
    const sections = [];
    const add = (heading, ...paras) => sections.push({ heading, paras: paras.filter(Boolean) });

    add('What the plan does',
      `The plan starts from the monthly budget${v.feesOn === false ? '' : ', which includes platform fees'}. Indeed Premium (campaigns x days in the month x ${f.gbp(v.premiumRate)} a day, plus the Indeed fee where fees apply) and the Combined Activity reserve come off the top${v.includesDisplay ? ', and the Google Display remarketing campaign is part of Combined Activity, so its spend sits in that reserve rather than in the planned Google spend' : ''}. What remains is the deployable budget.`,
      `The deployable budget is split between live locations by their share of open roles${plan && plan.efficiency && plan.efficiency.weight > 0 ? `, moved ${f.pct(plan.efficiency.weight)} of the way towards where a hire is predicted to cost least (the efficiency setting)` : ''}, within any location minimums and maximums, the spending caps and any cost limits. Money a location cannot take moves to locations with room, again by open roles. Anything no location can take is shown as budget the plan could not place efficiently.`,
      'Within each location, money goes to whichever platform delivers the next hire most cheaply, until the platforms cost the same per extra hire or reach their spending caps. Minimums and floors set on Setup are then applied, but never above a spending cap; where a cap stops a minimum being met, the plan says by how much.',
      'Predicted applications, quality applications and hires come from one forecast, used by the screens, this document and the workings export alike.');

    add('Data used',
      `Monthly spend and applications by location and platform came from the ad platforms (Indeed from RAC’s applicant tracking data). Past spend was media spend, without platform fees. A month counted once it was complete and at least ${v.settleDays} days had passed between its last day and the date the data was taken, so applications recorded late were in. A plan can choose to include complete months still settling; each one used is flagged as not yet settled, so its figures may change. ${window}`,
      `Quality and hire rates came from RAC’s applicant tracking data (Eploy), from applications made in ${f.month(v.eployFirst)} onwards. Quality outcomes counted once ${v.screenMaturity} further months had started, and hires once ${v.hireMaturity} further months had started, so recent applications with unfinished outcomes did not pull the rates down.`,
      ATTRIBUTION);

    add('Cost per application',
      `The usual cost per application for a location and platform was its spend over applications in the months used, with recent months weighted as set on Setup. Where a location had few applications, its figure was pulled towards the platform’s figure for the role, and the platform’s figure towards the role benchmark (${f.gbp(v.benchmark, 2)}): a figure with ${v.cpaPrior} applications behind it carried half the weight.`,
      `Cost per application rises as spend rises. The plan uses a rate of ${v.d1Rate}${v.d1Strength >= OFF ? ', shared across platforms' : ''}: doubling spend on a platform raises its cost per application by ${f.pct(Math.pow(2, 1 - v.d1Rate) - 1)} and delivers ${f.pct(Math.pow(2, v.d1Rate) - 1)} more applications. This was an agreed setting informed by testing on past months${tested(v.d1RateTested)}.`,
      `A remaining-error adjustment of ${v.bias.toFixed(3)} multiplies every planned cost per application. Testing on past months, with each month predicted from the months before it, found predictions still missed by ${v.biasTested !== null && v.biasTested !== undefined ? v.biasTested.toFixed(3) : 'n/a'} overall. That figure is used only when it stays on the same side of 1 with any one test month left out; otherwise the adjustment is 1.00.${v.biasDefault === 1 && v.biasTested !== 1 ? ` For ${role} it did not hold, so the default is 1.00.` : ''}${plan && v.bias !== v.biasDefault ? ` This plan set it to ${v.bias.toFixed(3)} (default ${v.biasDefault.toFixed(3)}).` : ''}`,
      'Planned cost per application = usual cost per application x spend-level adjustment x remaining-error adjustment. Predicted applications = media spend / planned cost per application.');

    add('Quality and hires',
      QUALITY_DEFINITION,
      `Hires = applications x quality rate x hire rate after quality. For Indeed and Appcast, the quality rate was the platform’s own rate blended with the role average (every source) as if ${v.screenBlend} further applications at the average had been added${tested(v.screenBlendTested)}. For Meta and Google it was moved ${f.pct(v.pull)} of the way to the role average, for the reason given under Data used.`,
      `${v.locBlend >= OFF ? 'Location differences in quality were not applied for this release' : `Each location’s quality rate was adjusted towards its own rate, blended by ${v.locBlend} applications`}${tested(v.locBlendTested)}. ${v.regionBlend >= OFF ? 'The hire rate after quality was the role average for every location, because regional differences had not carried forward from one period to the next in testing.' : `The hire rate after quality was each region’s own, blended with the role average by ${v.regionBlend}.`}`,
      `Predicted hires were then scaled by ${v.paidFactor.toFixed(3)}, so that on past months they matched the hires RAC’s applicant tracking data credited to Indeed, Meta, Google and Appcast.`,
      `RAC also recorded hires from other sources (organic, job alerts, agencies and others). The plan shows these as a separate line, Expected hires from other sources: ${f.num(v.otherMonthly)} a month${plan && v.otherMonthly !== v.otherMonthlyDefault ? ` (set for this plan; the monthly average was ${f.num(v.otherMonthlyDefault)})` : ', the monthly average'}. It counts towards the hire target but does not depend on the budget. ${v.share > 0 ? `${f.pct(v.share)} of them were credited to paid media, so they grow with paid spend.` : 'None of them were credited to paid media.'}`);

    add('Spending caps',
      `Each location and platform has a spending cap: its largest successful month since ${f.month(v.capFirst)} x the spending cap multiple (${f.pct(v.capMultiple)} in this ${plan ? 'plan' : 'release by default'}). A month counted towards the cap when it had at least ${f.gbp(v.capMinSpend)} of spend and ${v.capMinApps} applications, its cost per application was at or below what the model expected at that spend (and at or below any cost per application limit), and the location’s quality rate that month was no more than ${f.pct(v.qualityDrop)} below its usual rate (checked where at least ${v.qualityMin} quality applications would normally have been expected, in months whose quality outcomes had settled).`,
      'Where a location and platform had no successful month, its usual monthly spend (or the platform’s typical month) was used instead, and the row is flagged. The plan never spends above a cap, including to meet a minimum. Caps were set on past media spend, so where fees apply the cap on planned spend includes the fee.');

    add('Cost limits',
      'Setup can set a maximum cost per hire for a location and a maximum cost per application for a location and platform. The plan stops adding spend where a limit would be passed, moves the money to locations within their limits, and shows what could not be placed. Cost per hire limits apply to locations only, because the data did not support cost per hire by platform.');

    add('Platform fees',
      `Plans from ${f.month(v.feesFrom)} include platform fees: Indeed ${f.pct(v.feeIndeed, 2)}, Meta ${f.pct(v.feeMeta, 2)} and Google ${f.pct(v.feeGoogle, 2)} of media spend, including the Indeed Premium hold-back; Appcast has none, and the Combined Activity reserve is a flat amount with no fee added. RAC’s budget includes the fees, so planned Indeed, Meta and Google spend is media plus fee, and media = planned spend / (1 + fee rate). Forecasts use the media spend; cost per application and cost per hire are shown on the total including the fee.${v.feesOn === false ? ' This plan is for an earlier month, so it includes no fees.' : ''}`);

    add('Ranges',
      `${RANGE_LINE} The plan total’s application range is the middle ${f.pct(v.pHigh - v.pLow)} of how far our predictions missed in testing (${f.signedPct(v.rangeLow)} to ${f.signedPct(v.rangeHigh)}${testMonths.length ? `, over ${testMonths.length} test months from ${f.month(testMonths[0])} to ${f.month(testMonths[testMonths.length - 1])}` : ''}). We make no claim about how often the actual result falls inside the range until there are at least ${v.hitRateMonths} test months.`,
      `${ROW_RANGE_LINE} Rows start from the plan’s range and widen where fewer applications sat behind their cost per application (strength ${v.widen}) and where planned spend sat further from past spend.`,
      `Hire ranges combine the application range with the uncertainty in the quality and hire rates (from the counts behind them), the uncertainty in the match to platform hires, chance variation in the number of hires itself, and the month-to-month variation in hires from other sources, over ${f.int(v.draws)} simulated months. A row is marked low confidence where its hire rate was uncertain by more than about ${f.pct(Math.exp(v.lowRateSd) - 1)} or fewer than ${v.lowApps} applications sat behind its cost per application.`);

    add('Testing and agreed settings',
      `Testing predicted each past month from the months before it only, starting with months that had at least ${v.minHistory} earlier months of data. With few test months so far, settings that tested well may have done so by chance. For this release, the settings above are agreed values informed by testing, and the tested figure is recorded beside each. A setting moves to its tested figure only once there are at least ${v.switchMonths} test months and leaving out any one month does not change the result. A location’s or platform’s own figure replaces the average only where it predicted clearly better (by ${v.minGain} units of likelihood).`);

    add('Budget for the hire target',
      'The budget needed for the hire target is found by running the plan at trial budgets, in steps of £50, and taking the lowest that reaches the target, counting expected hires from other sources. Where the spending caps put the target out of reach, the plan shows the most hires it can deliver, the budget at which extra spend stops adding hires, and the same figures at cap multiples of 100%, 200% and 300%.');

    if (plan && plan.oneRac) {
      const o = plan.oneRac;
      const ca = costAdjustment(plan);
      add('The OneRAC plan',
        `OneRAC runs one set of campaigns for both roles in ${f.list(o.regions)}, so it is planned on its own and those locations are left out of the SMR and Patrol plans. Open roles are the two roles' open roles there added together: ${RAC.ROLES.map(r => `${r} ${o.mix.vacancies[r]}`).join(', ')}, ${o.mix.total} in total.`,
        `Past performance is the two roles' spend and applications in those locations added together, which is what a combined campaign would have spent and received. Cost per application is then blended to the mix of open roles${o.adjustment.openBlend ? ` (${f.gbp(o.adjustment.openBlend, 2)} against ${f.gbp(o.adjustment.combined, 2)} blended by past spend, a multiplier of ${o.adjustment.factor.toFixed(3)})` : ''}, because the plan recruits for the roles that are open, not for the roles past spend happened to be split between.`,
        `Quality and hire rates are the two roles' applicant tracking counts in those locations added together. ${ca.selfCompetition > 0 ? `A self-competition assumption of ${f.pct(ca.selfCompetition)} lowers cost per application, for the two roles no longer bidding against each other; it has not been measured yet.` : 'No self-competition improvement was assumed: the two roles no longer bid against each other, but we have no measurement of what that is worth, so nothing is claimed for it.'} Everything else is the method above: diminishing returns, the adjustments, spending caps, cost limits and ranges.`,
        o.second ? `A second scenario is shown beside the plan: at a self-competition improvement of ${f.pct(o.second.selfCompetition)}, the same budget would be expected to deliver ${f.num(o.second.hires)} hires against ${f.num(plan.totals.allHires)}. It is a comparison, not the plan.` : '',
        'After four to six weeks of OneRAC activity we will compare these locations with their own history and with similar locations that are not on OneRAC, and replace the assumption with the measured result.');
    }
    add('Not included',
      'Seasonality, market demand and competition were not modelled; they sit within the remaining-error adjustment and the ranges. The wider influence of Meta and Google before a candidate applied, and the effect of Combined Activity campaigns, will be assessed separately.');
    return sections;
  }

  function glossary(A, role, plan) {
    const v = values(A, role, plan);
    const f = fmt;
    return [
      { term: 'Deployable budget', text: 'The monthly budget after Indeed Premium and the Combined Activity reserve (and any OneRAC hold-back).' },
      { term: 'Media spend and platform fee', text: `Media spend is what the platform charged for advertising. Indeed (${f.pct(v.feeIndeed, 2)}), Meta (${f.pct(v.feeMeta, 2)}) and Google (${f.pct(v.feeGoogle, 2)}) add a fee on top, from ${f.month(v.feesFrom)} plans; planned spend includes it.` },
      { term: 'Historic cost per application', text: 'Spend over applications for the location and platform in the months used, before any adjustment.' },
      { term: 'Thin-data adjustment', text: `How far a figure with few applications was pulled towards the platform’s figure for the role (half weight at ${v.cpaPrior} applications).` },
      { term: 'Spend-level adjustment', text: 'How much cost per application rose or fell because planned spend differed from past spend.' },
      { term: 'Remaining-error adjustment', text: 'A multiplier on cost per application for what testing on past months still missed, used only where the direction held with any one test month left out.' },
      { term: 'Planned cost per application', text: 'Historic cost after the thin-data, spend-level and remaining-error adjustments, on the total cost including any fee.' },
      { term: 'Quality application', text: QUALITY_DEFINITION.replace('A quality application is one', 'One') },
      { term: 'Quality rate', text: 'The share of applications that counted as quality applications in RAC’s applicant tracking data.' },
      { term: 'Hire rate after quality', text: 'Hires over quality applications.' },
      { term: 'Expected hires from other sources', text: 'Hires RAC recorded outside Indeed, Meta, Google and Appcast, as a monthly figure. Counted towards the hire target; not driven by the budget.' },
      { term: 'Spending cap', text: 'The most the plan will spend on a location and platform: its largest successful month x the spending cap multiple (plus the fee where fees apply).' },
      { term: 'Successful month', text: 'A past month whose cost per application was at or below what the model expected at that spend, and whose quality rate was not unusually weak.' },
      { term: 'Budget not placed', text: 'Money no location could take within its maximum, spending caps and cost limits.' },
      { term: 'Range', text: `${RANGE_LINE} ${ROW_RANGE_LINE}` },
      { term: 'Low confidence', text: 'A row with little evidence behind its hire rate or its cost per application.' },
      { term: 'Settled month', text: `A complete month whose data was taken at least ${v.settleDays} days after it ended.` },
    ];
  }

  // Every value a plan used, for the PDF assumptions box and the workings
  // Assumptions sheet: the file's rows, with the plan's own settings on top.
  function assumptionRows(A, role, plan) {
    const rows = A.entries.filter(e => e.role === 'all' || e.role === role).map(e => ({
      key: e.key, name: e.name, value: e.parsed, tested: e.testedValue, unit: e.unit, source: e.source, date: e.date, notes: e.notes, plan: null,
    }));
    if (plan) {
      const byKey = { capMultiple: 'cap_multiple_default', otherHiresShare: 'other_hires_credited_share', otherHiresMonthly: 'other_hires_monthly', remainingError: 'remaining_error_factor' };
      plan.settings.forEach(s => {
        const r = rows.find(x => x.key === byKey[s.key]);
        if (r) r.plan = s.value;
        else rows.push({ key: s.key, name: s.name, value: s.default, tested: null, unit: s.unit, source: s.source, date: '', notes: 'Setup setting', plan: s.value });
      });
      const o = (plan.stamps && plan.stamps.assumptions && plan.stamps.assumptions.overrides) || {};
      Object.keys(o).forEach(k => {
        const r = rows.find(x => x.key === k);
        const val = typeof o[k] === 'object' ? o[k][role] : o[k];
        if (r && val !== undefined) r.plan = val;
      });
    }
    return rows;
  }

  // The multiplier on planned cost per application. For a role plan it is the
  // remaining-error adjustment alone; a OneRAC plan also blends cost to the
  // mix of open roles and applies the self-competition assumption.
  function costAdjustment(plan) {
    const a = (plan && plan.costAdjustment) || { used: 1, remainingError: 1, roleMix: 1, selfCompetition: 0 };
    const extra = a.roleMix !== 1 || a.selfCompetition > 0;
    const parts = [`remaining error ${a.remainingError.toFixed(3)}`];
    if (a.roleMix !== 1) parts.push(`role mix ${a.roleMix.toFixed(3)}`);
    if (a.selfCompetition > 0) parts.push(`self-competition ${fmt.pct(a.selfCompetition)}`);
    return {
      ...a, extra,
      label: extra ? 'Cost adjustment' : 'Remaining-error adjustment',
      basis: extra ? parts.join(' x ') : '',
    };
  }

  RAC.text = { fmt, values, method, glossary, assumptionRows, costAdjustment, ATTRIBUTION, QUALITY_DEFINITION, RANGE_LINE, ROW_RANGE_LINE };
})(window.RAC = window.RAC || {});
