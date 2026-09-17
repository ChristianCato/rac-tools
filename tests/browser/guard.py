"""Network guard shared by every browser check.

Every request a page makes is either handled here or blocked:
  - the app page (index.html) at the address under test;
  - the app's own files, served from this repo: rac_data.js, assumptions.csv,
    data/*.json, planner/*.js, ui/*.jsx (a check can replace any of them);
  - the listed library files (from a local folder with --libs, otherwise
    fetched from their CDN; nothing else is fetched from the internet);
  - fonts (answered empty);
  - the database, answered by a stand-in: reads return what the check put in
    `db`; writes are recorded and answered 201, never sent.
Anything else is blocked and recorded; checks fail if anything was blocked.
Service workers are blocked; WebSockets are closed and recorded.
"""
import base64, json, os, re, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SB = 'https://xtyqmqjgvsynoeswtkpv.supabase.co'
LIVE = 'https://rac-tools.vercel.app/'
TEST = 'https://rac-tools-git-c3-build-enhance-media-rac.vercel.app/'
PROBE_HOST = 'https://guard-probe.invalid/probe'
CDN = {
    'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'node_modules/jspdf/dist/jspdf.umd.min.js',
    'https://unpkg.com/@babel/standalone@7.25.6/babel.min.js': 'node_modules/@babel/standalone/babel.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js',
}
APP_FILE = re.compile(r'^(rac_data\.js|assumptions\.csv|data/[a-z_]+\.json|planner/[a-z0-9_]+\.js|ui/[a-z0-9_]+\.jsx)$')
TYPES = {'.js': 'text/javascript', '.jsx': 'text/babel', '.json': 'application/json', '.csv': 'text/csv'}


def fake_session(email='test.user@enhancemedia.co.uk'):
    b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    tok = b64({'alg': 'none'}) + '.' + b64({'email': email, 'exp': int(time.time()) + 3600}) + '.x'
    return json.dumps({'access_token': tok, 'refresh_token': 'none'})


class Guard:
    def __init__(self, page, url, db=None, files=None, libs=None):
        self.url, self.db, self.files, self.libs = url, db or {}, files or {}, libs
        self.writes, self.reads, self.blocked, self.served = [], [], [], []
        page.route('**/*', self.handle)
        if hasattr(page, 'route_web_socket'):
            page.route_web_socket('**/*', lambda ws: (self.blocked.append(('WS', ws.url[:120])), ws.close()))

    def handle(self, route):
        req = route.request
        u = req.url
        url = self.url
        if u.startswith(url):
            rest = u[len(url):].split('#')[0]
            path = rest.split('?')[0]
            if path == '':
                return route.fulfill(path=os.path.join(ROOT, 'index.html'), content_type='text/html')
            if APP_FILE.match(path):
                self.served.append(path)
                ctype = TYPES.get(os.path.splitext(path)[1], 'text/plain')
                if path in self.files:
                    return route.fulfill(status=200, body=self.files[path], content_type=ctype)
                full = os.path.join(ROOT, path)
                if os.path.isfile(full):
                    return route.fulfill(path=full, content_type=ctype)
                return route.fulfill(status=404, body='not found')
        if u in CDN:
            if self.libs:
                return route.fulfill(path=os.path.join(self.libs, CDN[u]), content_type='text/javascript')
            return route.continue_()   # listed library file, fetched from its CDN
        if u.startswith(SB):
            if req.method in ('POST', 'PATCH', 'PUT', 'DELETE'):
                self.writes.append((req.method, u.split('?')[0], (req.post_data or '')[:60]))
                return route.fulfill(status=201, body='')
            self.reads.append(u.split('?')[0])
            m = re.search(r'[?&]k=eq\.([^&]+)', u)
            key = m and m.group(1).replace('%3A', ':')
            if key in self.db:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps([{'v': self.db[key]}]))
            return route.fulfill(status=200, content_type='application/json', body='[]')
        if 'fonts.g' in u:
            return route.fulfill(status=200, body='')
        self.blocked.append((req.method, u[:120]))
        return route.abort('blockedbyclient')

    def probe(self, page):
        """Fires requests that must be blocked; True if both were."""
        got = page.evaluate("""async (urls) => {
          const out = [];
          for (const u of urls) { try { await fetch(u, { method: 'POST', body: 'probe' }); out.push('sent'); } catch (e) { out.push('blocked'); } }
          return out; }""", [PROBE_HOST, self.url + 'api/windsor-spend?probe=1'])
        probed = [b for b in self.blocked if 'probe' in b[1]]
        for b in probed:
            self.blocked.remove(b)
        return got == ['blocked', 'blocked'] and len(probed) == 2


def new_page(browser, url, db=None, files=None, libs=None, session=True):
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    guard = Guard(page, url, db, files, libs)
    if session:
        page.add_init_script(f"localStorage.setItem('rac-session', {json.dumps(fake_session())});")
    return ctx, page, guard, errors


def libs_arg(argv):
    return argv[argv.index('--libs') + 1] if '--libs' in argv else None
