"""Builds the archive app: a read-only copy of the app as it was before this
release, for the plans made in it (addendum 2.9).

Plans made before the release were worked out by the previous engine, on the
data as it stood and in the load order the live app happened to use. The new
app cannot reproduce them, and should not try. So a frozen copy of the old app
is kept at archive/index.html, reading a release-day copy of the saved plans and
data under its own database keys.

It is generated, not hand-edited, so what it changes from the old app is a short
list anyone can read:

  1. The title and the heading say it is the archive, and a banner says so on
     every screen.
  2. It never writes. `sbSet` returns before sending anything, so nothing in the
     archive can change the live plans, the live data or anyone's presence.
  3. It reads the release-day copy: workspace, benchmarks and hire_rates come
     from archive:workspace, archive:benchmarks and archive:hire_rates.
  4. It loads the data file as it was at commit 46aaae2, not today's, because
     today's holds months the old app never saw.
  5. It works out its month list before the database answers, which is what the
     live app did by accident of timing. The month list decides the weighting,
     so replaying it deliberately makes the archive give the same figures every
     time (build note 2). The months-cache fix is deliberately NOT applied here
     (build note 1): it would change the figures.
  6. Presence is not read, because nobody is "in" the archive.
  7. The header role buttons call setRoleView instead of setExportRole (user
     decision, 18 September 2026). At 46aaae2 they called setExportRole, which
     was never declared, so they threw and did nothing, and the header Workings
     and PDF buttons could only export the role already showing. This is the
     same one-word fix the app author made on main (aa01c14). It changes which
     role is showing, never how any figure is worked out.

Nothing else is touched: the engine, the exports and every screen are the code
that produced those plans.

Run from the repo folder:
    python tools/build_archive.py            writes archive/index.html
    python tools/build_archive.py --check    confirms it matches, writes nothing
"""
import os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCE = os.path.join(ROOT, 'tests', 'legacy', 'index_46aaae2.html')
TARGET = os.path.join(ROOT, 'archive', 'index.html')
BANNER = 'Archive: pre-release plans, read-only'

EDITS = [
    (
        'the title says it is the archive',
        '<title>RAC Tool Suite</title>',
        '<title>RAC Tool Suite: archive (read-only)</title>',
    ),
    (
        'the data file is the one this app was built on',
        '<script src="rac_data.js"></script>',
        '<!-- The archive reads the data file as it was at commit 46aaae2. -->\n'
        '<script src="../planner/legacy_rac_data_46aaae2.js"></script>',
    ),
    (
        'nothing is ever written',
        """async function sbSet(key, value) {
  const r = await sbFetch(SB_URL + '?on_conflict=k', {""",
        """async function sbSet(key, value) {
  // ARCHIVE: read-only. Nothing here may change the live plans, the live data
  // or anyone's presence, so every write stops at this line.
  if (ARCHIVE) return false;
  const r = await sbFetch(SB_URL + '?on_conflict=k', {""",
    ),
    (
        'reads come from the release-day copy',
        """async function sbGet(key) {
  const r = await sbFetch(SB_URL + '?k=eq.' + encodeURIComponent(key) + '&select=v');""",
        """// ARCHIVE: the release-day copy of the saved plans and data, under its own
// keys, taken before the new release could write anything.
const ARCHIVE = true;
const ARCHIVE_KEYS = { workspace: 'archive:workspace', benchmarks: 'archive:benchmarks', hire_rates: 'archive:hire_rates' };

async function sbGet(key) {
  const k = ARCHIVE && ARCHIVE_KEYS[key] ? ARCHIVE_KEYS[key] : key;
  const r = await sbFetch(SB_URL + '?k=eq.' + encodeURIComponent(k) + '&select=v');""",
    ),
    (
        'nobody is in the archive, so presence is not read',
        """async function sbPresenceList() {
  try {""",
        """async function sbPresenceList() {
  if (ARCHIVE) return [];   // nobody is "in" the archive
  try {""",
    ),
    (
        'the month list is worked out before the database answers',
        """const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Root />);""",
        """// ARCHIVE: the month list is worked out now, from the data file alone, and
// kept. The live app did this by accident of timing: it had already worked out
// its months before the database answered, so months held only in the database
// carried no weight. The weighting decides the figures, so the archive replays
// that deliberately rather than depending on which answer arrives first.
dataMonths();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Root />);""",
    ),
    (
        'the header role buttons switch role',
        '                  onClick={() => setExportRole(r)}>{r}</button>',
        '                  onClick={() => setRoleView(r)}>{r}</button>',
    ),
    (
        'the heading says it is the archive',
        '          <h1>RAC Tool Suite</h1>',
        '          <h1>RAC Tool Suite: archive</h1>',
    ),
    (
        'a banner on every screen',
        """  return (
    <div className="app">
      <div className="app-header">""",
        """  return (
    <div className="app">
      <div data-panel="archive-banner" style={{
        background: '#5B3A00', color: '#FFE9C7', padding: '7px 16px', fontSize: 12.5, fontWeight: 600,
        letterSpacing: '0.01em', borderBottom: '1px solid #7A5210' }}>
        %s. These are the plans as they were before the new planning calculations went live, worked out by the
        previous engine on the data it had. Nothing here can be changed or saved. New plans are in the live app.
      </div>
      <div className="app-header">""" % BANNER,
    ),
]


def build(text):
    for what, old, new in EDITS:
        if text.count(old) != 1:
            raise SystemExit(f'STOPPED: "{what}": found {text.count(old)} places to change, expected 1.\n'
                             'The frozen copy of the old app has changed, or these edits no longer fit it.')
        text = text.replace(old, new, 1)
    return text


def main(argv):
    with open(SOURCE, encoding='utf-8', newline='') as f:
        source = f.read()
    out = build(source)
    if '--check' in argv:
        if not os.path.isfile(TARGET):
            print('CHECK FAILED: archive/index.html is missing; run python tools/build_archive.py')
            return 1
        with open(TARGET, encoding='utf-8', newline='') as f:
            held = f.read()
        same = held == out
        print('CHECK: archive/index.html is what this script builds' if same
              else 'CHECK FAILED: archive/index.html is not what this script builds; run python tools/build_archive.py')
        return 0 if same else 1
    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    with open(TARGET, 'w', encoding='utf-8', newline='') as f:
        f.write(out)
    print(f'Wrote {TARGET}: the app at commit 46aaae2 with {len(EDITS)} changes '
          f'({", ".join(w for w, _, _ in EDITS)}).')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
