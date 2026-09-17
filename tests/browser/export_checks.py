"""Browser checks for the exports, on the test link address, reading the files
the app actually saves.

1. PDF: the header PDF button saves a PDF whose text (read with pypdf) holds
   the planner's figures for the same settings, the title with the hire
   target, the version stamp on every page, and no em-dashes or Hiring Lab.
2. "PDF, no notes" saves the same document without the notes pages.
3. No page errors, no alerts, nothing written, every request handled.

Run from the repo folder:  python tests/browser/export_checks.py  [--libs DIR]
Files are written to tests/browser/out/."""
import copy, io, json, os, re, sys
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
sys.path.insert(0, os.path.dirname(__file__))
from guard import TEST, new_page, libs_arg, VERSION_COMMIT
from app_fixture import DB, EXPECTED_JS

OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = libs_arg(sys.argv)

# The figures the PDF must show, formatted as the PDF formats them.
FIGURES_JS = EXPECTED_JS.replace(
    "  return { apps: plan.totals.apps,",
    """  const F = RAC.text.fmt;
  const figs = [F.gbp(plan.budget), F.gbp(plan.deployable), F.gbp(plan.placed), F.gbp(plan.unplaced.total),
    F.num(plan.totals.allHires), F.num(plan.totals.hires), F.int(plan.totals.apps), F.int(plan.totals.passed)];
  if (plan.fees.on) figs.push(F.gbp(plan.fees.total, 2));
  plan.locations.forEach(l => { figs.push(F.gbp(l.spend)); RAC.PLATFORMS.forEach(p => { if (l.cells[p].spend > 0) figs.push(F.gbp(l.cells[p].plannedCpa, 2)); }); });
  RAC.PLATFORMS.forEach(p => figs.push(F.gbp(plan.platforms[p].media)));
  const title = RAC.pdf.titleOf({ plan, roleName: role + ' (' + { SMR: 'Mobile Vehicle Tech', Patrol: 'Roadside Tech (incl. SuperFlex)' }[role] + ')' }, 'October 2026');
  return { figs, title, headings: RAC.text.method(plan.A, role, plan, RAC.app.state.backtest).map(s => s.heading),
    apps: plan.totals.apps,""")

squash = lambda t: re.sub(r'\s+', '', t)


def read_pdf(path):
    r = PdfReader(path)
    return [p.extract_text() or '' for p in r.pages]


def save_pdf(page, label, name):
    with page.expect_download(timeout=60000) as dl:
        page.locator('.app-header button', has_text=re.compile('^' + re.escape(label) + '$')).click()
    path = os.path.join(OUT, name)
    dl.value.save_as(path)
    return dl.value.suggested_filename, path


fails, notes = [], []
db = copy.deepcopy(DB)
w = db['workspace']['months']['2026-10']['working']
w['commentary'] = {'SMR': '- London is off this month.\n- Scotland is held at £2,500.', 'Patrol': ''}
w['commentaryLegacy'] = {'SMR': '', 'Patrol': ''}

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx, page, guard, errors = new_page(browser, TEST, db=db, libs=LIBS)
    dialogs = []
    page.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    page.goto(TEST + '#planner/plan')
    page.wait_for_selector('.kpi-label:has-text("Predicted applications")', timeout=60000)
    want = page.evaluate(FIGURES_JS, 'SMR')

    name, path = save_pdf(page, 'PDF', 'plan_smr.pdf')
    pages = read_pdf(path)
    text = '\n'.join(pages)
    flat = squash(text)
    notes.append(f'PDF saved as {name}: {len(pages)} pages')
    if name != 'RAC_October_2026_SMR_Plan.pdf':
        fails.append('PDF file name ' + name)
    if squash(want['title']) not in flat:
        fails.append(f"title {want['title']!r} not in the PDF")
    missing = [x for x in want['figs'] if squash(x) not in flat]
    if missing:
        fails.append(f'PDF lacks planner figures: {missing[:6]}')
    notes.append(f"{len(want['figs']) - len(missing)} of {len(want['figs'])} planner figures found; title {want['title']!r}")
    for i, p in enumerate(pages):
        if 'Code' + VERSION_COMMIT[:7] not in squash(p):
            fails.append(f'page {i + 1} has no version stamp')
        if f'Page{i + 1}of{len(pages)}' not in squash(p):
            fails.append(f'page {i + 1} has no page number')
    if '—' in text or re.search(r'hiring\s*lab', text, re.I):
        fails.append('PDF text fails the output checks')
    missing_h = [h for h in want['headings'] if squash(h) not in flat]
    if missing_h:
        fails.append(f'method headings missing: {missing_h}')
    if 'Notesonthisplan' not in squash(pages[0]) or 'LondonisoffthismonthSX'.replace('SX', '') not in squash(pages[0]).replace('.', ''):
        fails.append('first page is not the notes page: ' + pages[0][:120])

    name2, path2 = save_pdf(page, 'PDF, no notes', 'plan_smr_no_notes.pdf')
    pages2 = read_pdf(path2)
    notes.append(f'"PDF, no notes" saved as {name2}: {len(pages2)} pages')
    if len(pages) - len(pages2) != 1 or any('Notesonthisplan' in squash(p) for p in pages2):
        fails.append(f'no-notes PDF: {len(pages2)} pages against {len(pages)}')
    if name2 != 'RAC_October_2026_SMR_Plan_No_Notes.pdf':
        fails.append('no-notes file name ' + name2)

    if dialogs:
        fails.append(f'alerts shown: {dialogs[:2]}')
    if errors:
        fails.append(f'page errors: {errors[:3]}')
    if guard.writes or guard.blocked:
        fails.append(f'writes {guard.writes[:3]}, blocked {guard.blocked[:3]}')
    if 'version' not in guard.served:
        fails.append('the app did not ask for the code version')
    ctx.close()
    browser.close()

for n in notes:
    print('  ' + n)
print('FAIL: ' + '; '.join(fails) if fails else 'PASS: exports hold the planner figures, stamped, checked; nothing written')
