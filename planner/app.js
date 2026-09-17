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
//
// The replay starts from the repo data file as it was at 46aaae2
// (planner/legacy_rac_data_46aaae2.js), not from today's rac_data.js: the live
// app opened on that file, and a newer file (with August in it) would change
// the month list and so the pacing figures.
(function (RAC) {
  'use strict';
  const W = typeof window !== 'undefined' ? window : {};
  const LEGACY_PACING_LAST_MONTH = '2026-09';
  const FILES = {
    assumptions: 'assumptions.csv',
    eploy: 'data/eploy_rates.json',
    backtest: 'data/backtest_results.json',
    legacyEngine: 'planner/legacy_engine_46aaae2.js',
    legacyData: 'planner/legacy_rac_data_46aaae2.js',
  };

  const state = { status: 'idle', error: null, A: null, eploy: null, backtest: null, legacySource: null, legacyData: null };

  // The data object a data file sets on window, without touching the app's own.
  function readDataFile(text) {
    const w = {};
    new Function('window', text)(w);
    return w.__AVP_DATA__ || null;
  }
  let loading = null;

  function load() {
    if (loading) return loading;
    state.status = 'loading';
    const get = async (file, json) => {
      const r = await fetch(file, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${file} could not be read (status ${r.status})`);
      return json ? r.json() : r.text();
    };
    loading = Promise.all([get(FILES.assumptions), get(FILES.eploy, true), get(FILES.backtest, true), get(FILES.legacyEngine), get(FILES.legacyData)])
      .then(([csv, eploy, backtest, legacySource, legacyDataText]) => use({ A: RAC.assumptions.parse(csv), eploy, backtest, legacySource, legacyDataText }))
      .catch(e => {
        state.status = 'error';
        state.error = { title: 'The planner files could not be loaded, so no plan can be shown.', lines: [e.message] };
        return state;
      });
    return loading;
  }

  // Also used by the checks, which read the files themselves.
  function use({ A, eploy, backtest, legacySource, legacyDataText }) {
    state.A = A; state.eploy = eploy; state.backtest = backtest || null;
    state.legacySource = legacySource || null;
    state.legacyData = legacyDataText ? readDataFile(legacyDataText) : null;
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
  // plan once on the repo file as it was at 46aaae2 (the month list is worked out then and never
  // again), fold in the shared database's months, then its hire rates.
  function legacyPlan(role, p) {
    if (!state.legacySource || !state.legacyData) throw new Error('The previous engine is not loaded, so this plan cannot be paced.');
    const b = W.__RAC_BENCH__, h = W.__RAC_HIRE__;
    const key = (b && b.months ? b.at + '|' + b.months.join(',') : 'none') + '|' + (h ? JSON.stringify(h.at || '') + (h.rates ? 'r' : '') : 'none');
    if (!state.legacy || state.legacy.key !== key) {
      const data = JSON.parse(JSON.stringify(state.legacyData));
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
    return state.status === 'ready' ? RAC.assumptions.get(state.A, 'cap_multiple_default') : 1;
  }

  function defaultOtherHiresShare(role) {
    return state.status === 'ready' ? RAC.assumptions.get(state.A, 'other_hires_credited_share', role) : 0;
  }

  function invalidate() {
    dsMemo = { key: null, ds: null };
    RAC.plan.invalidate();
  }

  RAC.app = {
    LEGACY_PACING_LAST_MONTH, FILES, state,
    load, use, env, buildFundingPlan, legacyPlan, pacingPlan, usesPreviousEngine,
    defaultCapMultiple, defaultOtherHiresShare, readDataFile, invalidate,
    status: () => state.status,
  };
})(window.RAC = window.RAC || {});
