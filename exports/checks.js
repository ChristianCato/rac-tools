// RAC planner: automatic checks on everything RAC sees (the PDF, the workings
// export, the Method text and glossary, the OneRAC PDF, the version stamp and
// the in-app changelog). The exports run them before saving and refuse
// to save a file that fails; tests/checks/80_exports.mjs runs them too.
//
//   RAC.outputChecks.text(str)        problems in a piece of text
//   RAC.outputChecks.pdfRows(rows)    problems in table rows about to be drawn
//   RAC.outputChecks.title(t, plan)   problem if a title does not match the target
(function (RAC) {
  'use strict';

  // No Hiring Lab figures anywhere RAC sees (addendum 2.5): the name must not
  // appear at all, so no figure can be attributed to it.
  const BANNED = [
    { re: /—/, why: 'em-dash' },
    { re: /hiring\s*lab/i, why: 'Hiring Lab named' },
    // Nothing RAC sees may name where the app is kept or hosted, or say that
    // any of its data or code is public (user, 18 September 2026).
    { re: /\b(repositor(y|ies)|repo|github|git|vercel|supabase|public(ly)?)\b/i, why: 'names the repository, hosting or database, or says something is public' },
    // Nor refer to the app, its screens or its internal files (user, 18
    // September 2026). The Eploy dataset's own file name is RAC's, and stays.
    { re: /\bSetup\b|\bthe app\b|\bapp['’]s\b|\b(Method|Data|Assumptions|OneRAC|Plan|Benchmarks) tab\b|\b[\w-]+\.(js|mjs|jsx|csv|json|py|html)\b|\brac_data\b|\[object Object\]/i, why: 'refers to the app or an internal file' },
    { re: /\bapp(lication)?s? target\b/i, why: 'location application target' },
    { re: /\bNaN\b|\bundefined\b|\bInfinity\b/, why: 'broken figure' },
  ];

  function text(str) {
    const s = String(str || '');
    const out = [];
    BANNED.forEach(b => {
      const m = s.match(b.re);
      if (m) out.push(`${b.why}: "${s.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ')}"`);
    });
    return out;
  }

  // rows: [{ label, spend, cph }] as drawn. No cost per hire on a £0 row.
  function pdfRows(rows) {
    return rows.filter(r => !(r.spend > 0.005) && r.cph !== null && r.cph !== undefined && r.cph !== '' && r.cph !== '-')
      .map(r => `cost per hire shown on a £0 row: ${r.label}`);
  }

  // The title must name the plan's hire target (or say there is none).
  function title(t, plan) {
    const target = plan.hireTarget || 0;
    if (target > 0 && !new RegExp(`\\b${target} hires\\b`).test(t)) return [`title "${t}" does not name the ${target}-hire target`];
    if (!(target > 0) && /\bhires\b/.test(t) && /\d+ hires/.test(t)) return [`title "${t}" names a hire target the plan does not have`];
    return [];
  }

  RAC.outputChecks = { BANNED, text, pdfRows, title };
})(window.RAC = window.RAC || {});
