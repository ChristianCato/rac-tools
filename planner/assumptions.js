// RAC planner: the assumptions file (assumptions.csv).
//
// Every value the model uses lives in assumptions.csv, not in code. This file
// reads it and checks it. If a value is missing or out of range the planner
// refuses to run and names the row, rather than planning on a guess.
//
// Columns: key, name, value, tested, unit, role, source, date, notes
//   value   the value the planner uses
//   tested  what the latest test on past months gave (blank where the value
//           is not tested); shown beside the value used
//   role    all, or SMR / Patrol where the value differs by role
//   source  agreed (decided with the user); tested (set by a committed
//           script from the data); "agreed, informed by tests" (an agreed
//           setting, with the tested figure alongside; user decision
//           17 September 2026); default (a starting value awaiting testing)
//   date    when the value was set, YYYY-MM-DD
//
// Rule for "agreed, informed by tests" (user decision, 17 September 2026):
// the value may switch to its tested figure only once there are at least
// switch_min_test_months test months and the figure is stable with any one
// month left out. tools/calibrate.mjs reports when that is met; the switch is
// made by editing this file.
(function (RAC) {
  'use strict';

  const COLUMNS = ['key', 'name', 'value', 'tested', 'unit', 'role', 'source', 'date', 'notes'];
  const AGREED_TESTED = 'agreed, informed by tests';
  const SOURCES = ['agreed', 'tested', AGREED_TESTED, 'default'];

  // What the planner needs. perRole: true means one row for SMR and one for
  // Patrol; otherwise one row with role "all".
  const SCHEMA = {
    indeed_premium_rate:      { unit: 'gbp_per_day', min: 0, max: 500 },
    role_cpa_benchmark:       { unit: 'gbp', min: 1, max: 1000, perRole: true },
    cpa_prior_apps:           { unit: 'count', min: 0, max: 10000 },
    cap_multiple_default:     { unit: 'multiple', min: 1, max: 3 },
    data_settle_days:         { unit: 'days', min: 0, max: 120, integer: true },
    typical_month_min_spend:  { unit: 'gbp', min: 0, max: 10000 },
    eploy_first_month:        { unit: 'month' },
    hire_maturity_months:     { unit: 'months', min: 0, max: 12, integer: true },
    screening_maturity_months:{ unit: 'months', min: 0, max: 12, integer: true },
    screen_blend_n:           { unit: 'count', min: 0, max: 100000, perRole: true },
    meta_google_pull:         { unit: 'share', min: 0, max: 1 },
    location_screen_blend_n:  { unit: 'count', min: 0, max: 100000, perRole: true },
    region_hire_blend_n:      { unit: 'count', min: 0, max: 100000, perRole: true },
    paid_hire_reconciliation_factor:{ unit: 'multiple', min: 0.1, max: 10, perRole: true },
    other_hires_monthly:      { unit: 'hires', min: 0, max: 10000, perRole: true },
    other_hires_credit_factor:{ unit: 'multiple', min: 0, max: 20, perRole: true },
    other_hires_credited_share:{ unit: 'share', min: 0, max: 1, perRole: true },
    other_hires_recent_from:  { unit: 'month' },
    combined_activity_includes_display:{ unit: 'flag', min: 0, max: 1, integer: true },
    d1_role_rate:             { unit: 'exponent', min: 0.05, max: 1, perRole: true },
    d1_prior_strength:        { unit: 'count', min: 0, max: 100000, perRole: true },
    remaining_error_factor:   { unit: 'multiple', min: 0.5, max: 2, perRole: true },
    remaining_error_months:   { unit: 'months', min: 0, max: 24, integer: true },
    range_apps_low:           { unit: 'miss', min: -1, max: 10, perRole: true },
    range_apps_high:          { unit: 'miss', min: -1, max: 10, perRole: true },
    range_apps_sigma:         { unit: 'log', min: 0, max: 5, perRole: true },
    hire_range_draws:         { unit: 'count', min: 200, max: 20000, integer: true },
    low_confidence_rate_sd:   { unit: 'log', min: 0, max: 5 },
    low_confidence_min_apps:  { unit: 'count', min: 0, max: 100000 },
    row_widen_apps:           { unit: 'count', min: 0, max: 100000, perRole: true },
    switch_min_test_months:   { unit: 'count', min: 1, max: 120, integer: true },
    backtest_first_month:     { unit: 'month' },
    test_min_history_months:  { unit: 'months', min: 1, max: 24, integer: true },
    own_figure_min_gain:      { unit: 'loglik', min: 0, max: 100 },
    range_low_percentile:     { unit: 'share', min: 0, max: 0.5 },
    range_high_percentile:    { unit: 'share', min: 0.5, max: 1 },
    range_hit_rate_min_months:{ unit: 'count', min: 1, max: 120, integer: true },
    ceiling_first_month:      { unit: 'month' },
    ceiling_min_spend:        { unit: 'gbp', min: 0, max: 100000 },
    ceiling_min_apps:         { unit: 'count', min: 0, max: 10000 },
    quality_test_drop:        { unit: 'share', min: 0, max: 1 },
    quality_test_min_expected:{ unit: 'count', min: 0, max: 10000 },
  };

  function parse(text) {
    const errors = [];
    const rows = RAC.util.parseCsv(text);
    const values = {};
    const tested = {};
    const entries = [];
    if (!rows.length) return { ok: false, errors: ['assumptions.csv is empty'], values, entries };
    const head = rows[0].map(h => h.trim().toLowerCase());
    if (COLUMNS.some((c, i) => head[i] !== c)) {
      return { ok: false, errors: ['assumptions.csv header must be: ' + COLUMNS.join(', ')], values, entries };
    }
    const seen = new Set();
    rows.slice(1).forEach((cells, i) => {
      const line = i + 2;
      const r = {};
      COLUMNS.forEach((c, j) => { r[c] = (cells[j] || '').trim(); });
      const where = `row ${line} (${r.key || 'no key'}${r.role && r.role !== 'all' ? ', ' + r.role : ''})`;
      const spec = SCHEMA[r.key];
      if (!spec) { errors.push(`${where}: unknown key`); return; }
      if (!r.name) errors.push(`${where}: name is empty`);
      if (r.unit !== spec.unit) errors.push(`${where}: unit should be ${spec.unit}, found "${r.unit}"`);
      const roleOk = spec.perRole ? RAC.ROLES.includes(r.role) : r.role === 'all';
      if (!roleOk) errors.push(`${where}: role should be ${spec.perRole ? 'SMR or Patrol' : 'all'}, found "${r.role}"`);
      if (!SOURCES.includes(r.source)) errors.push(`${where}: source should be ${SOURCES.map(x => (x.includes(',') ? '"' + x + '"' : x)).join(', ')}, found "${r.source}"`);
      if (r.source === AGREED_TESTED && r.tested === '') errors.push(`${where}: source "${AGREED_TESTED}" needs the tested figure in the tested column`);
      let t = null;
      if (r.tested !== '') {
        if (spec.unit === 'month' || !/^-?\d+(\.\d+)?$/.test(r.tested)) errors.push(`${where}: tested should be a number or blank, found "${r.tested}"`);
        else t = Number(r.tested);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || isNaN(Date.parse(r.date))) errors.push(`${where}: date should be YYYY-MM-DD, found "${r.date}"`);
      const dup = r.key + '|' + r.role;
      if (seen.has(dup)) errors.push(`${where}: appears more than once`);
      seen.add(dup);
      let v;
      if (spec.unit === 'month') {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.value)) { errors.push(`${where}: value should be a month, YYYY-MM, found "${r.value}"`); return; }
        v = r.value;
      } else {
        if (!/^-?\d+(\.\d+)?$/.test(r.value)) { errors.push(`${where}: value should be a number, found "${r.value}"`); return; }
        v = Number(r.value);
        if (spec.integer && !Number.isInteger(v)) errors.push(`${where}: value should be a whole number, found ${r.value}`);
        if (v < spec.min || v > spec.max) errors.push(`${where}: value ${r.value} is outside ${spec.min} to ${spec.max}`);
      }
      (values[r.key] = values[r.key] || {})[r.role] = v;
      if (t !== null) (tested[r.key] = tested[r.key] || {})[r.role] = t;
      entries.push({ ...r, line, parsed: v, testedValue: t });
    });
    Object.keys(SCHEMA).forEach(key => {
      const need = SCHEMA[key].perRole ? RAC.ROLES : ['all'];
      need.forEach(role => {
        if (!values[key] || values[key][role] === undefined) errors.push(`missing row: ${key}${role === 'all' ? '' : ' for ' + role}`);
      });
    });
    RAC.ROLES.forEach(role => ['apps'].forEach(kind => {
      const lo = values['range_' + kind + '_low'], hi = values['range_' + kind + '_high'];
      if (lo && hi && lo[role] !== undefined && hi[role] !== undefined && lo[role] > hi[role]) {
        errors.push(`range_${kind}_low for ${role} must not be above range_${kind}_high`);
      }
    }));
    if (values.range_low_percentile && values.range_high_percentile &&
        values.range_low_percentile.all >= values.range_high_percentile.all) {
      errors.push('range_low_percentile must be below range_high_percentile');
    }
    const dates = entries.map(e => e.date).sort();
    return {
      ok: errors.length === 0,
      errors,
      values,
      tested,
      entries,
      fingerprint: RAC.util.fingerprint(String(text).replace(/\r\n/g, '\n')),
      date: dates[dates.length - 1] || null,
    };
  }

  // One value. Role-specific rows win; otherwise the "all" row.
  function get(A, key, role) {
    if (!A || !A.ok) throw new Error('The assumptions file has not loaded or is invalid, so the planner cannot run.');
    const v = A.values[key];
    if (!v) throw new Error('No assumption named ' + key);
    if (role && v[role] !== undefined) return v[role];
    if (v.all !== undefined) return v.all;
    throw new Error(`No ${key} assumption for ${role}`);
  }

  // The row behind a value (role row first, then "all"), with its source and
  // tested figure, for the Assumptions tab, the workings and the PDF.
  function entry(A, key, role) {
    return A.entries.find(e => e.key === key && e.role === role) || A.entries.find(e => e.key === key && e.role === 'all') || null;
  }

  // A copy with some values replaced, used for per-plan overrides and for the
  // one-at-a-time comparisons. The fingerprint changes with the values, so a
  // cached plan is never reused across different settings.
  function withValues(A, changes) {
    const values = JSON.parse(JSON.stringify(A.values));
    Object.keys(changes).forEach(key => {
      const c = changes[key];
      values[key] = (c && typeof c === 'object') ? { ...values[key], ...c } : { all: c };
    });
    return { ...A, values, fingerprint: A.fingerprint + '+' + RAC.util.fingerprint(RAC.util.stableKey(changes)) };
  }

  RAC.assumptions = { COLUMNS, SCHEMA, SOURCES, AGREED_TESTED, parse, get, entry, withValues };
})(window.RAC = window.RAC || {});
