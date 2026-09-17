// RAC planner: the monthly ad platform data, and which months count.
//
// The app holds monthly spend and applications in window.__AVP_DATA__: the
// repo data file (rac_data.js), with any months uploaded on the Data tab laid
// over it. This file reads that data without changing it.
//
// Part months (D3). A month counts only once it is settled:
//   1. its last day is on or before the date the data was taken, and on or
//      before the data's current-through date where that is known; and
//   2. at least data_settle_days (assumptions.csv) have passed between its
//      last day and the date the data was taken, so late-recorded
//      applications are in.
// A complete month that has not yet passed the settle period is "still
// settling". A plan can choose to count such months (Setup option "Include
// months still settling", off by default); each one used is flagged.
// The date the data was taken is the upload date for Data tab months, and the
// repo file's generated date for the rest. The Data tab keeps one upload date
// for all uploaded months (the latest upload), so that date is used for each.
(function (RAC) {
  'use strict';
  const U = RAC.util;

  // The repo file's own dates, captured when this file loads: the app loads the
  // planner straight after rac_data.js, before any upload is laid over it and
  // before the app overwrites generated_at.
  const D0 = (typeof window !== 'undefined' && window.__AVP_DATA__) || null;
  const REPO_FILE = D0 ? {
    generated_at: D0.generated_at || null,
    current_through: D0.data_current_through || null,
    months: monthsIn(D0),
  } : null;

  function monthsIn(DATA) {
    const set = new Set();
    RAC.PLATFORMS.forEach(p => Object.values(DATA[p] || {}).forEach(c => {
      Object.keys((c && c.monthly) || {}).forEach(mo => set.add(mo));
    }));
    return [...set].sort();
  }

  // Everything the planner reads about the data, in one object.
  //   DATA   the app's data object
  //   bench  the Data tab's saved upload record ({ at, months, lastDate }), or null
  //   repo   the repo file's dates (defaults to the ones captured at load)
  function snapshot(DATA, bench, repo) {
    const repoFile = repo || REPO_FILE || { generated_at: null, current_through: null, months: [] };
    const months = monthsIn(DATA);
    const uploaded = new Set((bench && bench.months) || []);
    const info = {};
    months.forEach(mo => {
      const fromUpload = uploaded.has(mo);
      info[mo] = fromUpload
        ? { source: 'Data tab upload', takenOn: bench.at || null, currentThrough: bench.lastDate || null }
        : { source: 'Repo data file', takenOn: repoFile.generated_at, currentThrough: null };
    });
    // A fingerprint of every monthly figure and its origin, so a plan built on
    // other data can never be mistaken for this one.
    const parts = [];
    RAC.PLATFORMS.forEach(p => Object.keys(DATA[p] || {}).sort().forEach(k => {
      const m = (DATA[p][k] && DATA[p][k].monthly) || {};
      Object.keys(m).sort().forEach(mo => parts.push(p, k, mo, m[mo].spend || 0, m[mo].completes || 0));
    }));
    const stamp = U.fingerprint(parts.join('|') + '|' + U.stableKey(info));
    return { DATA, regions: DATA.regions_ordered.slice(), months, info, bench: bench || null, repo: repoFile, stamp };
  }

  // Monthly figures for one location, platform and role: { month: { spend, apps, clicks } }.
  function monthly(ds, plat, region, role) {
    const m = (((ds.DATA[plat] || {})[region + '__' + role]) || {}).monthly || {};
    const out = {};
    Object.keys(m).forEach(mo => {
      out[mo] = { spend: m[mo].spend || 0, apps: m[mo].completes || 0, clicks: m[mo].clicks || 0 };
    });
    return out;
  }

  // Whether each month counts, and why not where it does not.
  function monthStatus(ds, A) {
    const settleDays = RAC.assumptions.get(A, 'data_settle_days');
    const out = {};
    ds.months.forEach(mo => {
      const i = ds.info[mo];
      const end = U.monthEnd(mo);
      let settled = true, settling = false, reason = '';
      if (!i.takenOn) { settled = false; reason = 'date the data was taken is unknown'; }
      else if (end > i.takenOn || (i.currentThrough && end > i.currentThrough)) {
        settled = false; reason = `part month: data ran to ${i.currentThrough && i.currentThrough < i.takenOn ? i.currentThrough : i.takenOn}`;
      } else if (U.daysBetween(end, i.takenOn) < settleDays) {
        settled = false; settling = true;
        reason = `still settling: taken ${U.daysBetween(end, i.takenOn)} days after month end; needs ${settleDays}`;
      }
      out[mo] = { ...i, monthEnd: end, settled, settling, reason };
    });
    return out;
  }

  function settledMonths(ds, A) {
    const st = monthStatus(ds, A);
    return ds.months.filter(mo => st[mo].settled);
  }

  RAC.data = { REPO_FILE, snapshot, monthly, monthStatus, settledMonths, monthsIn };
})(window.RAC = window.RAC || {});
