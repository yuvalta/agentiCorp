// Running cost ledger. Every LLM call appends one entry; the dashboard reads
// the rolled-up totals. Lives in workspace/ so it resets per product (cleared
// with the workspace) — matching the per-run "what did this product cost" view.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = resolve(ROOT, 'workspace', 'spend.json');

// USD per 1M tokens (input, output). Mirrors the per-agent tiers in llm.js.
const PRICES = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

const EMPTY = { entries: [], totalUsd: 0, totalIn: 0, totalOut: 0, calls: 0 };

// Dollar cost of a single call. Unknown models cost 0 (e.g. stub runs).
export function costOf(model, inTok = 0, outTok = 0) {
  const p = PRICES[model];
  if (!p) return 0;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

async function load() {
  try {
    return { ...EMPTY, ...JSON.parse(await readFile(LEDGER, 'utf8')) };
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

// Append one LLM call to the ledger and return its cost. Agents run
// sequentially in one orchestrator process, so this read-modify-write is safe.
export async function recordSpend({ source = 'llm', model, inTok = 0, outTok = 0 }) {
  const usd = costOf(model, inTok, outTok);
  const led = await load();
  led.entries.push({ ts: new Date().toISOString(), agent: source, model, inTok, outTok, usd });
  led.totalUsd += usd;
  led.totalIn += inTok;
  led.totalOut += outTok;
  led.calls += 1;
  await mkdir(dirname(LEDGER), { recursive: true });
  await writeFile(LEDGER, JSON.stringify(led, null, 2));
  return usd;
}

export async function readSpend() {
  return load();
}
