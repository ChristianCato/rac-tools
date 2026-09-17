// Planning engine as it was on GitHub main at commit 46aaae2 (14 September 2026),
// extracted from index.html. Frozen so the September plans can always be rebuilt
// exactly as they were produced, whatever changes in the live engine.
const DATA = window.__AVP_DATA__;
if (!DATA.data_months) {
  // Which months the dataset already holds, worked out once so the updater
  // can tell a replacement from a new month.
  const seen = new Set();
  ['indeed','meta','google','appcast'].forEach(p => Object.keys(DATA[p] || {}).forEach(k => {
    Object.keys((DATA[p][k] || {}).monthly || {}).forEach(mo => seen.add(mo));
  }));
  DATA.data_months = [...seen].sort();
}

const PLATFORMS = ['indeed', 'meta', 'google', 'appcast'];
const PLATFORM_LABELS = { indeed: 'Indeed', meta: 'Meta', google: 'Google', appcast: 'Appcast' };
const ROLES = ['SMR', 'Patrol'];
const ROLE_FULL = { SMR: 'Mobile Vehicle Tech', Patrol: 'Roadside Tech (incl. SuperFlex)' };

// ---- Formatting helpers ----
function fmtGBP(n) {
  if (n == null || isNaN(n)) return '£0';
  return '£' + Math.round(n).toLocaleString('en-GB');
}
function fmtInt(n) {
  if (n == null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-GB');
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '0%';
  return Math.round(n) + '%';
}

// ====================================================================
// STAT ACCESS
// ====================================================================
// Returns the all_time stats for a region × platform × role.
// The benchmark window. Null means the whole history. Set from Benchmarks and
// saved with the workspace, so the plan is built on whatever RAC agreed to.
const _platformCPACache = {};
// A built plan, kept against the inputs that produced it. Every keystroke in
// the planner re-renders and would otherwise rebuild both roles from scratch,
// including the budget solver.
const _planCache = new Map();

function monthShort(mo) {
  const [y, m] = mo.split('-');
  return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

// How the tool decides which months to plan on, and how much each counts.
//
//   { mode: 'all' }                     every month on record, equal
//   { mode: 'ytd' }                     January to the last full month, equal
//   { mode: 'last3' }                   the last three months only
//   { mode: 'last3up', mult: 3 }        year to date, last three months x3
//   { mode: 'custom', from, to }        a chosen range, equal
//
// Weighting rather than a hard cut-off matters: a window drops a month from
// counting fully to counting nothing overnight, and a thin location can lose
// most of its evidence in one step. Weighting leans on recent months while
// keeping the year in the calculation.
//
// Tested against Jan to Jul 2026: planning on the full year under-predicted
// cost per application in all eight months across both roles. Weighting the
// last three at three times the rest cuts that bias and the improvement
// flattens after about x3.
let BENCH = null;

function benchNorm(w) {
  if (!w) return null;
  if (typeof w === 'string') return { mode: w };
  if (w.mode) return { ...w };
  // Older saved plans stored a plain from/to range.
  if (w.from || w.to) return { mode: 'custom', from: w.from, to: w.to };
  return null;
}

function setBenchWindow(w) {
  const next = benchNorm(w);
  if (JSON.stringify(next) === JSON.stringify(BENCH)) return false;
  BENCH = next;
  _weights = null;
  _planCache.clear();
  Object.keys(_platformCPACache).forEach(k => delete _platformCPACache[k]);
  return true;
}

// The last month that has closed, from the data itself.
function lastFullMonth() {
  const ms = dataMonths();
  return ms.length ? ms[ms.length - 1] : null;
}

// Weight per month under the current setting. Worked out once per setting and
// held, because this is read inside the hottest loop in the engine: once per
// month, per location, per platform, on every plan build.
let _weights = null, _weightCount = 0;
function buildWeights() {
  const b = BENCH;
  const ms = dataMonths();
  const last = ms[ms.length - 1];
  const out = {};
  ms.forEach((mo, i) => {
    const age = ms.length - i;               // 1 = the last full month
    let w = 1;
    if (!b || b.mode === 'all') w = 1;
    else if (b.mode === 'ytd') w = mo.slice(0, 4) === last.slice(0, 4) ? 1 : 0;
    else if (b.mode === 'last3') w = age <= 3 ? 1 : 0;
    else if (b.mode === 'last3up') {
      w = mo.slice(0, 4) !== last.slice(0, 4) ? 0 : (age <= 3 ? (b.mult || 3) : 1);
    } else if (b.mode === 'custom') {
      w = ((b.from && mo < b.from) || (b.to && mo > b.to)) ? 0 : 1;
    }
    out[mo] = w;
  });
  _weights = out;
  _weightCount = Object.values(out).filter(x => x > 0).length;
}
function benchWeight(mo) {
  if (!_weights) buildWeights();
  const w = _weights[mo];
  return w === undefined ? 0 : w;
}
function benchMonthCount() {
  if (!_weights) buildWeights();
  return _weightCount;
}

function benchLabel(w) {
  const b = w === undefined ? BENCH : benchNorm(w);
  if (!b || b.mode === 'all') return 'all time';
  if (b.mode === 'ytd') return 'year to date';
  if (b.mode === 'last3') return 'last 3 months';
  if (b.mode === 'last3up') return 'year to date, last 3 months x' + (b.mult || 3);
  if (b.mode === 'custom') return monthShort(b.from) + ' to ' + monthShort(b.to);
  return 'all time';
}

// The period a role is planned on, whatever is selected on screen.
function benchFor(state, role) {
  return (state && state.bench && state.bench[role]) || null;
}

// Everything that plans reads this. Weighting it here means the engine, the
// channel tables, the PDF and the workings all move together.
function getStats(platform, region, role) {
  const cell = DATA[platform]?.[`${region}__${role}`];
  if (!cell) return null;
  if (!BENCH || BENCH.mode === 'all') return cell.all_time || null;
  const m = cell.monthly || {};
  let spend = 0, completes = 0, clicks = 0, wsum = 0;
  Object.keys(m).forEach(mo => {
    const w = benchWeight(mo);
    if (!w) return;
    spend += w * (m[mo].spend || 0);
    completes += w * (m[mo].completes || 0);
    clicks += w * (m[mo].clicks || 0);
    wsum += w;
  });
  const at = cell.all_time || {};
  if (!(wsum > 0)) return at || null;
  // Cost per application is a ratio, so the weights cancel and it reads as a
  // real figure. Volumes are scaled back to a comparable size so the shrinkage
  // rules see the right amount of evidence rather than an inflated count.
  const scale = wsum > 0 ? benchMonthCount() / wsum : 1;
  return { ...at,
    spend: spend * scale, completes: completes * scale, clicks: clicks * scale,
    cpa: completes > 0 ? spend / completes : null,
    cvr: clicks > 0 ? completes / clicks : (at.cvr || 0),
    cvrWindowed: clicks > 0 };
}

// How many months this cell actually has weight on, for scaling volumes back.
function countMonths(monthly) {
  let n = 0;
  Object.keys(monthly).forEach(mo => { if (benchWeight(mo) > 0) n += 1; });
  return n;
}

function getMonthly(platform, region, role) {
  return DATA[platform]?.[`${region}__${role}`]?.monthly || {};
}

// ====================================================================
// EFFECTIVE CPA - the cost-per-application the tool plans against.
// Tiered, same spirit as the original tool but apps-first:
//  - Use the pair's own CPA if it has >=1 application and >=£200 spend.
//  - Confidence by application count: HIGH >=30, MED >=10, LOW below.
//  - Dud detector: significant spend, zero apps -> no signal.
//  - Fallback: platform-role aggregate CPA, then the role CPA benchmark.
// ====================================================================
const DUD_SPEND = 2000;
const FALLBACK_MIN_APPS = 5;
// Shrinkage prior strength: how many applications of evidence a cell needs
// before its own CPA is fully trusted. A cell with far fewer applications
// gets its CPA pulled toward the platform average (a small, lucky sample
// (e.g. a £6 CPA on 1 month of spend) should not be projected at face value.
const CPA_PRIOR_K = 35;

// A region cap of exactly nothing. 0 already means "no cap", so zero spend
// needs a value of its own. Shown and typed as N.
const NO_SPEND = -1;

function capToText(v) {
  if (v === NO_SPEND) return 'N';
  return '\u00A3' + (v || 0).toLocaleString('en-GB');
}

// N, n or a bare minus sign all mean zero spend. Anything else is read as a
// number, and an empty box goes back to no cap.
function capFromText(txt) {
  const t = String(txt || '').trim();
  if (/^[Nn\u00A3\s-]*[Nn-]/.test(t)) return NO_SPEND;
  return parseInt(t.replace(/[^0-9]/g, ''), 10) || 0;
}

// Platform-level aggregate CPA, cached. This is the "prior" the engine
// regresses thin or unusually cheap cell CPAs toward.
function platformAvgCPA(platform, role) {
  const key = platform + ':' + role;
  if (_platformCPACache[key] !== undefined) return _platformCPACache[key];
  let totSpend = 0, totApps = 0;
  DATA.regions_ordered.forEach(r => {
    const rs = getStats(platform, r, role);
    if (rs && rs.completes > 0) { totSpend += rs.spend; totApps += rs.completes; }
  });
  const result = totApps > 0 ? totSpend / totApps : null;
  _platformCPACache[key] = result;
  return result;
}

function effectiveCPA(platform, region, role) {
  const s = getStats(platform, region, role);
  if (s && s.cpa > 0 && s.completes >= 1 && s.spend >= 200) {
    const conf = s.completes >= 30 ? 'HIGH' : s.completes >= 10 ? 'MED' : 'LOW';
    const platCPA = platformAvgCPA(platform, role);
    // Shrinkage: blend the cell's own CPA toward the platform average,
    // weighted by how many applications the cell has actually recorded.
    // n applications of own evidence vs CPA_PRIOR_K applications of prior.
    // A high-volume cell keeps most of its own (possibly cheap) CPA; a
    // low-volume cell is pulled toward the platform norm. This stops the
    // allocator pouring budget into a bargain CPA earned on a tiny sample.
    let cpa = s.cpa;
    if (platCPA && platCPA > 0) {
      const n = s.completes;
      cpa = (n * s.cpa + CPA_PRIOR_K * platCPA) / (n + CPA_PRIOR_K);
    }
    const shrunk = Math.abs(cpa - s.cpa) > 0.01;
    return { cpa, conf, source: shrunk ? 'own-adjusted' : 'own', rawCpa: s.cpa };
  }
  if (s && s.spend >= DUD_SPEND && (s.completes || 0) === 0) {
    return null; // real evidence this pair does not convert
  }
  // Platform-role aggregate
  const platCPA = platformAvgCPA(platform, role);
  if (platCPA && platCPA > 0) {
    return { cpa: platCPA, conf: 'LOW', source: 'platform-avg', rawCpa: platCPA };
  }
  const bench = DATA.cpa_benchmarks?.[role];
  if (bench > 0) return { cpa: bench, conf: 'LOW', source: 'benchmark', rawCpa: bench };
  return null;
}

// ====================================================================
// PREDICTION BAND - month-to-month variance of a pair's CPA, expressed
// as a +/- percentage. This is the confidence mechanism: the tool
// promises a range, not a point. Wider band = more volatile history.
// ====================================================================
// How much a prediction can move, from how much the cost per application has
// moved month to month. It follows the benchmark window: recent months only
// means recent variance only, which is usually tighter.
//
// Two months cannot show variance, so where the window holds fewer than three
// months the cell falls back to its own full history rather than to a flat
// number. A narrower window should not buy false precision.
function predictionBand(platform, region, role) {
  const monthly = getMonthly(platform, region, role);
  const usable = (mo) => {
    const m = monthly[mo];
    return m && m.cpa > 0 && (m.completes || 0) >= 1;
  };
  const inWindow = Object.keys(monthly)
    .filter(mo => benchWeight(mo) > 0)
    .filter(usable).map(mo => monthly[mo].cpa);
  const everything = Object.keys(monthly).filter(usable).map(mo => monthly[mo].cpa);
  let cpas = inWindow, basis = 'measured';
  if (cpas.length < 3) { cpas = everything; basis = 'all-time'; }
  if (cpas.length < 3) {
    // Nothing to measure anywhere: a wide default, flagged as such.
    return { pct: 35, basis: 'thin', n: cpas.length };
  }
  const mean = cpas.reduce((a, b) => a + b, 0) / cpas.length;
  const variance = cpas.reduce((a, b) => a + (b - mean) ** 2, 0) / cpas.length;
  const sd = Math.sqrt(variance);
  const cov = mean > 0 ? sd / mean : 0;
  // Coefficient of variation -> band. Clamp to a sensible 8%–45% range so
  // the tool never projects false precision nor uselessly wide ranges.
  const pct = Math.max(8, Math.min(45, Math.round(cov * 100)));
  return { pct, basis, n: cpas.length };
}

// ====================================================================
// ALLOCATION ENGINE
// For one role, given a budget, the live locations, and a flat coverage
// floor per location: place the floor first (best-CPA platform per
// location), then water-fill the remainder by CPA across all live pairs.
// ====================================================================

// Rank a location's platforms by effective CPA (cheapest first).
function rankPlatformsForLocation(region, role) {
  return PLATFORMS
    .map(p => {
      const eff = effectiveCPA(p, region, role);
      return eff ? { platform: p, cpa: eff.cpa, conf: eff.conf, source: eff.source } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.cpa - b.cpa);
}

// The core allocator. Returns a plan object:
//   plan[region][platform] = spend
// plus per-region metadata for the UI.
function allocateApplications(role, budget, liveRegions, coverageFloor) {
  const plan = {};
  liveRegions.forEach(r => { plan[r] = {}; PLATFORMS.forEach(p => { plan[r][p] = 0; }); });

  // --- Pass 1: coverage floor. Each live location gets `coverageFloor`,
  // placed on its single best-CPA platform. ---
  let floorTotal = 0;
  liveRegions.forEach(r => {
    const ranked = rankPlatformsForLocation(r, role);
    if (ranked.length === 0) return; // no usable platform at all
    plan[r][ranked[0].platform] += coverageFloor;
    floorTotal += coverageFloor;
  });

  // --- Pass 2: efficiency water-fill of the remainder by CPA. ---
  // Build every (region, platform) candidate among live regions, ranked by CPA.
  const remaining0 = Math.max(0, budget - floorTotal);
  const candidates = [];
  liveRegions.forEach(r => {
    PLATFORMS.forEach(p => {
      const eff = effectiveCPA(p, r, role);
      if (!eff) return;
      candidates.push({ region: r, platform: p, cpa: eff.cpa, conf: eff.conf });
    });
  });
  candidates.sort((a, b) => a.cpa - b.cpa);

  // Soft cap per cell, anchored to what the cell has ACTUALLY spent.
  // A cheap historic CPA is only trustworthy at the spend level it was
  // earned at: a cell that never spent above £500/month cannot be assumed
  // to deliver the same rate at £4,000/month. So the cap is the larger of:
  //   - the cell's peak historic monthly spend, times the cap multiple
  //   - 2x its average active-month spend
  //   - a £1,200 flat floor (so a near-zero-history cell still gets a chance)
  // This keeps budget close to proven spend levels.
  const cellCap = {};
  candidates.forEach(c => {
    const monthly = getMonthly(c.platform, c.region, role);
    const spends = Object.values(monthly).map(m => m.spend || 0).filter(x => x > 0);
    const peak = spends.length ? Math.max(...spends) : 0;
    const avg = spends.length ? spends.reduce((a, b) => a + b, 0) / spends.length : 0;
    cellCap[c.region + '|' + c.platform] = Math.max(
      1200,
      Math.round(peak * Math.max(1.5, CAP_MULTIPLE)),
      Math.round(avg * 2)
    );
  });
  // Hard ceiling for the remainder pass: no cell may exceed 1.5x its soft
  // cap even when budget is abundant.
  const cellHardCap = {};
  candidates.forEach(c => {
    cellHardCap[c.region + '|' + c.platform] = Math.round(cellCap[c.region + '|' + c.platform] * 1.5);
  });

  let remaining = remaining0;
  // Iterate cheapest-first; may take a couple of passes as caps fill.
  for (let pass = 0; pass < 3 && remaining > 1; pass++) {
    for (const c of candidates) {
      if (remaining <= 1) break;
      const key = c.region + '|' + c.platform;
      const current = plan[c.region][c.platform];
      const room = Math.max(0, cellCap[key] - current);
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      plan[c.region][c.platform] += add;
      remaining -= add;
    }
  }
  // If budget still remains (all soft caps full), distribute the rest across
  // cells by inverse-CPA, respecting the hard ceiling so no single cell is
  // pushed to an unrealistic spend level. Repeat until the budget is placed
  // or every cell has hit its hard ceiling.
  for (let pass = 0; pass < 6 && remaining > 1; pass++) {
    const open = candidates.filter(c =>
      plan[c.region][c.platform] < cellHardCap[c.region + '|' + c.platform]);
    if (open.length === 0) break;
    const totalInv = open.reduce((s, c) => s + 1 / c.cpa, 0);
    let placedThisPass = 0;
    open.forEach(c => {
      const key = c.region + '|' + c.platform;
      const want = remaining * ((1 / c.cpa) / totalInv);
      const room = Math.max(0, cellHardCap[key] - plan[c.region][c.platform]);
      const add = Math.min(want, room);
      plan[c.region][c.platform] += add;
      placedThisPass += add;
    });
    remaining -= placedThisPass;
    if (placedThisPass < 1) break;
  }

  return { plan, floorTotal, deployableRemainder: remaining0, unplaced: Math.max(0, remaining) };
}

// Predicted applications for a region-platform given spend.
function predictedApps(platform, region, role, spend) {
  if (!spend || spend <= 0) return 0;
  const eff = effectiveCPA(platform, region, role);
  if (!eff) return 0;
  return spend / eff.cpa;
}

// ====================================================================
// SPEND RESPONSE
// Applications do not scale with spend. Every platform gets dearer the more
// it takes, and they steepen at different rates. So the split across
// platforms can be worked out by pushing money at whichever one is currently
// buying the next application most cheaply, rather than by copying whatever
// the split happened to be last year.
//
//   apps = a * spend^b        b under 1 is diminishing returns
//   marginal cost of the next application = spend^(1-b) / (a*b)
//
// The shape b is fitted per platform from every location month on record. The
// scale a is set per location from that location's own cost per application,
// so local knowledge is kept without fitting a curve to eight noisy months.
// ====================================================================

// How far past a cell's biggest observed month the plan is allowed to go.
// Default is not at all: never spend more in a location on a platform than
// has already been spent there and measured. Raise it deliberately to stretch,
// and say by how much.
let CAP_MULTIPLE = 1.0;
function setCapMultiple(x) {
  Object.keys(_typicalCache).forEach(k => delete _typicalCache[k]);
  const v = Number(x);
  CAP_MULTIPLE = (isFinite(v) && v >= 1 && v <= 3) ? v : 1.0;
}

// Where a cell sits on its platform's curve, anchored on its own history.
// Typical monthly spend for a platform in one location, across every location
// that has run it. Used as the ceiling where a location has no history of its
// own on that platform, so the figure still comes from measured spend.
const _typicalCache = {};
function typicalMonth(plat, role) {
  const key = plat + '|' + role;
  if (_typicalCache[key] !== undefined) return _typicalCache[key];
  const all = [];
  DATA.regions_ordered.forEach(r => {
    const mon = getMonthly(plat, r, role);
    Object.values(mon).forEach(m => { if ((m.spend || 0) > 100) all.push(m.spend); });
  });
  all.sort((a, b) => a - b);
  const v = all.length ? all[Math.floor(all.length / 2)] : 0;
  _typicalCache[key] = v;
  return v;
}

function responseCurve(plat, region, role) {
  const c = (DATA.response_curves || {})[role] || {};
  const fit = c[plat];
  if (!fit) return null;
  const st = getStats(plat, region, role);
  const eff = effectiveCPA(plat, region, role);
  const cpa = (eff && eff.cpa) || null;
  if (!cpa || cpa <= 0) return null;
  // Anchor at the cell's own typical monthly spend, or the platform's own
  // scale where it has none of its own.
  const monthly = getMonthly(plat, region, role);
  const spends = Object.values(monthly).map(m => m.spend || 0).filter(x => x > 100);
  const anchorSpend = spends.length
    ? spends.slice().sort((a, b) => a - b)[Math.floor(spends.length / 2)]
    : 1000;
  const anchorApps = anchorSpend / cpa;
  const b = fit.b;
  const a = anchorApps / Math.pow(anchorSpend, b);
  // Never plan past what this cell has actually done, unless someone has
  // deliberately raised the multiple. The curve will happily extrapolate; the
  // evidence does not.
  const peak = spends.length ? Math.max(...spends) : typicalMonth(plat, role);
  // Applications are the working currency, hires are the goal. Carry the
  // hire rate so the split can be worked out on cost per hire.
  let hireRate = 0;
  try { hireRate = regionPlatformHireCVR(plat, region, role) || 0; } catch (e) { /* no data */ }
  if (!(hireRate > 0)) {
    hireRate = (DATA.cvr_benchmarks && DATA.cvr_benchmarks[role] && DATA.cvr_benchmarks[role][region]) || 0;
  }
  return { a, b, cap: peak * CAP_MULTIPLE, peak, hireRate,
           anchorSpend, cpa, fitR2: fit.r2 };
}

// Cost of the next application at a given monthly spend.
function marginalCPA(cv, spend) {
  const s = Math.max(1, spend);
  return Math.pow(s, 1 - cv.b) / (cv.a * cv.b);
}
// Spend at which the next application costs lambda. The hire rate divides in,
// so the same maths equalises the cost of the next HIRE instead: a platform
// that converts applications to hires badly has to be much cheaper per
// application before it earns more money.
function spendForMarginal(cv, lambda) {
  const h = cv.hireRate > 0 ? cv.hireRate : 1;
  return Math.pow(lambda * h * cv.a * cv.b, 1 / (1 - cv.b));
}

// Split one location's budget across its platforms so the next application
// costs the same whichever platform buys it. Falls back to the historic split
// for any platform with no curve.
function splitByResponse(budget, plats, curves, caps) {
  const usable = plats.filter(p => curves[p]);
  if (!usable.length || budget <= 0) return null;
  let lo = 1, hi = 1e7;
  const total = (lam) => usable.reduce((s, p) =>
    s + Math.min(caps[p], Math.max(0, spendForMarginal(curves[p], lam))), 0);
  if (total(hi) < budget) {
    // The ceilings bind before the budget is spent, so there is only one
    // possible answer: every platform goes to its ceiling and the rest is
    // handled as spend above proven levels further down.
    const out = {};
    usable.forEach(p => { out[p] = caps[p]; });
    return { split: out, marginal: null, capped: true };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) < budget) lo = mid; else hi = mid;
  }
  const lam = (lo + hi) / 2;
  const out = {};
  usable.forEach(p => { out[p] = Math.min(caps[p], Math.max(0, spendForMarginal(curves[p], lam))); });
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  // Give any rounding gap only to platforms with room left. Scaling everything
  // up proportionally would push cells past their ceiling, which is the one
  // thing this is here to prevent.
  let left = budget - sum;
  for (let pass = 0; pass < 6 && left > 0.5; pass++) {
    const room = usable.filter(p => caps[p] - out[p] > 0.01);
    if (!room.length) break;
    const headroom = room.reduce((a, p) => a + (caps[p] - out[p]), 0);
    const give = Math.min(left, headroom);
    room.forEach(p => { out[p] += give * ((caps[p] - out[p]) / headroom); });
    left -= give;
  }
  return { split: out, marginal: lam, unplaced: Math.max(0, left) };
}

// Predicted hires from applications, via the region's historic CVR.
// This is the quiet "guardrail" readout: shown, never optimised on.
function predictedHiresFromApps(region, role, apps) {
  const cvr = DATA.cvr_benchmarks?.[role]?.[region];
  if (!cvr || cvr <= 0) return 0;
  return apps * cvr;
}

// Roll a plan up into totals + per-region detail for the UI.
function summarisePlan(plan, role, liveRegions) {
  let totalSpend = 0, totalApps = 0, totalHires = 0;
  const regionRows = [];
  liveRegions.forEach(r => {
    let regSpend = 0, regApps = 0;
    PLATFORMS.forEach(p => {
      const sp = plan[r]?.[p] || 0;
      regSpend += sp;
      regApps += predictedApps(p, r, role, sp);
    });
    const regHires = predictedHiresFromApps(r, role, regApps);
    totalSpend += regSpend; totalApps += regApps; totalHires += regHires;
    regionRows.push({ region: r, spend: regSpend, apps: regApps, hires: regHires });
  });
  return { totalSpend, totalApps, totalHires, regionRows };
}

// ====================================================================
// BUDGET SOLVER - the inverse of the allocator.
// "Given an application target, what budget is needed?"
// This can't be a simple division: the blended cost-per-application drifts
// as the budget grows (small budgets sit on the cheapest cells; larger ones
// spread into pricier cells and hit soft per-cell caps). So we binary-search
// the budget, running the real allocation engine each iteration, until the
// predicted application total lands on the target. Using the real engine
// means the answer can never disagree with what the Plan tab shows.
// ====================================================================
function solveBudgetForTarget(role, target, liveRegions, coverageFloor) {
  if (!target || target <= 0 || liveRegions.length === 0) {
    return { budget: 0, predictedApps: 0, blendedCPA: 0, iterations: 0, capped: false };
  }
  const appsForBudget = (budget) => {
    const { plan } = allocateApplications(role, budget, liveRegions, coverageFloor);
    return summarisePlan(plan, role, liveRegions).totalApps;
  };

  // Lower bound: the coverage floor cost is the minimum the engine will spend.
  let lo = coverageFloor * liveRegions.length;
  // Upper bound: grow until predicted apps meet or exceed the target, or we
  // hit a sane ceiling (the engine's soft caps mean apps stop scaling with
  // budget eventually; beyond that, more budget can't buy more apps).
  let hi = Math.max(lo, target * 60); // generous first guess (~£60 CPA)
  let hiApps = appsForBudget(hi);
  let grows = 0;
  while (hiApps < target && grows < 8) {
    hi *= 1.8;
    hiApps = appsForBudget(hi);
    grows++;
  }
  // If even a very large budget can't reach the target, the engine is
  // capacity-capped: report the most the data supports.
  if (hiApps < target) {
    return {
      budget: hi, predictedApps: hiApps,
      blendedCPA: hiApps > 0 ? hi / hiApps : 0,
      iterations: grows, capped: true,
    };
  }

  // Binary search between lo and hi for the budget that hits the target.
  let iterations = 0;
  while (hi - lo > 50 && iterations < 40) {
    const mid = (lo + hi) / 2;
    const apps = appsForBudget(mid);
    if (apps >= target) hi = mid; else lo = mid;
    iterations++;
  }
  const budget = Math.ceil(hi / 50) * 50; // round up to nearest £50
  const predictedApps = appsForBudget(budget);
  return {
    budget,
    predictedApps,
    blendedCPA: predictedApps > 0 ? budget / predictedApps : 0,
    iterations,
    capped: false,
  };
}


// ====================================================================
// ROLE-FILLING ALLOCATION  (the model the tool now plans on)
// The tool no longer chases the cheapest applications. Its job is to make
// sure every live location has enough budget behind it to fill its roles.
//   1. Hold-backs come off the top: Indeed Premium + the Combined Activity reserve.
//   2. What is left is the deployable budget.
//   3. Each live location is sized by need: vacancies x apps-per-role x the
//      location's own historic cost-per-application.
//   4. A buffer sits on top of each location's need (mid-month headroom).
//   5. Verdict: does the deployable budget cover every location's funded
//      target? If yes, show the leftover. If no, fund the locations with the
//      most open roles first and report how many are covered.
// ====================================================================
const INDEED_PREMIUM_RATE = 44;       // GBP/day per Indeed Premium campaign
const AC_RESERVE_DEFAULT = 3000;      // GBP held back per role for Combined Activity
const COVERAGE_RESERVE_DEFAULT = 10;  // % of deployable budget split equally for location coverage

// Blended historic cost-per-application for a location, for one role, across
// all four platforms (total spend / total applications). Thin-data locations
// are shrunk toward the role benchmark so a tiny, lucky sample cannot size a
// location's budget at an unrealistically low rate.
function regionBlendedCPA(region, role) {
  let spend = 0, apps = 0;
  PLATFORMS.forEach(p => {
    const s = getStats(p, region, role);
    if (s && s.completes > 0) { spend += s.spend; apps += s.completes; }
  });
  const bench = DATA.cpa_benchmarks && DATA.cpa_benchmarks[role] ? DATA.cpa_benchmarks[role] : 40;
  if (apps <= 0) return { cpa: bench, rawCpa: null, apps: 0, source: 'benchmark' };
  const raw = spend / apps;
  const cpa = (apps * raw + CPA_PRIOR_K * bench) / (apps + CPA_PRIOR_K);
  return {
    cpa, rawCpa: raw, apps,
    source: Math.abs(cpa - raw) > 0.5 ? 'shrunk' : 'measured',
  };
}

// Role-average conversion rate, used as a fallback for any location with no
// benchmark CVR of its own.
function roleAvgCVR(role) {
  const m = (DATA.cvr_benchmarks && DATA.cvr_benchmarks[role]) || {};
  const vals = Object.values(m).filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.02;
}

// Month-to-month volatility of a location's blended cost-per-application,
// expressed as a +/- %. Used to present a credible range rather than a single
// false-precise number -- a client trusts a range that lands.
function regionPredictionBand(region, role) {
  const months = {};
  PLATFORMS.forEach(p => {
    const m = getMonthly(p, region, role);
    Object.keys(m).forEach(k => {
      const cell = m[k];
      if (!cell) return;
      if (!months[k]) months[k] = { spend: 0, apps: 0 };
      months[k].spend += cell.spend || 0;
      months[k].apps += cell.completes || 0;
    });
  });
  const cpas = Object.values(months)
    .filter(x => x.apps >= 3 && x.spend > 0)
    .map(x => x.spend / x.apps);
  if (cpas.length < 3) return { pct: 35, basis: 'thin', n: cpas.length };
  const mean = cpas.reduce((a, b) => a + b, 0) / cpas.length;
  const variance = cpas.reduce((a, b) => a + (b - mean) ** 2, 0) / cpas.length;
  const cov = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return { pct: Math.max(8, Math.min(45, Math.round(cov * 100))), basis: 'measured', n: cpas.length };
}

// Role-level CPA for a single platform, aggregated across every region with
// historic data on that platform-role. Same shrinkage as regionBlendedCPA --
// pulled toward the role benchmark for thin samples -- so a platform with
// little history doesn't anchor predictions at an unrealistic rate.
function rolePlatformCPA(plat, role) {
  let spend = 0, apps = 0;
  DATA.regions_ordered.forEach(r => {
    const s = getStats(plat, r, role);
    if (s && s.completes > 0) { spend += (s.spend || 0); apps += (s.completes || 0); }
  });
  const bench = DATA.cpa_benchmarks && DATA.cpa_benchmarks[role] ? DATA.cpa_benchmarks[role] : 40;
  if (apps <= 0) return { cpa: bench, rawCpa: null, apps: 0, source: 'benchmark' };
  const raw = spend / apps;
  const cpa = (apps * raw + CPA_PRIOR_K * bench) / (apps + CPA_PRIOR_K);
  return { cpa, rawCpa: raw, apps, source: Math.abs(cpa - raw) > 0.5 ? 'shrunk' : 'measured' };
}

// Per-platform CPA for a specific region and role. Shrinks toward the
// platform's role-wide CPA rather than the overall role benchmark, so a thin
// London-Appcast cell gets pulled toward Appcast's typical rate for this role
// rather than the overall blended rate.
function regionPlatformCPA(plat, region, role) {
  const platRole = rolePlatformCPA(plat, role);
  const s = getStats(plat, region, role);
  if (!s || s.completes <= 0) {
    return { cpa: platRole.cpa, rawCpa: null, apps: 0, source: 'benchmark' };
  }
  const raw = s.spend / s.completes;
  const cpa = (s.completes * raw + CPA_PRIOR_K * platRole.cpa) / (s.completes + CPA_PRIOR_K);
  return { cpa, rawCpa: raw, apps: s.completes, source: Math.abs(cpa - raw) > 0.5 ? 'shrunk' : 'measured' };
}

// Measured conversion rate (completed applications / clicks) for a single
// platform in a single region. Read straight from the data with no shrinkage:
// this is the real funnel rate from history. Returns 0 when there's no
// measured click history for that cell (genuinely no activity).
function regionPlatformCVR(plat, region, role) {
  const s = getStats(plat, region, role);
  return s && s.cvr > 0 ? s.cvr : 0;
}

// Spend-weighted blended CVR for one platform across the regions in a plan.
// Weighted by each region's spend on that platform, so the channel-level CVR
// reflects where the money actually goes.
function platformBlendedCVR(plat, role, locs) {
  let wSum = 0, w = 0;
  (locs || []).forEach(l => {
    const sp = (l.platSpend && l.platSpend[plat]) || 0;
    const cv = regionPlatformCVR(plat, l.region, role);
    if (sp > 0 && cv > 0) { wSum += cv * sp; w += sp; }
  });
  return w > 0 ? wSum / w : 0;
}

// ---- Hire metrics (application -> hire) -----------------------------------
// These come from RAC's own historic file (SH_Historic_Data), not recomputed
// from the plan. hireCvr is the application-to-hire rate; cph is cost-per-hire.
// Both are static per platform-region. The file is SMR data; Patrol is scaled
// (CVR x 0.933, CPH / 0.933) at ingest, so the value read here is already the
// right one for the role. Returns null where RAC has no data for the region
// (North East, Wales, Northern Ireland).
// Which set of hire rates the tool is using. Null means the ones the data
// file ships with, which is what every plan before 18 August was built on.
//   { at, note, rates: { SMR: { London: { indeed: 0.0038, ... } } } }
// Anything edited by hand lands in the same object, so a hand-set rate and a
// pasted one are read the same way.
let HIRE_OVERRIDE = null;
function setHireOverride(o) {
  HIRE_OVERRIDE = (o && o.rates) ? o : null;
  Object.keys(_platformCPACache).forEach(k => delete _platformCPACache[k]);
  _planCache.clear();
}
function hireOverrideFor(plat, region, role) {
  if (!HIRE_OVERRIDE) return null;
  const v = ((HIRE_OVERRIDE.rates[role] || {})[region] || {})[plat];
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

function regionPlatformHireCVR(plat, region, role) {
  const o = hireOverrideFor(plat, region, role);
  if (o !== null) return o;
  const s = getStats(plat, region, role);
  return s && s.hireCvr != null ? s.hireCvr : null;
}
// Cost per hire for one platform in one location: this role's cost per
// application there, divided by the rate at which those applications become
// hires.
//
// It used to read the cph stored in the data file, which came over from
// Scott's sheet alongside the hire rate. Only the rate travelled cleanly. The
// spend behind his cost per hire was not the spend the ad platforms are
// running, so the stored figures implied applications costing 13 to 30 pounds
// in the northern locations while the platforms deliver them at 47 to 79. The
// result was a row in the PDF whose three columns did not multiply out: North
// West read 54 pounds an application at a 1.46% hire rate and then claimed a
// 979 pound hire, where those two numbers give 3,699.
//
// The hire rate is still Scott's. Only the money is now ours.
function regionPlatformCPH(plat, region, role) {
  const rate = regionPlatformHireCVR(plat, region, role);
  if (!(rate > 0)) return null;
  const cpa = effectiveCPA(plat, region, role);
  return (cpa && cpa.cpa > 0) ? cpa.cpa / rate : null;
}

// Predicted hires for one platform in one location: predicted apps for that
// platform x its static hire CVR. Null hire rate contributes zero hires (the
// apps are still real, we just can't forecast hires without a rate).
function platformPredictedHires(plat, region, role, platApps) {
  const hr = regionPlatformHireCVR(plat, region, role);
  return hr != null ? platApps * hr : 0;
}

// Month-to-month volatility of a platform's role-wide cost-per-application.
// Same method as regionPredictionBand but aggregated across regions for the
// single platform, so we can present a +/- range for the channel summary.
function rolePlatformBand(plat, role) {
  const months = {};
  DATA.regions_ordered.forEach(r => {
    const m = getMonthly(plat, r, role);
    Object.keys(m).forEach(k => {
      const cell = m[k];
      if (!cell) return;
      if (!months[k]) months[k] = { spend: 0, apps: 0 };
      months[k].spend += cell.spend || 0;
      months[k].apps += cell.completes || 0;
    });
  });
  const cpas = Object.values(months)
    .filter(x => x.apps >= 3 && x.spend > 0)
    .map(x => x.spend / x.apps);
  if (cpas.length < 3) return { pct: 35, basis: 'thin', n: cpas.length };
  const mean = cpas.reduce((a, b) => a + b, 0) / cpas.length;
  const variance = cpas.reduce((a, b) => a + (b - mean) ** 2, 0) / cpas.length;
  const cov = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return { pct: Math.max(8, Math.min(45, Math.round(cov * 100))), basis: 'measured', n: cpas.length };
}

// Build the APPLICATION plan for one role.
//   - Hold-backs (Indeed Premium + Combined Activity) come off the top -> deployable budget.
//   - A coverage reserve can be split EQUALLY across every live
//     location, so even a one-role location has a visible, funded presence
//     and the demand waterfall never starves it.
//   - The rest follows demand: each location's share = its open roles / total.
//   - Predicted applications = each location's spend / its blended CPA.
//   - The client's application target is split across locations by demand too,
//     giving every location its own sub-target to plan against.
//   Predicted applications scale linearly with the deployable budget, so the
//   budget needed to hit the target is a direct calculation, not a search.
function buildFundingPlan(role, p) {
  if (!p._solving) {
    const key = role + '|' + JSON.stringify(p) + '|' + JSON.stringify(BENCH) + '|' + CAP_MULTIPLE;
    const hit = _planCache.get(key);
    if (hit) return hit;
    const built = buildFundingPlanUncached(role, p);
    if (_planCache.size > 40) _planCache.clear();
    _planCache.set(key, built);
    return built;
  }
  return buildFundingPlanUncached(role, p);
}

function buildFundingPlanUncached(role, p) {
  setCapMultiple(p.capMultiple);
  // Each role carries its own period, so the figures cannot depend on what
  // happens to be selected on screen.
  setBenchWindow(p.bench);
  const daysInMonth = p.daysInMonth || 30;
  // Off by default. Stress tested across sixteen demand shapes and it never
  // moved the worst-off location by more than about thirty pounds: a location
  // the demand split would starve has no spend history, and the ceiling will
  // not let it take the extra anyway. Kept as a parameter, not as a control.
  const coverageRate = (p.coveragePct >= 0 ? p.coveragePct : 0) / 100;
  const premiumHoldback = Math.round((p.premiumCampaigns || 0) * daysInMonth * INDEED_PREMIUM_RATE);
  const acHoldback = Math.max(0, Math.round(p.acReserve || 0));
  const deployable = Math.max(0, (p.budget || 0) - premiumHoldback - acHoldback);
  const appTarget = Math.max(0, p.appTarget || 0);
  const fallbackCVR = roleAvgCVR(role);

  // Role-wide platform share, used as the fallback for locations with thin or
  // no historic spend. Computed once per role from all-time spend across every
  // region. Each location's own historic split takes precedence below.
  const roleHist = {}; let roleHistTotal = 0;
  PLATFORMS.forEach(plat => {
    roleHist[plat] = 0;
    DATA.regions_ordered.forEach(r => {
      const s = getStats(plat, r, role);
      if (s) { roleHist[plat] += (s.spend || 0); roleHistTotal += (s.spend || 0); }
    });
  });
  const roleShare = {};
  if (roleHistTotal > 0) PLATFORMS.forEach(plat => { roleShare[plat] = roleHist[plat] / roleHistTotal; });
  else PLATFORMS.forEach(plat => { roleShare[plat] = 0.25; });

  const locs = (p.liveRegions || [])
    .map(region => {
      const vac = Math.max(0, Math.round((p.vacancies && p.vacancies[region]) || 0));
      const c = regionBlendedCPA(region, role);
      let cvr = (DATA.cvr_benchmarks && DATA.cvr_benchmarks[role] && DATA.cvr_benchmarks[role][region]) || 0;
      if (!(cvr > 0)) cvr = fallbackCVR;
      const band = regionPredictionBand(region, role);
      // Platform split: each location's spend is divided across the 4 platforms
      // in proportion to historic spend on that location-role. Locations with
      // under £200 of history fall back to the role-wide share, the same mix
      // that's been delivering across all locations for this role.
      const locHist = {}; let locHistTotal = 0;
      PLATFORMS.forEach(plat => {
        const s = getStats(plat, region, role);
        locHist[plat] = s ? (s.spend || 0) : 0;
        locHistTotal += locHist[plat];
      });
      const platShare = {};
      if (locHistTotal >= 200) PLATFORMS.forEach(plat => { platShare[plat] = locHist[plat] / locHistTotal; });
      else PLATFORMS.forEach(plat => { platShare[plat] = roleShare[plat]; });
      let platShareSource = locHistTotal >= 200 ? 'location' : 'role';
      // Curves are worked out here and applied once the location's budget is
      // known, further down. Historic share stays as the fallback.
      const curves = {}, caps = {}, peaks = {};
      PLATFORMS.forEach(plat => {
        const mon = getMonthly(plat, region, role);
        const sp = Object.values(mon).map(m => m.spend || 0).filter(x => x > 0);
        peaks[plat] = sp.length ? Math.max(...sp) : 0;
        // Every platform gets a ceiling from its own biggest month, whether or
        // not a curve could be fitted for it.
        // Its own biggest month where it has one. Where it has never run in
        // this location, the platform's typical month elsewhere, so the
        // ceiling is still a figure that has been spent somewhere.
        caps[plat] = peaks[plat] > 0
          ? peaks[plat] * CAP_MULTIPLE
          : typicalMonth(plat, role) * CAP_MULTIPLE;
        const cv = responseCurve(plat, region, role);
        if (cv) curves[plat] = cv;
      });
      // Coverage mask: for this region, which platforms may receive budget.
      // Default (no coverage set) is every platform on, so the plan behaves
      // exactly as before. An off platform is removed from the location's mix
      // and the remaining on-platforms are renormalised to soak up its share.
      // This is what lets a plan run, e.g., South East on Meta and Google only
      // while other regions carry Indeed and Appcast.
      const covRegion = (p.coverage && p.coverage[region]) || null;
      const onPlat = {};
      PLATFORMS.forEach(plat => { onPlat[plat] = covRegion ? covRegion[plat] !== false : true; });
      PLATFORMS.forEach(plat => { if (!onPlat[plat]) platShare[plat] = 0; });
      const onSum = PLATFORMS.reduce((s, plat) => s + platShare[plat], 0);
      const coveredCount = PLATFORMS.filter(plat => onPlat[plat]).length;
      if (onSum > 0) {
        PLATFORMS.forEach(plat => { platShare[plat] = platShare[plat] / onSum; });
      } else if (coveredCount > 0) {
        // Eligible platforms exist but none carry historic share: split equally.
        PLATFORMS.forEach(plat => { platShare[plat] = onPlat[plat] ? 1 / coveredCount : 0; });
      }
      return {
        region, vacancies: vac,
        cpa: c.cpa, rawCpa: c.rawCpa, cpaSource: c.source, cvr,
        bandPct: band.pct, bandBasis: band.basis,
        coverageSlice: 0, demandShare: 0, spend: 0,
        predApps: 0, predLow: 0, predHigh: 0, predHires: 0, appSubTarget: 0,
        platShare, platShareSource, platSpend: {}, onPlat, coveredCount,
        curves, caps, peaks, marginal: null,
      };
    })
    // Live regions must have a vacancy and at least one covered platform to
    // receive budget; a region with every platform switched off is dropped so
    // its demand share flows to the regions that can actually spend it.
    .filter(l => l.vacancies > 0 && l.coveredCount > 0);

  const M = locs.length;
  const totalVac = locs.reduce((s, l) => s + l.vacancies, 0);
  const coverageReserve = deployable * coverageRate;
  const demandPool = deployable - coverageReserve;

  // Per-location-per-platform CPAs, used as the source of truth for predicting
  // applications. Each platform's spend in a location predicts apps using that
  // platform's CPA there. Location predicted apps = sum across platforms. This
  // makes the location-level total and the channel-level total reconcile by
  // construction, and means changing the platform mix (via min/max) actually
  // shifts the predicted apps - not just the budget allocation.
  locs.forEach(l => {
    l.platCpa = {};
    l.platCpaSource = {};
    PLATFORMS.forEach(plat => {
      const pc = regionPlatformCPA(plat, l.region, role);
      l.platCpa[plat] = pc.cpa;
      l.platCpaSource[plat] = pc.source;
    });
  });

  // Base per-location budget: equal coverage slice plus demand share.
  locs.forEach(l => {
    l.coverageSlice = M > 0 ? coverageReserve / M : 0;
    l.demandShare = totalVac > 0 ? demandPool * (l.vacancies / totalVac) : 0;
    l.spend = l.coverageSlice + l.demandShare;
    l.appSubTarget = totalVac > 0 ? appTarget * (l.vacancies / totalVac) : 0;
  });

  // ----- Apply per-region budget limits (GBP, per location) -----
  // regionMin/regionMax cap what a single location can take. 0 or undefined
  // means no limit, which leaves no way to say "cap this at nothing". A cap of
  // NO_SPEND (-1) means exactly that: hold the location open in the plan and
  // every table, funded at zero. Typing N in the box on Setup sets it.
  //
  // A sentinel rather than switching 0 to mean zero spend, because every plan
  // already saved stores 0 for "no limit" and reinterpreting it would silently
  // zero out locations in old versions. Money trimmed off a capped location is redistributed to
  // the locations still below their cap, in proportion to their demand share.
  // Money needed to lift a location to its floor is taken from the others the
  // same way. The deployable total is preserved; if every location is capped
  // the remainder is reported as unplaced rather than silently vanishing.
  const regionMin = p.regionMin || {};
  const regionMax = p.regionMax || {};
  const regionClamped = {};
  let unplacedBudget = 0;
  const hasRegionLimits = locs.some(l =>
    (regionMin[l.region] > 0) || (regionMax[l.region] > 0) || (regionMax[l.region] === NO_SPEND));
  if (hasRegionLimits && locs.length > 0) {
    const capOf = l => (regionMax[l.region] === NO_SPEND ? 0
      : (regionMax[l.region] > 0 ? regionMax[l.region] : Infinity));
    const floorOf = l => (regionMin[l.region] > 0 ? regionMin[l.region] : 0);
    // Pass 1: clamp every location to its cap or floor, collecting the
    // difference in a pool (positive = money to place, negative = money owed).
    let pool = 0;
    locs.forEach(l => {
      const cap = capOf(l), floor = floorOf(l);
      if (l.spend > cap) { pool += l.spend - cap; l.spend = cap; regionClamped[l.region] = 'max'; }
      else if (l.spend < floor) { pool -= floor - l.spend; l.spend = floor; regionClamped[l.region] = 'min'; }
    });
    // Pass 2: settle the pool. Each round places what the open locations can
    // actually absorb (or claws back what donors can give); anything that will
    // not fit stays in the pool and is retried next round against the
    // locations that still have room. Without this carry-over, money that hit
    // a cap mid-redistribution would silently disappear from the plan.
    for (let iter = 0; iter < 40 && Math.abs(pool) > 0.5; iter++) {
      if (pool > 0) {
        const open = locs.filter(l => l.spend < capOf(l) - 0.005);
        if (open.length === 0) break;
        const w = open.reduce((s, l) => s + (l.vacancies || 0), 0);
        let placed = 0;
        open.forEach(l => {
          const share = w > 0 ? (l.vacancies || 0) / w : 1 / open.length;
          const add = Math.min(pool * share, capOf(l) - l.spend);
          l.spend += add; placed += add;
        });
        if (placed < 0.005) break;
        pool -= placed;
      } else {
        const need = -pool;
        const donors = locs.filter(l => l.spend > floorOf(l) + 0.005);
        if (donors.length === 0) break;
        const w = donors.reduce((s, l) => s + (l.vacancies || 0), 0);
        let taken = 0;
        donors.forEach(l => {
          const share = w > 0 ? (l.vacancies || 0) / w : 1 / donors.length;
          const sub = Math.min(need * share, l.spend - floorOf(l));
          l.spend -= sub; taken += sub;
        });
        if (taken < 0.005) break;
        pool += taken;
      }
    }
    // Whatever could not be placed (every location at its cap) is reported
    // rather than quietly dropped, so the plan always reconciles.
    unplacedBudget = Math.max(0, pool);
  }

  // Platform split and predictions, using the (possibly clamped) location spend.
  locs.forEach(l => {
    // Marginal-cost split where the plan asks for it and there are curves to
    // use; historic share otherwise, and for any platform without a curve.
    let done = false;
    {
      const on = PLATFORMS.filter(plat => l.onPlat[plat] && l.curves[plat] && l.curves[plat].hireRate > 0);
      const off = PLATFORMS.filter(plat => l.onPlat[plat] && !(l.curves[plat] && l.curves[plat].hireRate > 0));
      // Platforms with no curve keep their historic share of the money first.
      const noCurveShare = off.reduce((a, plat) => a + (l.platShare[plat] || 0), 0);
      const forCurves = l.spend * (1 - noCurveShare);
      const r = splitByResponse(forCurves, on, l.curves, l.caps);
      if (r) {
        PLATFORMS.forEach(plat => { l.platSpend[plat] = 0; });
        off.forEach(plat => { l.platSpend[plat] = l.spend * (l.platShare[plat] || 0); });
        Object.keys(r.split).forEach(plat => { l.platSpend[plat] = r.split[plat]; });
        l.marginal = r.marginal;
        l.platShareSource = 'response';
        PLATFORMS.forEach(plat => { l.platShare[plat] = l.spend > 0 ? l.platSpend[plat] / l.spend : 0; });
        done = true;
      }
    }
    if (!done) PLATFORMS.forEach(plat => { l.platSpend[plat] = l.spend * l.platShare[plat]; });

    // Nothing goes above what that location and platform has already spent,
    // whichever way the split was worked out. Anything trimmed moves to a
    // platform in the same location that still has room. If none has, it is
    // reported rather than quietly spent anyway.
    l.overCap = 0;
    const capOf = (plat) => (l.onPlat[plat] ? l.caps[plat] : 0);
    // Where the ceilings could not take the whole of this location's budget,
    // the split hands back what would not fit. Pick it up here so it is spent
    // and flagged rather than quietly lost.
    let spare = Math.max(0, l.spend - PLATFORMS.reduce((a, plat) => a + (l.platSpend[plat] || 0), 0));
    PLATFORMS.forEach(plat => {
      const c = capOf(plat);
      if (l.platSpend[plat] > c) { spare += l.platSpend[plat] - c; l.platSpend[plat] = c; }
    });
    for (let pass = 0; pass < 6 && spare > 0.5; pass++) {
      const room = PLATFORMS.filter(plat => l.onPlat[plat] && capOf(plat) - l.platSpend[plat] > 0.01);
      if (!room.length) break;
      const headroom = room.reduce((a, plat) => a + (capOf(plat) - l.platSpend[plat]), 0);
      const give = Math.min(spare, headroom);
      room.forEach(plat => { l.platSpend[plat] += give * ((capOf(plat) - l.platSpend[plat]) / headroom); });
      spare -= give;
    }
    // Whatever is still left goes out anyway, spread across the platforms in
    // proportion to what they already hold. RAC have committed the budget, so
    // the plan spends it. What it does not do is pretend that part is as well
    // evidenced: every pound above a proven month is recorded per platform and
    // reported, so the uncertain portion can be pointed at.
    l.beyondProven = {};
    PLATFORMS.forEach(plat => { l.beyondProven[plat] = 0; });
    if (spare > 0.5) {
      const on = PLATFORMS.filter(plat => l.onPlat[plat]);
      const base = on.reduce((a, plat) => a + (l.platSpend[plat] || 0), 0);
      on.forEach(plat => {
        const share = base > 0 ? (l.platSpend[plat] || 0) / base : 1 / on.length;
        const extra = spare * share;
        l.platSpend[plat] = (l.platSpend[plat] || 0) + extra;
        l.beyondProven[plat] = extra;
      });
      spare = 0;
    }
    l.beyondProvenTotal = PLATFORMS.reduce((a, plat) => a + l.beyondProven[plat], 0);
    l.overCap = 0;
    l.spend = PLATFORMS.reduce((a, plat) => a + (l.platSpend[plat] || 0), 0);

    // ----- Per-combination floors (location x platform, GBP) -----
    // Named comboMin, not platMin: platMin already exists as a role-wide
    // threshold keyed by platform, and reusing the name would have silently
    // corrupted it. This one is keyed by region then platform.
    //
    // The coverage grid can already switch a combination off. This is the
    // other direction: force a minimum into one, where the marginal-cost split
    // would not have put it. Mid-month replans need it, because what a
    // location has already committed on a platform is not something the engine
    // can see.
    //
    // The money comes from the other platforms in the same location, so the
    // location's own budget does not move and nothing upstream has to be
    // redone. A floor beats the spend ceiling, because it is an instruction
    // rather than an inference, but the part above the ceiling is recorded in
    // beyondProven like any other unproven pound.
    const cMin = (p.comboMin && p.comboMin[l.region]) || null;
    const comboFloor = plat => (cMin && l.onPlat[plat] && cMin[plat] > 0 ? cMin[plat] : 0);
    const floorSum = PLATFORMS.reduce((a, plat) => a + comboFloor(plat), 0);
    l.floorShortfall = 0;
    if (floorSum > 0.5) {
      if (floorSum > l.spend + 0.5) {
        // The floors ask for more than this location has. Hold their
        // proportions, spend what there is, and report the gap rather than
        // inventing budget.
        l.floorShortfall = floorSum - l.spend;
        PLATFORMS.forEach(plat => { l.platSpend[plat] = comboFloor(plat) * (l.spend / floorSum); });
      } else {
        let need = 0;
        PLATFORMS.forEach(plat => {
          const f = comboFloor(plat);
          if ((l.platSpend[plat] || 0) < f) { need += f - (l.platSpend[plat] || 0); l.platSpend[plat] = f; }
        });
        for (let pass = 0; pass < 8 && need > 0.5; pass++) {
          const donors = PLATFORMS.filter(plat => l.onPlat[plat] && (l.platSpend[plat] || 0) > comboFloor(plat) + 0.01);
          if (!donors.length) break;
          const avail = donors.reduce((a, plat) => a + (l.platSpend[plat] - comboFloor(plat)), 0);
          const take = Math.min(need, avail);
          donors.forEach(plat => { l.platSpend[plat] -= take * ((l.platSpend[plat] - comboFloor(plat)) / avail); });
          need -= take;
        }
      }
      // A floor can push a combination past its ceiling. Record that pound as
      // unproven, the same as any other, so page 1 still adds up.
      PLATFORMS.forEach(plat => {
        const over = (l.platSpend[plat] || 0) - capOf(plat);
        if (over > l.beyondProven[plat]) l.beyondProven[plat] = Math.max(0, over);
      });
      l.beyondProvenTotal = PLATFORMS.reduce((a, plat) => a + l.beyondProven[plat], 0);
      l.spend = PLATFORMS.reduce((a, plat) => a + (l.platSpend[plat] || 0), 0);
    }
    // Per-platform predicted apps
    l.platApps = {};
    let totApps = 0;
    PLATFORMS.forEach(plat => {
      const a = l.platCpa[plat] > 0 ? l.platSpend[plat] / l.platCpa[plat] : 0;
      l.platApps[plat] = a;
      totApps += a;
    });
    l.predApps = totApps;
    // Derived blended CPA for display: implied weighted average across platforms
    l.cpa = totApps > 0 ? l.spend / totApps : 0;
    l.predLow = l.predApps * (1 - l.bandPct / 100);
    l.predHigh = l.predApps * (1 + l.bandPct / 100);
    // Predicted hires: per platform, predicted apps x that cell's static hire
    // CVR (from RAC history), summed. Blended hire CVR and CPH derived back.
    l.platHires = {};
    let totHires = 0;
    PLATFORMS.forEach(plat => {
      const h = platformPredictedHires(plat, l.region, role, l.platApps[plat]);
      l.platHires[plat] = h;
      totHires += h;
    });
    l.predHires = totHires;
    l.hireCvr = l.predApps > 0 ? l.predHires / l.predApps : 0;
    // Fewer applications means fewer hires. Same rate, same band.
    l.predHiresLow = l.predHires * (1 - l.bandPct / 100);
    l.predHiresHigh = l.predHires * (1 + l.bandPct / 100);
    l.cph = l.predHires > 0 ? l.spend / l.predHires : null;
  });

  // ----- Apply per-platform min/max constraints (role-wide totals) -----
  // platMin/platMax are role-wide GBP thresholds. 0 (or undefined) means no
  // constraint. Algorithm: iteratively find the platform with the biggest
  // violation, scale that platform's spend in every location toward its
  // target, and rebalance the other platforms within each location so the
  // location total is preserved. Best-effort if constraints conflict.
  const platMin = p.platMin || {};
  const platMax = p.platMax || {};
  const hasConstraints = PLATFORMS.some(plat =>
    (platMin[plat] > 0) || (platMax[plat] > 0));
  const clamped = { indeed: false, meta: false, google: false, appcast: false };
  if (hasConstraints && locs.length > 0) {
    for (let iter = 0; iter < 30; iter++) {
      const totals = {};
      PLATFORMS.forEach(plat => {
        totals[plat] = locs.reduce((sum, l) => sum + (l.platSpend[plat] || 0), 0);
      });
      let worstPlat = null, worstAbsDelta = 0, worstTarget = 0;
      PLATFORMS.forEach(plat => {
        const minV = platMin[plat] > 0 ? platMin[plat] : 0;
        const maxV = platMax[plat] > 0 ? platMax[plat] : Infinity;
        let target = totals[plat];
        if (totals[plat] > maxV) target = maxV;
        else if (totals[plat] < minV) target = minV;
        const absDelta = Math.abs(target - totals[plat]);
        if (absDelta > worstAbsDelta) {
          worstAbsDelta = absDelta; worstPlat = plat; worstTarget = target;
        }
      });
      if (worstPlat === null || worstAbsDelta < 1) break;
      clamped[worstPlat] = true;
      const oldRoleTotal = totals[worstPlat];
      locs.forEach(l => {
        const old = l.platSpend[worstPlat] || 0;
        // If this platform has zero spend role-wide, distribute the target equally
        // across locations as a starting injection.
        const newThis = oldRoleTotal > 0
          ? old * (worstTarget / oldRoleTotal)
          : worstTarget / locs.length;
        const otherOld = l.spend - old;
        const otherNew = l.spend - newThis;
        if (otherOld > 0.01) {
          const k = otherNew / otherOld;
          PLATFORMS.forEach(plat => {
            if (plat !== worstPlat) l.platSpend[plat] = (l.platSpend[plat] || 0) * k;
          });
          l.platSpend[worstPlat] = newThis;
        } else {
          // Location was 100% on the constrained platform: fall back to roleShare
          // for the other platforms.
          l.platSpend[worstPlat] = newThis;
          const rsSum = PLATFORMS
            .filter(plat => plat !== worstPlat)
            .reduce((sum, plat) => sum + (roleShare[plat] || 0), 0);
          PLATFORMS.forEach(plat => {
            if (plat !== worstPlat) {
              l.platSpend[plat] = rsSum > 0
                ? otherNew * ((roleShare[plat] || 0) / rsSum)
                : otherNew / 3;
            }
          });
        }
      });
    }
    // Coverage safety net: the constraint pass can nudge budget onto a platform
    // a region has switched off. Pull any such spend back onto that region's
    // on-platforms, preserving the location total, before predictions recompute.
    locs.forEach(l => {
      let stray = 0;
      PLATFORMS.forEach(plat => {
        if (!l.onPlat[plat] && (l.platSpend[plat] || 0) > 0) { stray += l.platSpend[plat]; l.platSpend[plat] = 0; }
      });
      if (stray > 0) {
        const onTotal = PLATFORMS.reduce((s, plat) => s + (l.onPlat[plat] ? (l.platSpend[plat] || 0) : 0), 0);
        if (onTotal > 0) {
          PLATFORMS.forEach(plat => { if (l.onPlat[plat]) l.platSpend[plat] += stray * ((l.platSpend[plat] || 0) / onTotal); });
        } else {
          const onCount = l.coveredCount || 1;
          PLATFORMS.forEach(plat => { if (l.onPlat[plat]) l.platSpend[plat] += stray / onCount; });
        }
      }
    });
    // Recompute display shares AND per-platform-per-location predictions
    // (constraints have shifted the spend mix, so apps and the implied
    // blended CPA need to be recalculated)
    locs.forEach(l => {
      let totApps = 0;
      l.platApps = {};
      PLATFORMS.forEach(plat => {
        l.platShare[plat] = l.spend > 0 ? (l.platSpend[plat] || 0) / l.spend : 0;
        const a = l.platCpa[plat] > 0 ? (l.platSpend[plat] || 0) / l.platCpa[plat] : 0;
        l.platApps[plat] = a;
        totApps += a;
      });
      l.predApps = totApps;
      l.cpa = totApps > 0 ? l.spend / totApps : 0;
      l.predLow = l.predApps * (1 - l.bandPct / 100);
      l.predHigh = l.predApps * (1 + l.bandPct / 100);
      l.platHires = {};
      let totHires = 0;
      PLATFORMS.forEach(plat => {
        const h = platformPredictedHires(plat, l.region, role, l.platApps[plat]);
        l.platHires[plat] = h;
        totHires += h;
      });
      l.predHires = totHires;
      l.hireCvr = l.predApps > 0 ? l.predHires / l.predApps : 0;
      l.predHiresLow = l.predHires * (1 - l.bandPct / 100);
      l.predHiresHigh = l.predHires * (1 + l.bandPct / 100);
      l.cph = l.predHires > 0 ? l.spend / l.predHires : null;
    });
  }

  // Per-role platform totals across the plan (for the PDF summary).
  const platformTotals = {};
  PLATFORMS.forEach(plat => {
    platformTotals[plat] = locs.reduce((s, l) => s + (l.platSpend[plat] || 0), 0);
  });
  // Detect any platform totals that fall outside the configured limits after
  // best-effort iteration (e.g. when constraints conflict with each other).
  const platBreaches = {};
  PLATFORMS.forEach(plat => {
    const minV = platMin[plat] > 0 ? platMin[plat] : 0;
    const maxV = platMax[plat] > 0 ? platMax[plat] : Infinity;
    const tot = platformTotals[plat];
    if (tot > maxV + 1) platBreaches[plat] = { kind: 'over', limit: maxV, total: tot };
    else if (tot < minV - 1) platBreaches[plat] = { kind: 'under', limit: minV, total: tot };
  });

  // Per-channel summary (Spend, share, CPA, predicted apps, range) for the
  // PDF's channel breakdown and any tracker the client wants to drop it into.
  // Predicted apps are rolled up from per-platform-per-location predictions,
  // so the channel total reconciles with the location-page total by construction.
  // CPA shown is the effective rate implied by the plan's allocation
  // (channel spend / channel predicted apps).
  const channelSummary = PLATFORMS.map(plat => {
    const spend = platformTotals[plat] || 0;
    const apps = locs.reduce((s, l) => s + (l.platApps && l.platApps[plat] || 0), 0);
    const hires = locs.reduce((s, l) => s + (l.platHires && l.platHires[plat] || 0), 0);
    const bandInfo = rolePlatformBand(plat, role);
    return {
      platform: plat,
      spend,
      share: deployable > 0 ? spend / deployable : 0,
      cvr: platformBlendedCVR(plat, role, locs),
      hireCvr: apps > 0 ? hires / apps : 0,
      predHires: hires,
      predHiresLow: locs.reduce((a, l) => a + (l.predHiresLow || 0), 0),
      predHiresHigh: locs.reduce((a, l) => a + (l.predHiresHigh || 0), 0),
      cph: hires > 0 ? spend / hires : null,
      cpa: apps > 0 ? spend / apps : 0,
      predApps: apps,
      predLow: apps * (1 - bandInfo.pct / 100),
      predHigh: apps * (1 + bandInfo.pct / 100),
      bandPct: bandInfo.pct,
      // CPA and apply-CVR ranges share the apps band. A high CPA means clicks
      // converted worse, so the CVR low end pairs with the CPA high end.
      cpaLow: (apps > 0 ? spend / apps : 0) * (1 - bandInfo.pct / 100),
      cpaHigh: (apps > 0 ? spend / apps : 0) * (1 + bandInfo.pct / 100),
      cvrLow: platformBlendedCVR(plat, role, locs) * (1 - bandInfo.pct / 100),
      cvrHigh: platformBlendedCVR(plat, role, locs) * (1 + bandInfo.pct / 100),
    };
  });

  // Per-region summary, the same shape as channelSummary so the PDF can render
  // the two tables from one set of columns. Everything here is already carried
  // on the location, apart from the blended apply CVR, which is spend-weighted
  // across that location's platforms exactly as the channel one is
  // spend-weighted across locations.
  const regionSummary = locs.map(l => {
    let w = 0, wSum = 0;
    PLATFORMS.forEach(plat => {
      const sp = (l.platSpend && l.platSpend[plat]) || 0;
      const cv = regionPlatformCVR(plat, l.region, role);
      if (sp > 0 && cv > 0) { wSum += cv * sp; w += sp; }
    });
    const cvr = w > 0 ? wSum / w : 0;
    const b = (l.bandPct || 0) / 100;
    return {
      region: l.region,
      vacancies: l.vacancies,
      spend: l.spend,
      share: deployable > 0 ? l.spend / deployable : 0,
      cvr, cvrLow: cvr * (1 - b), cvrHigh: cvr * (1 + b),
      predApps: l.predApps, predLow: l.predLow, predHigh: l.predHigh,
      cpa: l.cpa, cpaLow: l.cpa * (1 - b), cpaHigh: l.cpa * (1 + b),
      hireCvr: l.hireCvr,
      predHires: l.predHires,
      predHiresLow: l.predHiresLow, predHiresHigh: l.predHiresHigh,
      cph: l.cph,
      bandPct: l.bandPct,
    };
  });

  // Region x channel breakdown: for every platform, a row per region (all 12,
  // including regions with no live vacancy this month - those show zeros).
  // Each row carries spend, predicted apps, CVR, CPA and the likely range, so
  // the PDF can render one table per role-platform that the client can paste
  // straight into a tracker.
  const regionChannel = {};
  PLATFORMS.forEach(plat => {
    const bandInfo = rolePlatformBand(plat, role);
    regionChannel[plat] = DATA.regions_ordered.map(region => {
      const loc = locs.find(l => l.region === region);
      const spend = loc ? (loc.platSpend[plat] || 0) : 0;
      const apps = loc ? (loc.platApps[plat] || 0) : 0;
      const hires = loc ? (loc.platHires[plat] || 0) : 0;
      const cpaInfo = regionPlatformCPA(plat, region, role);
      const hireCvr = regionPlatformHireCVR(plat, region, role);
      return {
        region,
        live: !!loc,
        spend,
        predApps: apps,
        cvr: regionPlatformCVR(plat, region, role),
        hireCvr,                       // null where RAC has no data
        predHires: hires,
        predHiresLow: hires * (1 - bandInfo.pct / 100),
        predHiresHigh: hires * (1 + bandInfo.pct / 100),
        // Worked out from this row's own cost per application, so the three
        // columns on the page agree with each other.
        cph: (hireCvr > 0)
          ? ((apps > 0 ? spend / apps : cpaInfo.cpa) / hireCvr)
          : null,
        cpa: apps > 0 ? spend / apps : (spend > 0 ? cpaInfo.cpa : 0),
        predLow: apps * (1 - bandInfo.pct / 100),
        predHigh: apps * (1 + bandInfo.pct / 100),
        bandPct: bandInfo.pct,
        cpaLow: (apps > 0 ? spend / apps : cpaInfo.cpa) * (1 - bandInfo.pct / 100),
        cpaHigh: (apps > 0 ? spend / apps : cpaInfo.cpa) * (1 + bandInfo.pct / 100),
        cvrLow: regionPlatformCVR(plat, region, role) * (1 - bandInfo.pct / 100),
        cvrHigh: regionPlatformCVR(plat, region, role) * (1 + bandInfo.pct / 100),
      };
    });
  });

  const beyondProven = locs.reduce((a, l) => a + (l.beyondProvenTotal || 0), 0);
  const unplaceable = 0;
  const predictedApps = locs.reduce((s, l) => s + l.predApps, 0);
  const predictedHires = locs.reduce((s, l) => s + l.predHires, 0);
  let bw = 0, bd = 0;
  locs.forEach(l => { if (l.predApps > 0) { bw += l.bandPct * l.predApps; bd += l.predApps; } });
  // How much the whole plan can move is not the average of how much each
  // location can move. A single location swings more than the role does,
  // because they do not all miss in the same direction to the same degree.
  // So this is measured on the role's own blended cost per application month
  // by month, over the benchmark window, and only falls back to the weighted
  // average of the location bands when there are too few months to measure.
  const rollUpBand = () => {
    const byMonth = {};
    PLATFORMS.forEach(plat => DATA.regions_ordered.forEach(r => {
      const m = getMonthly(plat, r, role);
      Object.keys(m).forEach(mo => {
        if (!(benchWeight(mo) > 0)) return;
        const x = m[mo]; if (!x || !(x.spend > 0)) return;
        const o = byMonth[mo] = byMonth[mo] || { spend: 0, apps: 0 };
        o.spend += x.spend; o.apps += x.completes || 0;
      });
    }));
    const cpas = Object.values(byMonth).filter(o => o.apps > 0).map(o => o.spend / o.apps);
    if (cpas.length < 3) return null;
    const mean = cpas.reduce((a, b) => a + b, 0) / cpas.length;
    if (!(mean > 0)) return null;
    const sd = Math.sqrt(cpas.reduce((a, b) => a + (b - mean) ** 2, 0) / cpas.length);
    return { pct: Math.max(5, Math.min(45, Math.round(sd / mean * 100))), months: cpas.length };
  };
  const roleBand = rollUpBand();
  const aggBandPct = roleBand ? roleBand.pct : (bd > 0 ? bw / bd : 35);
  const aggBandMonths = roleBand ? roleBand.months : 0;
  const predLow = predictedApps * (1 - aggBandPct / 100);
  const predictedHiresLow = predictedHires * (1 - aggBandPct / 100);
  const predictedHiresHigh = predictedHires * (1 + aggBandPct / 100);
  const predHigh = predictedApps * (1 + aggBandPct / 100);

  // What it would take to land on the target. This has to be solved rather
  // than scaled: applications do not rise in step with spend, so working it
  // out from the current plan's applications per pound gives a different
  // answer depending on what budget you happen to be looking at. Running the
  // whole plan at trial budgets gives the same answer from anywhere.
  // If the location minimums add up to the whole deployable budget, every
  // location is pinned and nothing is left for the engine to allocate. The
  // plan then predicts the same applications at any budget, which sends the
  // solver below to the bottom of its search range and returns a figure that
  // is nonsense: it once read 5,050 pounds against a plan spending 134,890.
  //
  // In that case the budget is not solved for, it is simply the sum of what
  // has been fixed, plus the hold-backs.
  const minTotal = locs.reduce((t, l) => t + (regionMin[l.region] > 0 ? regionMin[l.region] : 0), 0);
  const budgetPinned = locs.length > 0 && minTotal >= deployable - 1;

  // Once every location is at its cap, extra budget has nowhere to go and
  // applications stop moving. The solver below then bisects across a flat
  // stretch, so it can settle anywhere inside it, and rounding to the nearest
  // 50 pounds makes the answer flip between two values. Typing one in makes it
  // ask for the other, and round it goes.
  //
  // So: find out whether the caps are binding, by asking what a much larger
  // budget would deliver.
  const capsBinding = !p._solving && appTarget > 0 && (() => {
    const more = buildFundingPlan(role, { ...p, budget: (p.budget || 0) * 2 + 50000, _solving: true });
    return Math.abs(more.predictedApps - predictedApps) < 0.5;
  })();

  // Solve on hires where a hire target is set. The application target is worked
  // back from the hire target through a rate that moves with the allocation, so
  // solving on applications meant chasing a figure that shifted every time the
  // budget changed. Hires are what RAC asked for, so hires are what this
  // answers.
  const hireTarget = Math.max(0, p.hireTarget || 0);
  const solveOnHires = hireTarget > 0;
  const solveTarget = solveOnHires ? hireTarget : appTarget;

  let budgetForTarget = 0;
  if (budgetPinned) {
    budgetForTarget = Math.ceil((minTotal + premiumHoldback + acHoldback) / 50) * 50;
  } else if (solveTarget > 0 && !p._solving) {
    const at = (b) => {
      const q = buildFundingPlan(role, { ...p, budget: b, _solving: true });
      return solveOnHires ? q.predictedHires : q.predictedApps;
    };
    // The top of the search must not depend on the budget currently set, or
    // the bisection takes a different path each time and the answer moves by
    // the rounding step. That is what made this flip between two values and
    // chase itself when you typed one in.
    let lo = premiumHoldback + acHoldback, hi = lo + 500000, guard = 0;
    while (at(hi) < solveTarget && guard++ < 8) hi *= 1.6;
    if (at(hi) >= solveTarget) {
      // Stop once the range is inside the rounding, rather than running a
      // fixed count. The answer is rounded to the nearest 50 pounds anyway.
      for (let i = 0; i < 40 && hi - lo > 2; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) < solveTarget) lo = mid; else hi = mid;
      }
      budgetForTarget = Math.ceil(hi / 50) * 50;
      // Inside a flat stretch any answer within a few hundred pounds is as
      // true as any other, so prefer the budget already set. That stops the
      // box asking for a change that produces nothing and then asking for it
      // back again.
      if (capsBinding && Math.abs(budgetForTarget - (p.budget || 0)) <= 500) {
        budgetForTarget = p.budget || 0;
      }
    }
  }

  return {
    unplaceable, beyondProven,
    role, daysInMonth, coverageRate,
    premiumHoldback, acHoldback, deployable,
    coverageReserve, demandPool,
    locations: locs, totalVac, totalCount: M, platformTotals, channelSummary, regionSummary, regionChannel,
    platBreaches, platClamped: clamped, platMin, platMax,
    regionMin, regionMax, regionClamped, unplacedBudget,
    appTarget, predictedApps, predLow, predHigh, aggBandPct, aggBandMonths, predictedHires,
    predictedHiresLow, predictedHiresHigh,
    onTarget: appTarget > 0 && predictedApps >= appTarget,
    pctOfTarget: appTarget > 0 ? predictedApps / appTarget : (predictedApps > 0 ? 1 : 0),
    budgetForTarget, budgetPinned, capsBinding, solveOnHires,
    targetUnreachable: solveTarget > 0 && !p._solving && budgetForTarget <= 0 && !budgetPinned,
    budget: p.budget || 0,
  };
}

