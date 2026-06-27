// Gatekeeper: the absolute, hardcoded guardrail.
//
// No agent may touch real currency, register domains, or deploy to public
// infrastructure without explicit Human CEO approval. The Gatekeeper
// intercepts BOTH file mutations and network requests. Anything that looks
// like a financial / cloud-registration / deployment action is frozen and
// routed into pending_approvals.json instead of executing.
//
// Agents MUST perform side effects through this class (guardedWriteFile /
// guardedFetch). As defense-in-depth, installGlobalNetGuard() also patches
// globalThis.fetch so a raw, unguarded request still gets caught.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { log } from './logger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVALS_FILE = resolve(ROOT, 'dashboard', 'pending_approvals.json');
const WORKSPACE = resolve(ROOT, 'workspace');

// Raised when an action is frozen pending CEO approval. The orchestrator
// catches this and halts the affected branch of the workflow.
export class ApprovalRequiredError extends Error {
  constructor(approval) {
    super(`FROZEN: ${approval.category} requires CEO approval (#${approval.id})`);
    this.name = 'ApprovalRequiredError';
    this.approval = approval;
  }
}

// Hosts that imply real-money / production deployment surfaces.
const BLOCKED_HOST_PATTERNS = [
  /paypal\.com/i, /stripe\.com/i, /checkout\./i, /billing\./i,
  /godaddy\.com/i, /namecheap\.com/i, /domains?\.google/i, /registrar/i,
  /aws\.amazon\.com/i, /amazonaws\.com/i, /digitalocean\.com/i,
  /vercel\.com/i, /heroku\.com/i, /cloudflare\.com/i, /azure\.com/i,
  /api\.openai\.com\/v1\/.*billing/i,
];

// Keywords in a NETWORK payload that imply an actual money/registration call.
// Note: real value only moves over the network or via execution config — not
// by an agent writing a descriptive report. So these are scanned on outbound
// requests, NOT on report contents. Financial *clearance* of proposed
// expenses is enforced one layer up, by the orchestrator's FINANCE_GATE.
const BLOCKED_PAYLOAD_KEYWORDS = [
  'credit_card', 'card_number', 'cvv', 'charge', 'purchase',
  'register_domain', 'buy_domain', 'deploy_production', 'provision', 'invoice_pay',
];

// Path fragments that mark a file write as an EXECUTION surface (live secrets,
// production deploy config) rather than a workspace artifact. These are frozen.
const BLOCKED_PATH_FRAGMENTS = [
  '.env.production', 'secrets', 'credentials', 'deploy.', '.pem', 'service-account',
];

// Infrastructure hosts the agents legitimately need (LLM, package registries).
// Their request bodies are not payment payloads, so skip the keyword scan for
// them — otherwise a prompt mentioning "purchase" would freeze the LLM call.
const ALLOWED_HOSTS = [
  /(^|\.)api\.anthropic\.com$/i,
  /(^|\.)registry\.npmjs\.org$/i,
];

// Classify a network action by host + payload. Exported (pure) for tests.
export function classifyNet({ url, payload }) {
  if (url) {
    try {
      const host = new URL(url).host;
      if (ALLOWED_HOSTS.some((re) => re.test(host))) {
        return { blocked: false };
      }
      if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host) || re.test(url))) {
        return { blocked: true, category: 'EXTERNAL_DEPLOY_OR_PAYMENT' };
      }
    } catch {
      // not a parseable URL; fall through to payload scan
    }
  }
  const body = (typeof payload === 'string' ? payload : JSON.stringify(payload ?? '')).toLowerCase();
  if (BLOCKED_PAYLOAD_KEYWORDS.some((k) => body.includes(k))) {
    return { blocked: true, category: 'FINANCIAL_OR_REGISTRATION' };
  }
  return { blocked: false };
}

// Classify a file write by PATH only — descriptive content (e.g. an expense
// report mentioning "payment") must never freeze a legitimate artifact write.
// Exported (pure) for tests.
export function classifyWrite({ path: targetPath }) {
  const p = String(targetPath).toLowerCase();
  if (BLOCKED_PATH_FRAGMENTS.some((frag) => p.includes(frag))) {
    return { blocked: true, category: 'EXECUTION_SURFACE_WRITE' };
  }
  return { blocked: false };
}

async function readApprovals() {
  try {
    return JSON.parse(await readFile(APPROVALS_FILE, 'utf8'));
  } catch {
    return { pending: [] };
  }
}

async function enqueueApproval({ category, agent, action, detail }) {
  const approvals = await readApprovals();
  const entry = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    status: 'PENDING',
    category,
    agent,
    action,
    detail,
  };
  approvals.pending.push(entry);
  await mkdir(dirname(APPROVALS_FILE), { recursive: true });
  await writeFile(APPROVALS_FILE, JSON.stringify(approvals, null, 2), 'utf8');
  log.gate('gatekeeper', `FROZEN ${category} from ${agent} -> pending #${entry.id}`, { action });
  return entry;
}

export class Gatekeeper {
  constructor({ agent = 'unknown' } = {}) {
    this.agent = agent;
  }

  // Guarded file write. Sensitive mutations are frozen; safe writes are
  // confined to the shared /workspace directory.
  async writeFile(targetPath, contents) {
    const abs = resolve(WORKSPACE, targetPath);
    if (!abs.startsWith(WORKSPACE)) {
      throw new Error(`Gatekeeper: write outside /workspace denied: ${targetPath}`);
    }
    const verdict = classifyWrite({ path: targetPath });
    if (verdict.blocked) {
      const approval = await enqueueApproval({
        category: verdict.category,
        agent: this.agent,
        action: 'file.write',
        detail: { path: targetPath },
      });
      throw new ApprovalRequiredError(approval);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents, 'utf8');
    return abs;
  }

  // Guarded network request. Payment / cloud / deploy hosts are frozen.
  async fetch(url, options = {}) {
    const verdict = classifyNet({ url, payload: options.body });
    if (verdict.blocked) {
      const approval = await enqueueApproval({
        category: verdict.category,
        agent: this.agent,
        action: 'net.fetch',
        detail: { url, method: options.method ?? 'GET' },
      });
      throw new ApprovalRequiredError(approval);
    }
    return fetch(url, options);
  }

  // Explicitly request CEO sign-off for a strategic / financial junction
  // (project kickoff, expense clearance, deployment gate). Always freezes.
  async requestApproval({ category, action, detail }) {
    const approval = await enqueueApproval({
      category: category ?? 'STRATEGIC_GATE',
      agent: this.agent,
      action: action ?? 'gate.request',
      detail: detail ?? {},
    });
    throw new ApprovalRequiredError(approval);
  }
}

// Defense-in-depth: patch the global fetch so any unguarded network call from
// agent code is still screened. Call once at engine boot.
let installed = false;
export function installGlobalNetGuard() {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const verdict = classifyNet({ url: String(url), payload: options.body });
    if (verdict.blocked) {
      const approval = await enqueueApproval({
        category: verdict.category,
        agent: 'UNGUARDED',
        action: 'net.fetch',
        detail: { url: String(url) },
      });
      throw new ApprovalRequiredError(approval);
    }
    return real(url, options);
  };
}
