// RAC planner: snapshots of issued plans (C1 and C2).
//
// A draft plan is worked out again every time it is opened, so it follows the
// data and the assumptions file. An issued plan must not: what RAC was sent has
// to stay exactly as it was sent. Marking a plan as issued stores a snapshot of
// it, and from then on the screens, the PDF and the workings render from the
// snapshot rather than from a new calculation.
//
// A snapshot holds everything the exports read: the plan object itself (its
// inputs, the monthly figures it used, every assumption value including any
// set for that plan, the rates, the results and the ranges), the version stamp
// with the code that produced it, and who issued it and when.
//
// It is stored under its own database key and written once. The app refuses to
// write a key that already holds a snapshot. A database rule to enforce that
// for anyone with direct access is an open item for the app author.
//
//   RAC.snapshot.of(docs, opts)      -> a plain object, safe to store
//   RAC.snapshot.restore(snap)       -> { docs, opts }, ready for the exports
//   RAC.snapshot.key(month, planId)  the database key it belongs under
//   RAC.snapshot.size(snap)          how big it is, in bytes of JSON
(function (RAC) {
  'use strict';

  const VERSION = 1;
  // JSON has no way to write these, and the plan uses Infinity for "no cap".
  const SPECIAL = { Infinity: Infinity, '-Infinity': -Infinity, NaN: NaN };

  function pack(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return { $n: String(value) };
    if (Array.isArray(value)) return value.map(pack);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => { if (value[k] !== undefined) out[k] = pack(value[k]); });
      return out;
    }
    return value;
  }

  function unpack(value) {
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') {
      if (typeof value.$n === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL, value.$n)) return SPECIAL[value.$n];
      const out = {};
      Object.keys(value).forEach(k => { out[k] = unpack(value[k]); });
      return out;
    }
    return value;
  }

  const key = (month, planId) => `issued:${month}:${planId}`;

  // Locations, platforms and the totals each carry the same cell objects twice,
  // once by platform and once as a list. Only one copy is stored; the list is
  // put back on the way out, so nothing that reads the plan can tell.
  function thin(plan) {
    const strip = (o) => { const { cellsList, ...rest } = o; return rest; };
    return {
      ...plan,
      locations: plan.locations.map(l => strip(l)),
      platforms: Object.fromEntries(Object.keys(plan.platforms).map(p => [p, strip(plan.platforms[p])])),
      totals: strip(plan.totals),
    };
  }

  function fatten(plan) {
    const P = RAC.PLATFORMS;
    plan.locations.forEach(l => { l.cellsList = P.map(p => l.cells[p]); });
    P.forEach(p => { if (plan.platforms[p]) plan.platforms[p].cellsList = plan.locations.map(l => l.cells[p]); });
    plan.totals.cellsList = plan.locations.flatMap(l => l.cellsList);
    return plan;
  }

  // docs: [{ role, roleName, plan, commentary }] as the exports take them.
  // opts: { monthLabel, planName, planId, month, code, backtest, issuedBy }.
  function of(docs, opts = {}) {
    const now = new Date().toISOString();
    const snap = {
      snapshotVersion: VERSION,
      month: opts.month || null,
      planId: opts.planId || null,
      planName: opts.planName || null,
      monthLabel: opts.monthLabel || null,
      issuedAt: opts.issuedAt || now,
      issuedBy: opts.issuedBy || null,
      code: RAC.stamp.of(docs[0].plan, opts.code).codeFull || null,
      stamp: RAC.stamp.line(docs[0].plan, opts.code),
      backtest: opts.backtest || null,
      docs: docs.map(d => ({ role: d.role, roleName: d.roleName, commentary: d.commentary || { legacy: [], plan: [] }, plan: pack(thin(d.plan)) })),
    };
    snap.fingerprint = RAC.util.fingerprint(RAC.util.stableKey(snap.docs.map(d => [d.role, d.plan.totals, d.plan.stamps])));
    return snap;
  }

  function restore(snap) {
    if (!snap || snap.snapshotVersion !== VERSION) {
      throw new Error('This issued plan was stored by a different version of the app, so it cannot be opened here.');
    }
    const docs = snap.docs.map(d => ({ role: d.role, roleName: d.roleName, commentary: d.commentary, plan: fatten(unpack(d.plan)) }));
    return {
      docs,
      opts: { monthLabel: snap.monthLabel, planName: snap.planName, backtest: snap.backtest, code: { commit: snap.code } },
    };
  }

  const size = (snap) => JSON.stringify(snap).length;

  RAC.snapshot = { VERSION, of, restore, key, size, pack, unpack, thin, fatten };
})(window.RAC = window.RAC || {});
