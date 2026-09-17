// RAC planner: splitting money, within a location and between locations.
(function (RAC) {
  'use strict';
  const U = RAC.util;

  // Split X across a location's platforms so the next hire costs the same on
  // each, without passing any platform's cap. `fixed` holds platforms whose
  // spend is already set (floors, platform limits); the rest share what is left.
  //   cells: [{ plat, pc, cap }]
  // Returns spend by platform, money that would not fit under the caps
  // (leftover), and any amount the fixed spends exceed X by (shortfall).
  function splitLocation(cells, X, fixed = {}) {
    const spend = {};
    let fixedSum = 0;
    cells.forEach(c => {
      if (fixed[c.plat] !== undefined) { spend[c.plat] = fixed[c.plat]; fixedSum += fixed[c.plat]; }
    });
    const free = cells.filter(c => fixed[c.plat] === undefined);
    free.forEach(c => { spend[c.plat] = 0; });
    const rest = X - fixedSum;
    if (rest <= 1e-9 || !free.length) return { spend, leftover: Math.max(0, rest), shortfall: Math.max(0, -rest) };
    const capSum = U.sum(free.map(c => c.cap));
    if (capSum <= rest + 1e-9) {
      free.forEach(c => { spend[c.plat] = c.cap; });
      return { spend, leftover: rest - capSum, shortfall: 0 };
    }
    const at = (lam) => free.map(c => Math.min(c.cap, Math.max(0, RAC.forecast.spendForMarginal(c.pc, lam))));
    let lo = 1e-6, hi = 1e13;
    for (let i = 0; i < 200 && hi / lo > 1 + 1e-13; i++) {
      const mid = Math.sqrt(lo * hi);
      if (U.sum(at(mid)) < rest) lo = mid; else hi = mid;
    }
    // Between the two ends the total can jump (a platform with a flat cost
    // switches on all at once), so share the gap by how much each end differs.
    const sl = at(lo), sh = at(hi);
    const tl = U.sum(sl), th = U.sum(sh);
    const t = th > tl ? Math.min(1, Math.max(0, (rest - tl) / (th - tl))) : 0;
    free.forEach((c, i) => { spend[c.plat] = sl[i] + (sh[i] - sl[i]) * t; });
    return { spend, leftover: 0, shortfall: 0, marginal: hi };
  }

  // Predicted hires for a location at total spend X, split as above.
  function locationHires(cells, X, fixed) {
    const s = splitLocation(cells, X, fixed);
    return U.sum(cells.map(c => RAC.forecast.at(c.pc, s.spend[c.plat] || 0).hires));
  }

  // The most a location can spend with predicted cost per hire at or under a
  // limit (D6). Cost per hire rises with spend, so this is a search.
  function spendAtCphLimit(cells, capacity, limit) {
    if (!(limit > 0)) return Infinity;
    const cph = (X) => { const h = locationHires(cells, X); return h > 0 ? X / h : Infinity; };
    if (!(capacity > 0)) return 0;
    if (cph(capacity) <= limit) return capacity;
    let lo = 0, hi = capacity;
    if (!(cph(Math.min(capacity, 1)) <= limit)) return 0;
    for (let i = 0; i < 60 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (cph(mid) <= limit) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Share money between locations by open roles, within each one's floor and
  // cap. Money a capped location cannot take moves to locations with room;
  // what no location can take is returned as unplaced.
  //   locs: [{ region, vacancies, spend, floor, cap }]
  function settle(locs) {
    let pool = 0;
    const steps = [];
    locs.forEach(l => {
      if (l.spend > l.cap) { pool += l.spend - l.cap; steps.push({ region: l.region, amount: -(l.spend - l.cap), reason: l.capReason }); l.spend = l.cap; }
      else if (l.spend < l.floor) { pool -= l.floor - l.spend; steps.push({ region: l.region, amount: l.floor - l.spend, reason: 'location minimum' }); l.spend = l.floor; }
    });
    for (let iter = 0; iter < 60 && Math.abs(pool) > 0.005; iter++) {
      if (pool > 0) {
        const open = locs.filter(l => l.spend < l.cap - 0.005);
        if (!open.length) break;
        const w = U.sum(open.map(l => l.vacancies));
        let placed = 0;
        open.forEach(l => {
          const add = Math.min(pool * (w > 0 ? l.vacancies / w : 1 / open.length), l.cap - l.spend);
          l.spend += add; placed += add;
          if (add > 0.005) steps.push({ region: l.region, amount: add, reason: 'moved from locations at their limit, by open roles' });
        });
        if (placed < 0.005) break;
        pool -= placed;
      } else {
        const donors = locs.filter(l => l.spend > l.floor + 0.005);
        if (!donors.length) break;
        const w = U.sum(donors.map(l => l.vacancies));
        let taken = 0;
        donors.forEach(l => {
          const sub = Math.min(-pool * (w > 0 ? l.vacancies / w : 1 / donors.length), l.spend - l.floor);
          l.spend -= sub; taken += sub;
          if (sub > 0.005) steps.push({ region: l.region, amount: -sub, reason: 'given to locations below their minimum, by open roles' });
        });
        if (taken < 0.005) break;
        pool += taken;
      }
    }
    return { unplaced: Math.max(0, pool), unfunded: Math.max(0, -pool), steps };
  }

  RAC.allocate = { splitLocation, locationHires, spendAtCphLimit, settle };
})(window.RAC = window.RAC || {});
