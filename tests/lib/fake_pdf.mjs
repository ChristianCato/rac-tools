// A stand-in for jsPDF in the Node checks: it records every string and where
// it went, wraps text at a rough character width, and never draws. The real
// PDF is checked in the browser (tests/browser/export_checks.py).
export class FakePDF {
  constructor() { this.pages = [[]]; this.cur = 0; this.size = 10; this.saved = null; }
  text(s, x, y, o) {
    if (x < 0 || x > 297.01 || y < 0 || y > 210) throw new Error(`text off the page at ${x}, ${y}: ${s}`);
    this.pages[this.cur].push({ s: String(s), x, y, o: o || {} });
  }
  splitTextToSize(s, w) {
    const per = Math.max(1, Math.floor(w / (this.size * 0.19)));
    const out = [];
    String(s).split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(word => {
        if ((line + ' ' + word).trim().length > per && line) { out.push(line); line = word; }
        else line = (line + ' ' + word).trim();
      });
      out.push(line);
    });
    return out;
  }
  setFont() {} setTextColor() {} setFillColor() {} setDrawColor() {} rect() {} line() {}
  setFontSize(n) { this.size = n; }
  addPage() { this.pages.push([]); this.cur = this.pages.length - 1; }
  setPage(i) { this.cur = i - 1; }
  getNumberOfPages() { return this.pages.length; }
  save(name) { this.saved = name; }
  pageText(i) { return this.pages[i].map(t => t.s).join('\n'); }
}
