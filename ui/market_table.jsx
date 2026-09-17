// The market data table on Setup (D2): what the advertising market and
// candidate interest were doing each month, beside the remaining-error
// adjustment. Loaded by index.html as a Babel script before the app; exposed
// as window.RACUI.MarketTable.
//
// It is a guide, not part of the model. Nothing here changes a plan's figures,
// and none of it goes into the PDF, the workings export or the Method text
// (addendum 2.5). It answers the question the adjustment raises: when the model
// missed, was the market moving?
//
// Cost is an index: each month as a percentage of that platform's average over
// the whole period, so 100 is an average month. The repository is public, so
// RAC's own prices are not written into it (data/market.json).
(function () {
  const { useState, useEffect } = React;
  const RACUI = (window.RACUI = window.RACUI || {});

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const label = (mo) => `${MONTHS[Number(mo.slice(5, 7)) - 1].slice(0, 3)} ${mo.slice(2, 4)}`;

  // A short bar, so a column of numbers reads as a shape.
  function Bar({ value, mid = 100, max = 200, colour }) {
    if (value === null || value === undefined) return <span className="help-text">-</span>;
    const w = Math.max(2, Math.min(100, (value / max) * 100));
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span className="mono" style={{ width: 42, textAlign: 'right' }}>{value.toFixed(0)}</span>
        <span style={{ flex: 1, height: 7, background: '#EEF1F6', borderRadius: 4, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w + '%', background: colour, borderRadius: 4 }} />
          <span style={{ position: 'absolute', left: (mid / max) * 100 + '%', top: -2, bottom: -2, width: 1, background: '#9AA5B5' }} />
        </span>
      </span>
    );
  }

  function MarketTable({ months = 14 }) {
    const [data, setData] = useState(null);
    useEffect(() => {
      let live = true;
      fetch('data/market.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('status ' + r.status))))
        .then(j => { if (live) setData(j); })
        .catch(() => { if (live) setData({ error: true }); });
      return () => { live = false; };
    }, []);
    if (!data) return <div className="help-text">Reading the market data...</div>;
    if (data.error) return <div className="help-text">The market data file could not be read, so this guide is empty. It changes nothing about the plan.</div>;
    const rows = data.months.slice(-months);
    const terms = (data.sources.trends.terms || []);
    return (
      <div data-panel="market">
        <div className="help-text" style={{ marginBottom: 10 }}>
          A guide, not part of the plan. Cost is an index: each month against that platform&rsquo;s own average over
          {' '}{data.months.length} months, so 100 is an average month and 120 is a fifth dearer than usual. Search interest is
          Google Trends, where 100 is the busiest month it holds. Nothing here goes into the PDF or the workings.
        </div>
        <table className="alloc-table" style={{ maxWidth: 920 }}>
          <thead><tr>
            <th>Month</th>
            <th>Google cost per click</th>
            <th>Google cost per thousand</th>
            <th>Meta cost per click</th>
            <th>Meta cost per thousand</th>
            {terms.map(t => <th key={t}>Searches: {t}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.month}>
                <td className="mono">{label(r.month)}</td>
                <td><Bar value={r.google && r.google.cpc_index} colour="#2563EB" /></td>
                <td><Bar value={r.google && r.google.cpm_index} colour="#60A5FA" /></td>
                <td><Bar value={r.meta && r.meta.cpc_index} colour="#F28C28" /></td>
                <td><Bar value={r.meta && r.meta.cpm_index} colour="#F6BE83" /></td>
                {terms.map(t => (
                  <td key={t}><Bar value={r.searches ? r.searches[t] : null} mid={50} max={100} colour="#16864E" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="help-text" style={{ marginTop: 10 }}>
          From {data.sources.ads.file} ({data.sources.ads.file_date}) and {data.sources.trends.file} ({data.sources.trends.file_date}),
          the campaigns the planner plans only. The Indeed Hiring Lab series is not here: its access terms have not been
          checked. Whatever happens, no Hiring Lab figure may appear in anything RAC sees, and the output checks refuse
          to save a document that even names it.
        </div>
      </div>
    );
  }

  RACUI.MarketTable = MarketTable;
})();
