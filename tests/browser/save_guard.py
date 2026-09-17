"""Browser check: the live address saves, a test link does not.

Opens index.html in headless Chromium twice, once as rac-tools.vercel.app and
once as a Vercel test link address, with the database replaced by a stand-in
that records every request. Signs in with a stand-in session, changes a
setting, and waits for the save.

Pass: the live address sends database writes and shows no banner; the test
link sends none, shows the test version banner and shows Not saved.

Network guard: every request is either handled explicitly below (the page,
rac_data.js, the listed library files, fonts, the database stand-in) or
blocked. Nothing else leaves the machine. Any blocked request fails the check,
so the handled list stays complete. Before the save test, each page fires probe
requests (an unknown host and the app's own /api address) and the check fails
unless both were blocked.

Needs Python 3 with playwright (pip install playwright; playwright install chromium).
Run from the repo folder:  python3 tests/browser/save_guard.py
If the machine cannot reach unpkg and cdnjs, pass a folder holding npm installs
of react@18.3.1, react-dom@18.3.1, @babel/standalone@7.25.6, jspdf@2.5.1,
xlsx@0.18.5 and exceljs@4.4.0:  python3 tests/browser/save_guard.py --libs DIR
Screenshots are written to tests/browser/out/."""
import base64, json, os, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
LIBS = sys.argv[sys.argv.index('--libs') + 1] if '--libs' in sys.argv else None
CDN = {
    'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'node_modules/jspdf/dist/jspdf.umd.min.js',
    'https://unpkg.com/@babel/standalone@7.25.6/babel.min.js': 'node_modules/@babel/standalone/babel.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js',
}
SB = 'https://xtyqmqjgvsynoeswtkpv.supabase.co'
LIVE = 'https://rac-tools.vercel.app/'
TEST = 'https://rac-tools-git-c3-build-enhance-media-rac.vercel.app/'
PROBE_HOST = 'https://guard-probe.invalid/probe'

def fake_session():
    b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    tok = b64({'alg': 'none'}) + '.' + b64({'email': 'test.user@enhancemedia.co.uk', 'exp': int(time.time()) + 3600}) + '.x'
    return json.dumps({'access_token': tok, 'refresh_token': 'none'})

def run(browser, url):
    writes, reads, blocked = [], [], []
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def handle(route):
        req = route.request; u = req.url
        if u.startswith(url) and (u.endswith('/') or '#' in u[len(url):] or u[len(url):] == ''):
            return route.fulfill(path=os.path.join(ROOT, 'index.html'), content_type='text/html')
        if u.startswith(url + 'rac_data.js'):
            return route.fulfill(path=os.path.join(ROOT, 'rac_data.js'), content_type='text/javascript')
        if u in CDN and LIBS:
            return route.fulfill(path=os.path.join(LIBS, CDN[u]), content_type='text/javascript')
        if u.startswith(SB):
            if req.method in ('POST', 'PATCH', 'PUT', 'DELETE'):
                writes.append((req.method, u.split('?')[0], (req.post_data or '')[:60]))
                return route.fulfill(status=201, body='')
            reads.append(u.split('?')[0])
            return route.fulfill(status=200, content_type='application/json', body='[]')
        if 'fonts.g' in u:
            return route.fulfill(status=200, body='')
        if u in CDN:
            return route.continue_()   # listed library file, fetched from its CDN
        blocked.append((req.method, u[:120]))
        return route.abort('blockedbyclient')
    page.route('**/*', handle)
    if hasattr(page, 'route_web_socket'):
        page.route_web_socket('**/*', lambda ws: (blocked.append(('WS', ws.url[:120])), ws.close()))
    page.add_init_script(f"localStorage.setItem('rac-session', {json.dumps(fake_session())});")
    page.goto(url)
    page.wait_for_selector('.app-header', timeout=60000)
    page.wait_for_timeout(1500)
    # Guard probe: both requests must be blocked, never sent.
    probe_ok = page.evaluate("""async (urls) => {
      const out = [];
      for (const u of urls) { try { await fetch(u, { method: 'POST', body: 'probe' }); out.push('sent'); } catch (e) { out.push('blocked'); } }
      return out; }""", [PROBE_HOST, url + 'api/windsor-spend?probe=1'])
    probed = [b for b in blocked if 'probe' in b[1]]
    for b in probed: blocked.remove(b)
    # Change a setting: the first editable number box on the Setup tab.
    box = page.locator('input.text-input').first
    box.click(); box.press('End'); box.type('1'); box.press('Tab')
    page.wait_for_timeout(2500)   # saves go 800ms after a change
    banner = page.locator('.test-banner').count()
    sync = page.locator('.sync').first.inner_text()
    page.screenshot(path=os.path.join(OUT, ('live' if url == LIVE else 'test_link') + '.png'))
    ctx.close()
    return {'writes': writes, 'reads': len(reads), 'banner': banner, 'sync': sync, 'errors': errors,
            'blocked': blocked, 'probe': probe_ok == ['blocked', 'blocked'] and len(probed) == 2}

with sync_playwright() as p:
    b = p.chromium.launch()
    live, test = run(b, LIVE), run(b, TEST)
    b.close()

fails = []
if not live['writes']: fails.append('live address sent no database writes')
if live['banner']: fails.append('live address shows the test banner')
if test['writes']: fails.append('test link sent database writes: %s' % test['writes'])
if not test['banner']: fails.append('test link shows no banner')
if test['sync'].strip() != 'Not saved': fails.append('test link save label reads %r' % test['sync'])
for name, r in (('live', live), ('test link', test)):
    print(f"{name}: guard probe {'blocked' if r['probe'] else 'NOT BLOCKED'}, {len(r['blocked'])} other blocked, {len(r['writes'])} writes {sorted(set(w[2][:25] for w in r['writes']))}, {r['reads']} reads, banner {bool(r['banner'])}, label {r['sync']!r}, page errors {len(r['errors'])}")
    if r['errors']: fails.append(f"{name} page errors: {r['errors'][:2]}")
    if not r['probe']: fails.append(f"{name}: network guard probe was not blocked")
    if r['blocked']: fails.append(f"{name}: unhandled requests were blocked, add a handler or remove the call: {r['blocked'][:5]}")
print('FAIL: ' + '; '.join(fails) if fails else 'PASS: live address saves; test link reads but never writes')
sys.exit(1 if fails else 0)
