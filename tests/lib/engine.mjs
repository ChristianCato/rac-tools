// Pulls the planning engine out of index.html so it can run in Node, without a
// browser, React or the database. Code is found by markers rather than line
// numbers, so edits elsewhere in the file do not break the extraction.
import fs from 'node:fs';
import zlib from 'node:zlib';

function block(lines, startRe, endRe, { includeEnd = false } = {}) {
  const s = lines.findIndex(l => startRe.test(l));
  if (s < 0) throw new Error('Engine extraction: start marker not found: ' + startRe);
  const e = lines.findIndex((l, i) => i > s && endRe.test(l));
  if (e < 0) throw new Error('Engine extraction: end marker not found: ' + endRe);
  return lines.slice(s, includeEnd ? e + 1 : e).join('\n');
}

export function extractEngineSource(html) {
  const lines = html.split('\n');
  return [
    block(lines, /^const DATA = window\.__AVP_DATA__;/, /^function CommentaryBox/),
    block(lines, /^\/\/ Every month the dataset holds, oldest first\./, /^\s*return _monthsCache;/, { includeEnd: true }) + '\n}',
    block(lines, /^function todayISO\(/, /^}/, { includeEnd: true }),
    block(lines, /^function applyMonths\(/, /^function HireRates\(/),
  ].join('\n\n');
}

const EXPORTS = ['DATA', 'buildFundingPlan', 'benchWeight', 'dataMonths', 'applyMonths', 'setHireOverride',
  'PLATFORMS', 'NO_SPEND', 'getStats', 'regionPlatformCPA', 'regionPlatformHireCVR'];

// Runs engine source against a data object. Each call gets its own copy of the
// engine and its own caches, the same as a fresh page load.
export function loadEngine(source, data) {
  const window = { __AVP_DATA__: data, location: { hostname: 'node-test' } };
  const body = source + '\nreturn {' + EXPORTS.join(',') + '};';
  return new Function('window', body)(window);
}

export const readSource = (htmlPath) => extractEngineSource(fs.readFileSync(htmlPath, 'utf8'));
export const readGzJson = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));

// The repo data file wraps its JSON in a JSON.parse("...") call.
export function parseRacDataJs(text) {
  const m = text.match(/__AVP_DATA__ = JSON\.parse\((".*?")\);/s);
  if (!m) throw new Error('rac_data.js: data block not found');
  return JSON.parse(JSON.parse(m[1]));
}
