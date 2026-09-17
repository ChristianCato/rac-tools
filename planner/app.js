// RAC planner: the connection to the app (index.html).
//
//   RAC.app.load()                 reads assumptions.csv and the data files;
//                                  the app waits for it before planning
//   RAC.app.buildFundingPlan(...)  the plan in the shape the screens read
//   RAC.app.pacingPlan(...)        the plan pacing measures against
//
// Pacing (user decision, 17 September 2026): plans for months up to and
// including LEGACY_PACING_LAST_MONTH were made before this release, and pace
// exactly as they did in the live app before it: the previous engine (frozen
// at commit 46aaae2), the same data, and the same load order, in which months
// held only in the shared database arrived after the month list was first
// worked out. Later plans pace against the new planner.
(function (RAC) {
  'use strict';
  const W = typeof window !== 'undefined' ? window : {};
  const LEGACY_PACING_LAST_MONTH = '2026-09';
  const FILES = {
    assumptions: 'assumptions.csv',
    eploy: 'data/eploy_rates.json',
    backtest: 'data/backtest_results.json',
    legacyEngine: 'planner/legacy_engine_46aaae2.js',
  };
  // The repo data file as loaded, before any upload is laid over it: the
  // previous engine's pacing replay starts from this.
  const REPO_DATA = W.__AVP_DATA__ ? JSON.parse(JSON.stringify(W.__AVP_DATA__)) : null;

  const state = { status: 'idle', error: null, A: null, eploy: null, backtest: null, legacySource: null, repoData: REPO_DATA };
  let loading = null;

  function load() {
    if (loading) return loading;
    state.status = 'loading';
    const get = async (file, json) => {
      const r = await fetch(file, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${file} could not be read (status ${r.status})`);
      return json ? r.json() : r.text();
    };
    loading = Promise.all([get(FILES.assumptions), get(FILES.eploy, true), get(FILES.backtest, true), get(FILES.legacyEngine)])
      .then(([csv, eploy, backtest, legacySource]) => use({ A: RAC.assumptions.parse(csv), eploy, backtest, legacySource }))
      .catch(e => {
        state.status = 'error';
        state.error = { title: 'The planner files could not be loaded, so no plan can be shown.', lines: [e.message] };
        return state;
      });
    return loading;
  }

  // Also used by the checks, which read the files themselves.
  function use({ A, eploy, backtest, legacySource, repoData }) {
    state.A = A; state.eploy = eploy; state.backtest = backtest || null;
    state.legacySource = legacySource || null;
    if (repoData) state.repoData = repoData;
    state.legacy = null;
    if (!A.ok) {
      state.status = 'error';
      state.error = { title: 'assumptions.csv has problems, so the planner will not run. Fix these rows on a branch:', lines: A.errors };
    } else {
      state.status = 'ready';
      state.error = null;
    }
    invalidate();
    return state;
  }

  let dsMemo = { key: null, ds: null };
  // The planner's view of the app's data. `version` changes whenever the app's
  // data changes (DATA_VERSION in index.html).
  function env(DATA, version) {
    if (state.status !== 'ready') throw new Error(state.error ? state.error.title : 'The planner has not loaded yet.');
    const b = W.__RAC_BENCH__;
    const bench = b && b.months ? { at: b.at || null, months: b.months, lastDate: b.lastDate || null } : null;
    const key = version + '|' + (bench ? bench.at + '|' + bench.months.join(',') : 'no uploads');
    if (dsMemo.key !== key) dsMemo = { key, ds: RAC.data.snapshot(DATA, bench) };
    return { ds: dsMemo.ds, A: state.A, eploy: state.eploy };
  }

  const shaped = new WeakMap();
  function buildFundingPlan(role, p, DATA, version, extra) {
    const inputs = { ...p };
    delete inputs._solving;
    if (extra) Object.assign(inputs, extra);
    const plan = RAC.plan.build(role, inputs, env(DATA, version));
    if (!shaped.has(plan)) shaped.set(plan, RAC.legacyShape.toLegacy(plan));
    return shaped.get(plan);
  }

  // One instance of the previous engine, replaying the live app's load order:
  // plan once on the repo file (the month list is worked out then and never
  // again), fold in the shared database's months, then its hire rates.
  function legacyPlan(role, p) {
    if (!state.legacySource || !state.repoData) throw new Error('The previous engine is not loaded, so this plan cannot be paced.');
    const b = W.__RAC_BENCH__, h = W.__RAC_HIRE__;
    const key = (b && b.months ? b.at + '|' + b.months.join(',') : 'none') + '|' + (h ? JSON.stringify(h.at || '') + (h.rates ? 'r' : '') : 'none');
    if (!state.legacy || state.legacy.key !== key) {
      const data = JSON.parse(JSON.stringify(state.repoData));
      const E = new Function('window', state.legacySource +
        '\nreturn { buildFundingPlan, applyMonths, setHireOverride, benchWeight };')({ __AVP_DATA__: data, location: { hostname: 'legacy-pacing' } });
      E.buildFundingPlan(role, p);
      if (b && b.cells && b.months) E.applyMonths(b.months, b.cells, b.lastDate);
      if (h && h.rates) E.setHireOverride(h);
      state.legacy = { key, E };
    }
    return state.legacy.E.buildFundingPlan(role, p);
  }

  function usesPreviousEngine(month) {
    return !!month && month <= LEGACY_PACING_LAST_MONTH;
  }

  function pacingPlan(month, role, p, DATA, version) {
    return usesPreviousEngine(month) ? legacyPlan(role, p) : buildFundingPlan(role, p, DATA, version);
  }

  function defaultCapMultiple() {
    return state.status === 'ready' ? RAC.assumptions.get(state.A, 'cap_multiple_default') : 2;
  }

  function invalidate() {
    dsMemo = { key: null, ds: null };
    RAC.plan.invalidate();
  }

  RAC.app = {
    LEGACY_PACING_LAST_MONTH, FILES, state,
    load, use, env, buildFundingPlan, legacyPlan, pacingPlan, usesPreviousEngine,
    defaultCapMultiple, invalidate,
    status: () => state.status,
  };
})(window.RAC = window.RAC || {});
