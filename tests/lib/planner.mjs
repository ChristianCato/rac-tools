// Loads the planner files (planner/manifest.json) into a fresh Node context,
// the same files in the same order as the app. Each call is a clean load.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readRoot = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
export const manifest = () => JSON.parse(readRoot('planner/manifest.json'));

export function loadPlanner() {
  const context = { console, structuredClone };
  context.window = context;
  vm.createContext(context);
  for (const f of manifest().files) {
    vm.runInContext(readRoot(f), context, { filename: f });
  }
  return context.RAC;
}

// The assumptions file as committed, parsed and checked.
export function loadAssumptions(RAC, text = readRoot('assumptions.csv')) {
  return RAC.assumptions.parse(text);
}