// ====================================================================
// HIRE-FIRST INVERSION
// The hire target is now the input. The application target is derived from
// it, worked back through the blended hire rate for this month's plan shape.
// Everything downstream still runs and reports on applications, unchanged.
//
// The plan's spend split is driven by demand, not by the application target,
// so the blended hire rate is stable whatever the budget. That means one run
// of the real funding engine gives the rate, and the derivation is a division
// rather than a search.
// ====================================================================

// Build the argument object the funding engine expects for one role.

// Every month the dataset holds, oldest first.
let _monthsCache = null;
function dataMonths() {
  if (_monthsCache) return _monthsCache;
  const set = new Set();
  PLATFORMS.forEach(p => Object.keys(DATA[p] || {}).forEach(k => {
    if (k === 'OVERALL') return;
    Object.keys((DATA[p][k] || {}).monthly || {}).forEach(m => set.add(m));
  }));
  _monthsCache = [...set].sort();
  return _monthsCache;
}

function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function applyMonths(months, cells, lastDate) {
  PLATFORMS.forEach(p => {
    Object.keys(DATA[p]).forEach(k => {
      const m = DATA[p][k].monthly; if (!m) return;
      months.forEach(mo => { delete m[mo]; });
    });
    Object.keys((cells || {})[p] || {}).forEach(k => {
      if (!DATA[p][k]) DATA[p][k] = { monthly: {}, all_time: { spend: 0, completes: 0, accepted: 0, started: 0, cph: null, cpa: null, cvr: 0, hireCvr: 0 } };
      DATA[p][k].monthly = DATA[p][k].monthly || {};
      months.forEach(mo => { if (cells[p][k][mo]) DATA[p][k].monthly[mo] = cells[p][k][mo]; });
    });
    // All-time follows from the monthly series. Hire figures carry through:
    // the master sheet has no hire data in it.
    Object.keys(DATA[p]).forEach(k => {
      const c = DATA[p][k]; if (!c.monthly) return;
      let s = 0, n = 0;
      Object.values(c.monthly).forEach(m => { s += m.spend || 0; n += m.completes || 0; });
      c.all_time = c.all_time || {};
      c.all_time.spend = Math.round(s * 100) / 100;
      c.all_time.completes = Math.round(n * 1000) / 1000;
      c.all_time.cpa = n > 0 ? Math.round(s / n * 10000) / 10000 : null;
    });
  });
  const all = new Set([...(DATA.data_months || []), ...months]);
  DATA.data_months = [...all].sort();
  const last = DATA.data_months[DATA.data_months.length - 1];
  if (lastDate) {
    // What the file actually reached, not the end of the month it fell in.
    if (!DATA.data_current_through || lastDate > DATA.data_current_through) DATA.data_current_through = lastDate;
  } else if (last) {
    const [y, m] = last.split('-').map(Number);
    DATA.data_current_through = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  DATA.generated_at = todayISO();
}
