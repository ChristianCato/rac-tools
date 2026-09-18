// Turns a workings export fixture into engine data, the same way the app holds
// it: monthly figures per location, platform and role, with all-time totals
// following from the months.
export const PMAP = { Indeed: 'indeed', Meta: 'meta', Google: 'google', Appcast: 'appcast' };

export function cellsFromRaw(raw, role, { months } = {}) {
  const cells = {};
  for (const [mo, region, plat, spend, apps, clicks] of raw) {
    if (months && !months.includes(mo)) continue;
    const e = { spend: spend || 0, completes: apps || 0, cpa: apps ? spend / apps : null };
    if (typeof clicks === 'number') e.clicks = clicks;
    const p = PMAP[plat];
    ((cells[p] ||= {})[region + '__' + role] ||= {})[mo] = e;
  }
  return cells;
}

// Replaces one role's monthly figures with the fixture's, as the audit's
// build_data_from_workings.py did.
export function withRoleMonthly(base, raw, role, opts) {
  const d = structuredClone(base);
  const cells = cellsFromRaw(raw, role, opts);
  for (const p of Object.values(PMAP)) {
    for (const k of Object.keys(d[p]).filter(k => k.endsWith('__' + role))) {
      const monthly = (cells[p] || {})[k] || {};
      d[p][k].monthly = monthly;
      const sp = Object.values(monthly).reduce((a, v) => a + v.spend, 0);
      const n = Object.values(monthly).reduce((a, v) => a + v.completes, 0);
      Object.assign(d[p][k].all_time, { spend: sp, completes: n, cpa: n ? sp / n : null });
    }
  }
  return d;
}

// September 2026 SMR settings, inferred from plan 2a's PDF and workings and
// confirmed by the match.
export function septSmrSettings(NO_SPEND) {
  return {
    budget: 101950, appTarget: 0, hireTarget: 30,
    liveRegions: ['South East', 'London', 'South West', 'East of England', 'West Midlands', 'East Midlands', 'North West', 'Yorkshire & Humber', 'Scotland'],
    vacancies: { 'South East': 19, London: 18, 'South West': 10, 'East of England': 10, 'West Midlands': 8, 'East Midlands': 8, 'North West': 3, 'Yorkshire & Humber': 2, Scotland: 2 },
    coveragePct: 0, premiumCampaigns: 3, acReserve: 5000,
    platMin: {}, platMax: { appcast: 5000 }, coverage: {}, comboMin: {},
    regionMin: {}, regionMax: { London: NO_SPEND, 'South East': 15000, 'East of England': 8000, Scotland: 2500 },
    daysInMonth: 30, capMultiple: 2, bench: { mode: 'last3up', mult: 2 },
  };
}

// September 2026 Patrol settings, as the live app held them when the Patrol
// workings were exported in September. The export does not list its settings;
// these were worked out from it and are confirmed by the match to the penny.
// Location minimums: East of England, West Midlands, North East and Scotland
// (the other six locations got exactly the same amount per open role).
// Platform maximums: Indeed £35,000, Meta £15,000, Appcast £5,000. Hire target
// 16: the export's application target of 1,041 is 16 hires worked back.
export function septPatrolSettings(vacancies) {
  return {
    budget: 79200, appTarget: 0, hireTarget: 16,
    liveRegions: Object.keys(vacancies), vacancies,
    coveragePct: 0, premiumCampaigns: 0, acReserve: 5000,
    platMin: {}, platMax: { indeed: 35000, meta: 15000, appcast: 5000 }, coverage: {}, comboMin: {},
    regionMin: { 'East of England': 5100, 'West Midlands': 11500, 'North East': 2300, Scotland: 1164 }, regionMax: {},
    daysInMonth: 30, capMultiple: 2, bench: { mode: 'last3up', mult: 2 },
  };
}

export function compareCells(plan, expected, PLATFORMS, { skipCpa = [] } = {}) {
  const out = { n: 0, maxSpend: 0, worstSpend: '', maxCpa: 0, worstCpa: '' };
  for (const l of plan.locations) for (const p of PLATFORMS) {
    const w = expected[l.region + '|' + p]; if (!w) continue; out.n++;
    const ds = Math.abs((l.platSpend[p] || 0) - w.spend);
    if (ds > out.maxSpend) { out.maxSpend = ds; out.worstSpend = l.region + ' ' + p; }
    if (skipCpa.includes(l.region + '|' + p)) continue;
    const dc = Math.abs((l.platCpa[p] || 0) - w.cpa);
    if (dc > out.maxCpa) { out.maxCpa = dc; out.worstCpa = l.region + ' ' + p; }
  }
  return out;
}
