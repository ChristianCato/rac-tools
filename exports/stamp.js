// RAC planner: the version stamp on every PDF and workings export (B4).
//
// It says exactly what produced a plan's figures:
//   code         the deployed commit (from GET /api/windsor-spend?version=1,
//                which reads Vercel's VERCEL_GIT_COMMIT_SHA)
//   Eploy        the applicant tracking dataset file and its date
//   ad data      the last month of ad platform data the plan counted, and
//                whether any month used was still settling
//   assumptions  the latest date in assumptions.csv and a short fingerprint
//                of its contents (and of any per-plan overrides)
//
//   RAC.stamp.load()          fetches the commit once (the app calls it at start)
//   RAC.stamp.of(plan)        the stamp as fields
//   RAC.stamp.line(plan)      the stamp as one line of text
(function (RAC) {
  'use strict';
  const W = typeof window !== 'undefined' ? window : {};
  const state = { commit: null, branch: null, environment: null, status: 'idle' };
  let loading = null;

  function load() {
    if (loading) return loading;
    if (typeof fetch !== 'function') { state.status = 'unavailable'; return Promise.resolve(state); }
    state.status = 'loading';
    loading = fetch('/api/windsor-spend?version=1', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('status ' + r.status))))
      .then(j => Object.assign(state, { commit: j.commit || null, branch: j.branch || null, environment: j.environment || null, status: 'ready' }))
      .catch(() => Object.assign(state, { status: 'unavailable' }));
    return loading;
  }

  // For the checks, and for a snapshot that carries its own code version.
  function set(v) { Object.assign(state, v, { status: 'ready' }); }

  function isoDate(d) {
    if (!d) return null;
    const s = String(d);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  const niceDate = (d) => {
    const s = isoDate(d);
    if (!s) return 'unknown';
    const [y, m, dd] = s.split('-').map(Number);
    return `${dd} ${RAC.text.fmt.month(s.slice(0, 7)).split(' ')[0].slice(0, 3)} ${y}`;
  };

  function of(plan, code) {
    const c = code || (plan && plan.stamps && plan.stamps.code) || state;
    const s = plan.stamps || {};
    const a = s.assumptions || {}, d = s.data || {}, e = s.eploy || {};
    const overrides = a.overrides && Object.keys(a.overrides).length ? RAC.util.fingerprint(RAC.util.stableKey(a.overrides)) : null;
    return {
      code: c.commit ? String(c.commit).slice(0, 7) : 'unknown',
      codeFull: c.commit || null,
      branch: c.branch || null,
      eployFile: e.file || 'unknown', eployDate: isoDate(e.fileDate),
      dataTo: d.settledTo || null,
      settling: (d.settlingUsed || []).slice(),
      dataTakenOn: isoDate(d.uploadTakenOn) || isoDate(d.repoFileGenerated),
      assumptionsDate: a.date || null,
      assumptionsFingerprint: (a.fingerprint || '').split('+')[0] || null,
      overridesFingerprint: overrides,
      dataFingerprint: d.stamp || null,
    };
  }

  function line(plan, code) {
    const x = of(plan, code);
    const f = RAC.text.fmt;
    const data = x.dataTo ? `ad platform data to ${f.month(x.dataTo)}${x.settling.length ? ` (with ${x.settling.map(f.month).join(', ')} not yet settled)` : ''}` : 'ad platform data unknown';
    return `Code ${x.code} · Eploy ${x.eployFile} (${niceDate(x.eployDate)}) · ${data} · assumptions ${niceDate(x.assumptionsDate)} (${x.assumptionsFingerprint}` +
      `${x.overridesFingerprint ? `, plan overrides ${x.overridesFingerprint}` : ''})`;
  }

  RAC.stamp = { state, load, set, of, line };
  if (W.document && W.location && /^https?:/.test(W.location.protocol || '')) load();
})(window.RAC = window.RAC || {});
