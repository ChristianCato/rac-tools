// RAC planner: the plan PDF (D8). Drawn only from the plan object the screen
// used, so its figures are the planner's. A4 landscape, jsPDF.
//
// Order for each document:
//   commentary (the notes on the legacy plan and on this plan; optional)
//   1. summary: budget, hold-backs, fees, hires, applications, the budget for
//      the target (or what is reachable), assumptions and risks
//   2. locations
//   3. platforms
//   4. location and platform, one table per platform, with the cost per
//      application build-up, spending cap, quality and hire rates and ranges
//   5. method and glossary (exports/text.js)
// Every page carries the version stamp (exports/stamp.js). Before saving, the
// output checks (exports/checks.js) run on every string drawn, every table
// row and the title; a document that fails is not saved.
//
//   RAC.pdf.build(jsPDF, docs, opts)   -> { pdf, texts, rows, titles, problems }
//   RAC.pdf.save(jsPDF, docs, opts)    builds, checks, saves; returns the file name
//     docs: [{ role, roleName, plan (the planner result), commentary: { legacy: [..], plan: [..] } }]
//     opts: { notes (default true), monthLabel, planName, code (stamp commit) }
(function (RAC) {
  'use strict';
  const P = () => RAC.PLATFORMS;
  const L = () => RAC.PLATFORM_LABELS;
  const f = () => RAC.text.fmt;

  const NAVY = [20, 33, 61], ORANGE = [242, 140, 40], INK = [33, 37, 41], MUTED = [110, 117, 125];
  const LINE = [214, 219, 226], ZEBRA = [245, 247, 250], HEAD = [232, 236, 242], WARN = [176, 76, 20];
  const PAGE_W = 297, PAGE_H = 210, M = 14, BOTTOM = 192;

  // Cost limits set for this plan (D6), for the assumptions box.
  function limitLines(p, F) {
    const lim = (p.inputs && p.inputs.limits) || {};
    const cph = Object.keys(lim.cph || {}).filter(r => lim.cph[r] > 0);
    const cpa = [];
    Object.keys(lim.cpa || {}).forEach(r => P().forEach(q => { if ((lim.cpa[r] || {})[q] > 0) cpa.push(`${r} ${L()[q]} ${F.gbp(lim.cpa[r][q], 2)}`); }));
    const out = [];
    if (cph.length) out.push(`Cost per hire limits: ${cph.map(r => `${r} ${F.gbp(lim.cph[r])}`).join(', ')}. The plan stops adding spend where a limit would be passed.`);
    if (cpa.length) out.push(`Cost per application limits: ${cpa.join(', ')}.`);
    if (!out.length) out.push('Cost limits: none set for this plan.');
    return out;
  }

  function titleOf(d, monthLabel) {
    const t = d.plan.hireTarget > 0 ? `plan for ${d.plan.hireTarget} hires` : 'plan';
    return `RAC ${monthLabel} ${d.roleName} ${t}`;
  }

  function build(jsPDF, docs, opts = {}) {
    const pdf = new jsPDF('l', 'mm', 'a4');
    const texts = [], rows = [], titles = [];
    const F = f();
    const notes = opts.notes !== false;
    const monthLabel = opts.monthLabel || '';
    let started = false;
    let pageTitle = '', pageSub = '', stampLine = '';
    let y = 0;

    // Drawing helpers. Every string goes through T so the checks see it.
    const T = (s, x, yy, o) => { const str = String(s); texts.push(str); pdf.text(str, x, yy, o || {}); };
    const font = (size, style = 'normal', color = INK) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...color); };
    const wrap = (s, w) => pdf.splitTextToSize(String(s), w);

    function header(title, sub) {
      pdf.setFillColor(...NAVY); pdf.rect(0, 0, PAGE_W, 20, 'F');
      pdf.setFillColor(...ORANGE); pdf.rect(0, 20, PAGE_W, 1.2, 'F');
      font(14, 'bold', [255, 255, 255]); T(title, M, 9.5);
      font(8.5, 'normal', [220, 226, 236]); T(sub, M, 15.5);
      font(8, 'normal', [220, 226, 236]); T(`Prepared by Enhance Media${opts.planName ? ' · ' + opts.planName : ''}`, PAGE_W - M, 9.5, { align: 'right' });
      y = 29;
    }
    function page(title, sub) {
      if (started) pdf.addPage();
      started = true;
      pageTitle = title; pageSub = sub;
      header(title, sub);
    }
    // Room for h mm, or a continuation page.
    function ensure(h, again) {
      if (y + h <= BOTTOM) return false;
      pdf.addPage();
      header(pageTitle + ' (continued)', pageSub);
      if (again) again();
      return true;
    }
    function heading(s) {
      ensure(12);
      font(11, 'bold', NAVY); T(s, M, y); y += 2;
      pdf.setDrawColor(...LINE); pdf.line(M, y, PAGE_W - M, y); y += 5;
    }
    function para(s, x = M, w = PAGE_W - 2 * M, size = 8.5) {
      font(size, 'normal', INK);
      const lines = wrap(s, w);
      lines.forEach(line => { ensure(4.2); T(line, x, y); y += size * 0.42; });
      y += 1.5;
    }

    // A table. cols: [{ label, w, align, sub }]; body: arrays of cell values,
    // where a cell is a string or [main, small second line].
    function table(cols, body, o = {}) {
      const x0 = M;
      const drawHead = () => {
        const hh = 11.5;
        pdf.setFillColor(...HEAD); pdf.rect(x0, y - 4.5, cols.reduce((a, c) => a + c.w, 0), hh, 'F');
        let x = x0;
        cols.forEach(c => {
          font(6.6, 'bold', NAVY);
          const lines = wrap(c.label, c.w - 2).slice(0, 3);
          lines.forEach((ln, i) => T(ln, c.align === 'right' ? x + c.w - 1.5 : x + 1.5, y - 1.4 + i * 2.8, c.align === 'right' ? { align: 'right' } : {}));
          x += c.w;
        });
        y += hh - 2;
      };
      drawHead();
      body.forEach((r, ri) => {
        const two = r.cells.some(v => Array.isArray(v) && v[1]);
        const rh = two ? 7.4 : 4.6;
        if (ensure(rh + 1, drawHead)) { /* continued */ }
        if (r.total) { pdf.setFillColor(...HEAD); pdf.rect(x0, y - 3.4, cols.reduce((a, c) => a + c.w, 0), rh, 'F'); }
        else if (ri % 2 === 1) { pdf.setFillColor(...ZEBRA); pdf.rect(x0, y - 3.4, cols.reduce((a, c) => a + c.w, 0), rh, 'F'); }
        let x = x0;
        cols.forEach((c, ci) => {
          const v = r.cells[ci];
          const main = Array.isArray(v) ? v[0] : v;
          const small = Array.isArray(v) ? v[1] : null;
          const ax = c.align === 'right' ? x + c.w - 1.5 : x + 1.5;
          const al = c.align === 'right' ? { align: 'right' } : {};
          font(7.2, r.total || ci === 0 ? 'bold' : 'normal', r.warn && ci === cols.length - 1 ? WARN : INK);
          T(wrap(main === null || main === undefined ? '' : main, c.w - 2)[0] || '', ax, y, al);
          if (small) { font(5.8, 'normal', MUTED); T(wrap(small, c.w - 2)[0] || '', ax, y + 3, al); }
          x += c.w;
        });
        if (o.rowCheck) rows.push(o.rowCheck(r));
        y += rh;
      });
      y += 3;
    }

    const range = (lo, hi, dp = 0) => `${F.num(lo, dp)} to ${F.num(hi, dp)}`;
    const hireRange = (r) => (r && r.hires ? range(r.hires.low, r.hires.high, 0) : '');
    const appRange = (r) => (r && r.apps ? range(r.apps.low, r.apps.high, 0) : '');
    const x2 = (v, dp = 2) => (v === null || v === undefined || !isFinite(v) ? '-' : 'x' + v.toFixed(dp));

    function commentary(d) {
      [['legacy', 'Notes on the legacy plan'], ['plan', 'Notes on this plan']].forEach(([k, label]) => {
        const pts = (d.commentary && d.commentary[k]) || [];
        if (!pts.length) return;
        page(label, `${d.roleName} · ${monthLabel}`);
        pts.forEach((p, i) => {
          ensure(10);
          font(10, 'bold', ORANGE); T(String(i + 1), M, y);
          font(9.5, 'normal', INK);
          wrap(p, PAGE_W - 2 * M - 10).forEach(line => { ensure(5); T(line, M + 8, y); y += 4.6; });
          y += 2.5;
        });
      });
    }

    function summary(d, title) {
      const p = d.plan, t = p.totals, r = t.range, hb = p.holdbacks, fees = p.fees;
      page(title, `${d.roleName} · summary · ${monthLabel}`);
      titles.push({ title, plan: p });
      const colW = (PAGE_W - 2 * M - 10) / 2;
      const top = y;
      // Left: the money.
      font(10, 'bold', NAVY); T('Budget', M, y); y += 5;
      const money = [
        [`Monthly budget${fees && fees.on ? ' (including platform fees)' : ''}`, F.gbp(p.budget)],
        [`Indeed Premium${hb.premiumFee > 0 ? ` (media ${F.gbp(hb.premiumMedia)} + fee ${F.gbp(hb.premiumFee, 2)})` : ''}`, '- ' + F.gbp(hb.premium, hb.premiumFee > 0 ? 2 : 0)],
        ['Combined Activity reserve', '- ' + F.gbp(hb.combined)],
      ];
      if (hb.oneRac > 0) money.push(['OneRAC hold-back', '- ' + F.gbp(hb.oneRac)]);
      money.push(['Deployable budget', F.gbp(p.deployable)]);
      money.push(['Placed in the plan', F.gbp(p.placed)]);
      money.push(['Budget the plan could not place efficiently', F.gbp(p.unplaced.total)]);
      if (fees && fees.on) money.push([`Platform fees in the plan (Indeed ${F.pct(fees.rates.indeed, 2)}, Meta ${F.pct(fees.rates.meta, 2)}, Google ${F.pct(fees.rates.google, 2)})`, F.gbp(fees.total, 2)]);
      money.forEach(([a, b], i) => {
        font(8.5, i === 3 + (hb.oneRac > 0 ? 1 : 0) ? 'bold' : 'normal', INK);
        T(a, M, y); T(b, M + colW, y, { align: 'right' });
        y += 5;
      });
      const leftEnd = y;
      // Right: the results.
      y = top;
      const x = M + colW + 10;
      font(10, 'bold', NAVY); T('Predicted results', x, y); y += 5;
      const target = p.hireTarget > 0 ? (p.otherSourcesMeetTarget ? 'met by other sources alone'
        : p.unreachable ? `out of reach within the spending caps: at most ${F.num(p.maxAchievable)} hires, reached at ${F.gbp(p.saturationBudget)}`
          : `${F.gbp(p.budgetForTarget)}`) : 'no hire target set';
      const res = [
        ['Predicted hires', `${F.num(t.allHires)}`, `range ${range(r.allHires.low, r.allHires.high)}`],
        ['  from paid media', `${F.num(t.hires)}`, `range ${range(r.hires.low, r.hires.high)}`],
        ['  expected from other sources', `${F.num(t.otherHires)}`, `range ${range(r.otherHires.low, r.otherHires.high)}`],
        ['Predicted applications', F.int(t.apps), `range ${range(r.apps.low, r.apps.high)}`],
        ['Quality applications', F.int(t.passed), ''],
        ['Cost per application (paid media)', F.gbp(t.cpa, 2), ''],
        ['Cost per hire (paid media)', F.gbp(t.cph), ''],
        [p.hireTarget > 0 ? `Budget for ${p.hireTarget} hires` : 'Budget for the target', target, ''],
      ];
      res.forEach(([a, b, c]) => {
        font(8.5, a.startsWith('  ') ? 'normal' : 'bold', INK); T(a.trim(), x + (a.startsWith('  ') ? 4 : 0), y);
        const bl = wrap(b, colW - 70);
        font(8.5, 'normal', INK); T(bl[0], x + colW - 38, y, { align: 'right' });
        if (bl[1]) { y += 4; T(bl.slice(1).join(' '), x + colW - 38, y, { align: 'right' }); }
        font(7.5, 'normal', MUTED); T(c, x + colW, y, { align: 'right' });
        y += 5;
      });
      y = Math.max(leftEnd, y) + 3;

      if (p.reach) {
        heading('What the spending caps allow');
        para(`The hire target could not be reached within the spending caps at a ${F.pct(p.capMultiple)} cap multiple. Spend above ${F.gbp(p.reach.saturationBudget)} would add no hires, because every location and platform would be at its cap. The same plan at other cap multiples:`);
        table([
          { label: 'Cap multiple', w: 40 }, { label: `Hires at ${F.gbp(p.budget)}`, w: 40, align: 'right' },
          { label: 'Budget not placed', w: 40, align: 'right' }, { label: `Budget for ${p.hireTarget} hires`, w: 50, align: 'right' },
          { label: 'Most hires (budget where they stop rising)', w: 70, align: 'right' },
        ], p.reach.byMultiple.map(m => ({ cells: [
          `${F.pct(m.multiple)}${m.current ? ' (this plan)' : ''}`, F.num(m.hiresAtBudget), F.gbp(m.unplacedAtBudget),
          m.budgetForTarget ? F.gbp(m.budgetForTarget) : 'out of reach',
          m.budgetForTarget ? '-' : `${F.num(m.mostHires)} (${F.gbp(m.saturationBudget)})`,
        ] })));
      }

      heading('Assumptions and risks');
      const s = Object.fromEntries(p.settings.map(z => [z.key, z]));
      const ca = RAC.text.costAdjustment(p);
      const src = (z) => (z.changed ? `set for this plan; default ${z.unit === 'share' ? F.pct(z.default) : z.unit === 'multiple' && z.key === 'capMultiple' ? F.pct(z.default) : z.default}` : z.source);
      const lines = [
        `Spend above past levels: ${F.gbp(p.aboveLargestSuccessful.total)} (${F.pct(p.aboveLargestSuccessful.share)} of placed spend) sits above each location and platform's largest successful month, and ${F.gbp(p.aboveLargestMonth.total)} (${F.pct(p.aboveLargestMonth.share)}) above its largest month of any kind. Predictions for that spend rest on the rate at which cost per application rises with spend.`,
        `Spending cap multiple: ${F.pct(s.capMultiple.value)} (${src(s.capMultiple)}). The plan never spends above a cap.`,
        `Remaining-error adjustment: ${s.remainingError.value.toFixed(3)} (${src(s.remainingError)}; testing gave ${s.remainingError.tested !== null && s.remainingError.tested !== undefined ? s.remainingError.tested.toFixed(3) : 'n/a'}).`,
        ...(ca.extra ? [`Cost adjustment: planned cost per application is multiplied by ${ca.used.toFixed(3)} (${ca.basis}).`] : []),
        `Expected hires from other sources: ${F.num(s.otherHiresMonthly.value)} a month (${src(s.otherHiresMonthly)}), ${F.pct(s.otherHiresShare.value)} of them credited to paid media (${src(s.otherHiresShare)}).`,
        `Months used: ${p.windowMonths.length ? `${F.month(p.windowMonths[0])} to ${F.month(p.windowMonths[p.windowMonths.length - 1])}` : 'none'}.${p.settlingUsed.length ? ` Not yet settled, figures may change: ${p.settlingUsed.map(m => F.month(m.month)).join(', ')}.` : ''}`,
        fees && fees.on ? `Platform fees: Indeed ${F.pct(fees.rates.indeed, 2)}, Meta ${F.pct(fees.rates.meta, 2)} and Google ${F.pct(fees.rates.google, 2)} of media spend (Appcast none), inside the budget (${F.gbp(fees.total, 2)} in this plan). Forecasts use media spend.`
          : 'Platform fees: none in this plan (fees apply to plans from ' + F.month(fees ? fees.firstMonth : '') + ').',
        'Attribution: quality and hire rates came from RAC’s applicant tracking data, which credited each application to the last source used; Meta and Google rates were moved towards the role average (see Method).',
        ...limitLines(p, F),
        ...p.minimumShortfalls.map(x => x.text + '.'),
      ];
      const lowCells = p.locations.flatMap(l => P().map(q => l.cells[q])).filter(c => c.range && c.range.hires && c.range.hires.lowConfidence).length;
      if (lowCells) lines.push(`${lowCells} location and platform ${lowCells === 1 ? 'row is' : 'rows are'} marked low confidence (little evidence behind the hire rate or the cost per application).`);
      const flagged = p.locations.flatMap(l => P().map(q => l.cells[q])).filter(c => c.spend > 0 && c.ceilingFlagged);
      if (flagged.length) lines.push(`No successful month, so capped at the usual monthly spend: ${flagged.map(c => `${c.region} ${L()[c.platform]}`).join(', ')}.`);
      lines.forEach(l => { font(8.3, 'normal', INK); const w = wrap(l, PAGE_W - 2 * M - 5); ensure(w.length * 3.8 + 1); T('•', M, y); w.forEach(ln => { T(ln, M + 4, y); y += 3.8; }); y += 1; });
    }

    function locations(d, title) {
      const p = d.plan;
      page(title, `${d.roleName} · by location · ${monthLabel}`);
      const cols = [
        { label: 'Location', w: 34 }, { label: 'Open roles', w: 16, align: 'right' }, { label: 'Spend', w: 22, align: 'right' },
        { label: 'Spending room (caps and limits)', w: 28, align: 'right' },
        { label: 'Applications (range)', w: 34, align: 'right' }, { label: 'Quality applications', w: 18, align: 'right' },
        { label: 'Hires, paid media (range)', w: 30, align: 'right' }, { label: 'Cost per application', w: 20, align: 'right' },
        { label: 'Cost per hire', w: 20, align: 'right' }, { label: 'Notes', w: 47 },
      ];
      const body = p.locations.map(l => {
        const note = [];
        if (l.capReason === 'location set to no spend') note.push('set to no spend');
        else if (l.spend >= l.cap - 1 && l.cap < Infinity) note.push('at ' + l.capReason);
        if (l.range && l.range.hires && l.range.hires.lowConfidence) note.push('low confidence');
        const sf = p.minimumShortfalls.find(x => x.kind === 'location' && x.region === l.region);
        if (sf) note.push(`minimum short by ${F.gbp(sf.short)}`);
        return {
          label: l.region, spend: l.spend, cph: l.spend > 0 && l.hires > 0 ? F.gbp(l.spend / l.hires) : '-', warn: note.length > 0,
          cells: [l.region, F.int(l.vacancies), F.gbp(l.spend), isFinite(l.cap) ? F.gbp(l.cap) : 'no limit',
            [F.int(l.apps), appRange(l.range)], F.int(l.passed), [F.num(l.hires), hireRange(l.range)],
            l.spend > 0 && l.apps > 0 ? F.gbp(l.spend / l.apps, 2) : '-', l.spend > 0 && l.hires > 0 ? F.gbp(l.spend / l.hires) : '-', note.join('; ')],
        };
      });
      const t = p.totals;
      body.push({ total: true, label: 'Total', spend: t.spend, cph: F.gbp(t.cph), cells: ['Total', F.int(p.totalVac), F.gbp(t.spend), '',
        [F.int(t.apps), range(t.range.apps.low, t.range.apps.high)], F.int(t.passed), [F.num(t.hires), range(t.range.hires.low, t.range.hires.high)],
        F.gbp(t.cpa, 2), F.gbp(t.cph), `plus ${F.num(t.otherHires)} expected from other sources`] });
      table(cols, body, { rowCheck: r => ({ label: r.label, spend: r.spend, cph: r.cph }) });
      font(7.5, 'normal', MUTED);
      para(`Budget is shared between locations by open roles, within location maximums, spending caps and any cost limits. ${RAC.text.ROW_RANGE_LINE} Hires here are paid media only.`, M, PAGE_W - 2 * M, 7.5);
    }

    function platforms(d, title) {
      const p = d.plan;
      page(title, `${d.roleName} · by platform · ${monthLabel}`);
      const on = p.fees && p.fees.on;
      const cols = [
        { label: 'Platform', w: 24 }, { label: 'Spend', w: 22, align: 'right' },
        { label: 'Media', w: 22, align: 'right' }, { label: 'Platform fee', w: 20, align: 'right' },
        { label: 'Applications (range)', w: 30, align: 'right' }, { label: 'Quality applications', w: 18, align: 'right' },
        { label: 'Quality rate used (basis)', w: 60 },
        { label: 'Hires, paid media (range)', w: 29, align: 'right' }, { label: 'Cost per application', w: 22, align: 'right' },
        { label: 'Cost per hire', w: 22, align: 'right' },
      ];
      const body = P().map(q => {
        const x = p.platforms[q], rp = p.rates.platform[q];
        return {
          label: L()[q], spend: x.spend, cph: x.spend > 0 && x.hires > 0 ? F.gbp(x.spend / x.hires) : '-',
          cells: [L()[q], F.gbp(x.spend), F.gbp(x.media), on && p.fees.rates[q] > 0 ? F.gbp(x.fee, 2) : '-',
            [F.int(x.apps), appRange(x.range)], F.int(x.passed), [F.pct(rp.used, 1), rp.basis],
            [F.num(x.hires), hireRange(x.range)], x.spend > 0 && x.apps > 0 ? F.gbp(x.spend / x.apps, 2) : '-',
            x.spend > 0 && x.hires > 0 ? F.gbp(x.spend / x.hires) : '-'],
        };
      });
      const t = p.totals;
      body.push({ total: true, label: 'Total', spend: t.spend, cph: F.gbp(t.cph), cells: ['Total', F.gbp(t.spend), F.gbp(t.media), on ? F.gbp(t.fee, 2) : '-',
        [F.int(t.apps), range(t.range.apps.low, t.range.apps.high)], F.int(t.passed), `role average ${F.pct(p.rates.roleScreen, 1)}`,
        [F.num(t.hires), range(t.range.hires.low, t.range.hires.high)], F.gbp(t.cpa, 2), F.gbp(t.cph)] });
      table(cols, body, { rowCheck: r => ({ label: r.label, spend: r.spend, cph: r.cph }) });
      para(`Within each location, money goes where the next hire costs least, up to each platform's spending cap. Hire rate after quality: ${F.pct(p.rates.roleHire, 1)}, the role average for every location. ${RAC.text.ATTRIBUTION}`, M, PAGE_W - 2 * M, 7.5);
    }

    function cells(d, title) {
      const p = d.plan;
      P().forEach(q => {
        page(title, `${d.roleName} · ${L()[q]} by location · ${monthLabel}`);
        const fee = p.fees && p.fees.on ? p.fees.rates[q] : 0;
        const cols = [
          { label: 'Location', w: 27 }, { label: 'Spend', w: 19, align: 'right' },
          { label: fee > 0 ? 'of which fee' : 'Platform fee', w: 15, align: 'right' },
          { label: 'Spending cap (basis)', w: 24, align: 'right' },
          { label: 'Historic cost per application', w: 21, align: 'right' },
          { label: 'Thin-data adjustment', w: 16, align: 'right' }, { label: 'Spend-level adjustment', w: 16, align: 'right' },
          { label: RAC.text.costAdjustment(p).label, w: 17, align: 'right' }, { label: 'Planned cost per application', w: 19, align: 'right' },
          { label: 'Applications (range)', w: 25, align: 'right' },
          { label: 'Quality rate', w: 16, align: 'right' }, { label: 'Hire rate after quality', w: 16, align: 'right' },
          { label: 'Hires (range)', w: 21, align: 'right' }, { label: 'Cost per hire', w: 17, align: 'right' },
        ];
        const body = p.locations.map(l => {
          const c = l.cells[q];
          const funded = c.spend > 0.005;
          const capBasis = `${c.ceilingFlagged ? 'usual month' : 'largest'} ${F.gbp(c.ceilingBase)} x${p.capMultiple}`;
          const cph = funded && c.hires > 0 ? F.gbp(c.spend / c.hires) : '-';
          return {
            label: `${l.region} ${L()[q]}`, spend: c.spend, cph,
            cells: [
              l.region, c.on ? F.gbp(c.spend) : 'off', fee > 0 && funded ? F.gbp(c.fee, 2) : '-',
              [F.gbp(c.cap), c.cpaLimitSpend !== null && c.cpaLimitSpend < c.ceilingTotal ? 'cost limit' : capBasis],
              [c.historicCpa !== null ? F.gbp(c.historicCpa, 2) : 'no data', c.historicCpa !== null ? `${F.int(c.historicApps)} applications` : `platform ${F.gbp(c.platformCpa, 2)}`],
              c.thinAdjustment !== null ? x2(c.thinAdjustment) : 'platform', funded ? x2(c.spendAdjustment) : '-', x2(c.remainingError, 3),
              funded ? F.gbp(c.plannedCpa, 2) : '-',
              funded ? [F.num(c.apps), appRange(c.range)] : '-',
              [F.pct(c.screenRate, 1), c.screenAdjustment !== 1 ? `location x${c.screenAdjustment.toFixed(2)}` : ''],
              F.pct(c.hireAfterScreening, 1),
              funded ? [F.num(c.hires), hireRange(c.range) + (c.range && c.range.hires && c.range.hires.lowConfidence ? ' low conf.' : '')] : '-',
              cph,
            ],
          };
        });
        const x = p.platforms[q];
        body.push({ total: true, label: `Total ${L()[q]}`, spend: x.spend, cph: x.spend > 0 && x.hires > 0 ? F.gbp(x.spend / x.hires) : '-',
          cells: ['Total', F.gbp(x.spend), fee > 0 ? F.gbp(x.fee, 2) : '-', '', '', '', '', '', x.apps > 0 ? F.gbp(x.spend / x.apps, 2) : '-',
            [F.num(x.apps), appRange(x.range)], '', '', [F.num(x.hires), hireRange(x.range)], x.spend > 0 && x.hires > 0 ? F.gbp(x.spend / x.hires) : '-'] });
        table(cols, body, { rowCheck: r => ({ label: r.label, spend: r.spend, cph: r.cph }) });
        para(`Planned cost per application = historic cost per application x thin-data adjustment x spend-level adjustment x remaining-error adjustment${fee > 0 ? ` x ${(1 + fee).toFixed(4)} (the ${L()[q]} fee)` : ''}. ` +
          `The quality rate for ${L()[q]} was ${p.rates.platform[q].basis}. Spending caps: largest successful month since ${F.month(RAC.assumptions.get(p.A, 'ceiling_first_month'))} x the cap multiple${fee > 0 ? ', plus the fee' : ''}.`, M, PAGE_W - 2 * M, 7.2);
      });
    }

    function method(d, title) {
      page(title, `${d.roleName} · method and glossary · ${monthLabel}`);
      const colW = (PAGE_W - 2 * M - 8) / 2;
      const cols = [M, M + colW + 8];
      let col = 0;
      const top = y;
      const flow = (s, size, style, color, gap) => {
        font(size, style, color);
        wrap(s, colW).forEach(line => {
          if (y + size * 0.42 > BOTTOM) {
            if (col === 0) { col = 1; y = top; }
            else { pdf.addPage(); header(pageTitle + ' (continued)', pageSub); col = 0; }
          }
          T(line, cols[col], y); y += size * 0.42;
        });
        y += gap;
      };
      RAC.text.method(d.plan.A, d.role, d.plan, opts.backtest).forEach(sec => {
        flow(sec.heading, 9.5, 'bold', NAVY, 1);
        sec.paras.forEach(p => flow(p, 7.6, 'normal', INK, 1.6));
        y += 1;
      });
      flow('Glossary', 9.5, 'bold', NAVY, 1);
      RAC.text.glossary(d.plan.A, d.role, d.plan).forEach(g => flow(`${g.term}: ${g.text}`, 7.6, 'normal', INK, 1.2));
    }

    docs.forEach(d => {
      const title = titleOf(d, monthLabel);
      if (notes) commentary(d);
      summary(d, title);
      locations(d, title);
      platforms(d, title);
      cells(d, title);
      method(d, title);
    });

    // Footers, now the page count is known.
    const n = pdf.getNumberOfPages();
    stampLine = docs.map(d => RAC.stamp.line(d.plan, opts.code)).join(' | ');
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i);
      pdf.setDrawColor(...LINE); pdf.line(M, 200, PAGE_W - M, 200);
      font(6.3, 'normal', MUTED);
      T(stampLine, M, 204);
      T(`RAC ${monthLabel} plan · Enhance Media · Page ${i} of ${n}`, PAGE_W - M, 204, { align: 'right' });
    }

    const problems = [
      ...RAC.outputChecks.text(texts.join('\n')),
      ...RAC.outputChecks.pdfRows(rows),
      ...titles.flatMap(t => RAC.outputChecks.title(t.title, t.plan)),
    ];
    return { pdf, texts, rows, titles, problems, pages: n };
  }

  function fileName(docs, opts) {
    const month = (opts.monthLabel || '').replace(/\s+/g, '_');
    const roles = docs.map(d => d.role).join('_');
    return `RAC_${month}_${roles}_Plan${opts.notes === false ? '_No_Notes' : ''}.pdf`;
  }

  function save(jsPDF, docs, opts = {}) {
    const out = build(jsPDF, docs, opts);
    if (out.problems.length) throw new Error('The PDF failed its checks, so it was not saved:\n' + out.problems.join('\n'));
    const name = fileName(docs, opts);
    out.pdf.save(name);
    return name;
  }

  RAC.pdf = { build, save, fileName, titleOf };
})(window.RAC = window.RAC || {});
