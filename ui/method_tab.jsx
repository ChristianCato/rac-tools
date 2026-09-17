// The Method tab: how the plan is worked out, from exports/text.js (the same
// words the PDF prints), with the values of the plan on screen. Loaded by
// index.html as a Babel script before the app; exposed as
// window.RACUI.MethodTab.
(function () {
  const RACUI = (window.RACUI = window.RACUI || {});

  function MethodTab({ plan, role, roles, setRoleView, roleFull }) {
    const v2 = plan && plan.v2;
    const RAC = window.RAC;
    if (!v2) return null;
    const A = v2.A;   // the assumption values this plan used, overrides included
    const sections = RAC.text.method(A, role, v2, RAC.app.state.backtest);
    const terms = RAC.text.glossary(A, role, v2);
    return (
      <div data-panel="method">
        <div className="dial-row" style={{ marginBottom: 14 }}>
          <div className="role-switch">
            {roles.map(r => (
              <button key={r} className={r === role ? 'active' : ''} onClick={() => setRoleView(r)}>{r}</button>
            ))}
          </div>
          <span className="help-text">{roleFull[role]} &middot; the figures below are this plan&rsquo;s; the PDF prints the same text</span>
        </div>
        <div className="banner banner-info">
          <div className="banner-icon">i</div>
          <div>How the plan is worked out, in the order it happens. Every setting and its tested figure is listed in assumptions.csv.</div>
        </div>
        {sections.map(sec => (
          <div className="card" key={sec.heading}>
            <div className="card-head"><div className="card-title">{sec.heading}</div></div>
            <div className="card-body method-body">
              {sec.paras.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
        ))}
        <div className="card">
          <div className="card-head"><div className="card-title">Glossary</div></div>
          <div className="card-body method-body">
            {terms.map(t => <p key={t.term}><strong>{t.term}.</strong> {t.text}</p>)}
          </div>
        </div>
        <p className="help-text" data-field="stamp">{RAC.stamp.line(v2)}</p>
      </div>
    );
  }

  RACUI.MethodTab = MethodTab;
})();
