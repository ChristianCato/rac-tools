// RAC planner: shared names and small helpers.
//
// The planner is a set of plain script files loaded in the order listed in
// planner/manifest.json. Each file adds to one object, window.RAC. The app
// (index.html) and the automatic checks (tests/lib/planner.mjs) load the same
// files, so what is checked is what runs.
//
// No file here keeps a setting between calls. Everything a calculation needs
// is passed in, so a figure cannot depend on which screen was open last.
(function (RAC) {
  'use strict';

  RAC.PLATFORMS = ['indeed', 'meta', 'google', 'appcast'];
  RAC.PLATFORM_LABELS = { indeed: 'Indeed', meta: 'Meta', google: 'Google', appcast: 'Appcast' };
  RAC.ROLES = ['SMR', 'Patrol'];

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  // Reads CSV text into rows of strings. Handles quoted fields, doubled quotes
  // inside them, and Windows line endings.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  // A short, stable fingerprint of some text (FNV-1a, 32 bit), for the version
  // stamp and for cache keys.
  function fingerprint(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  // JSON with object keys sorted, so two equal inputs always give the same key.
  function stableKey(value) {
    if (Array.isArray(value)) return '[' + value.map(stableKey).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort()
        .filter(k => value[k] !== undefined)
        .map(k => JSON.stringify(k) + ':' + stableKey(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  // Month helpers. Months are 'YYYY-MM' strings throughout.
  function addMonths(mo, n) {
    const [y, m] = mo.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  function monthEnd(mo) {
    const [y, m] = mo.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }

  // Excel PERCENTILE.INC: linear interpolation between order statistics.
  function percentileInc(values, p) {
    const xs = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (!xs.length) return null;
    const rank = (xs.length - 1) * p;
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
  }

  // Random numbers from a fixed seed (mulberry32), so a simulation gives the
  // same result every time it runs on the same inputs.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Standard normal draws from a uniform source (Box-Muller).
  function normals(rand) {
    let spare = null;
    return function () {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0;
      while (u <= 1e-12) u = rand();
      const r = Math.sqrt(-2 * Math.log(u)), t = 2 * Math.PI * rand();
      spare = r * Math.sin(t);
      return r * Math.cos(t);
    };
  }

  RAC.util = { sum, parseCsv, fingerprint, stableKey, addMonths, monthEnd, daysBetween, percentileInc, rng, normals };

  // A small store for built plans, keyed on every input. Cleared when the data
  // changes (RAC.plan.invalidate, called from the app's resetDataCaches).
  const cache = new Map();
  RAC.cache = {
    get: (key) => cache.get(key),
    set: (key, value) => { if (cache.size > 60) cache.clear(); cache.set(key, value); return value; },
    clear: () => cache.clear(),
    size: () => cache.size,
  };
})(window.RAC = window.RAC || {});
