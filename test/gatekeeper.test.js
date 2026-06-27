// Guardrail suite for the Gatekeeper — the hardcoded Golden Rule enforcer.
// Pure classifiers (classifyNet/classifyWrite) are unit-tested directly; the
// stateful Gatekeeper methods are exercised against the real approvals file,
// which is snapshotted and restored so the suite stays hermetic.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Gatekeeper,
  ApprovalRequiredError,
  classifyNet,
  classifyWrite,
  installGlobalNetGuard,
} from '../lib/Gatekeeper.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPROVALS_FILE = resolve(ROOT, 'dashboard', 'pending_approvals.json');

// ---- snapshot / restore the real approvals file -------------------------
let approvalsSnapshot = null; // null === file absent
before(async () => {
  try {
    approvalsSnapshot = await readFile(APPROVALS_FILE, 'utf8');
  } catch {
    approvalsSnapshot = null;
  }
});
after(async () => {
  if (approvalsSnapshot === null) {
    await rm(APPROVALS_FILE, { force: true });
  } else {
    await writeFile(APPROVALS_FILE, approvalsSnapshot, 'utf8');
  }
});

async function pendingCount() {
  try {
    return JSON.parse(await readFile(APPROVALS_FILE, 'utf8')).pending.length;
  } catch {
    return 0;
  }
}

// ===== classifyNet (pure) ================================================
test('classifyNet freezes payment/cloud/registrar hosts', () => {
  for (const url of [
    'https://api.stripe.com/v1/charges',
    'https://www.paypal.com/pay',
    'https://api.godaddy.com/v1/domains',
    'https://ec2.amazonaws.com/run',
    'https://api.vercel.com/v1/deployments',
    'https://api.cloudflare.com/zones',
    'https://checkout.shop.io/session',
  ]) {
    const v = classifyNet({ url });
    assert.equal(v.blocked, true, `${url} must freeze`);
    assert.equal(v.category, 'EXTERNAL_DEPLOY_OR_PAYMENT');
  }
});

test('classifyNet allows LLM/registry hosts even with money words in body', () => {
  for (const host of ['api.anthropic.com', 'registry.npmjs.org']) {
    const v = classifyNet({
      url: `https://${host}/v1/messages`,
      payload: JSON.stringify({ prompt: 'plan a purchase and charge the card' }),
    });
    assert.equal(v.blocked, false, `${host} must stay open for infra traffic`);
  }
});

test('classifyNet matches allowed-host subdomains, not lookalikes', () => {
  assert.equal(classifyNet({ url: 'https://us.api.anthropic.com/x' }).blocked, false);
  // a lookalike that merely contains the string but is a different host freezes
  // via the payload path if it carries a keyword
  const v = classifyNet({
    url: 'https://api.anthropic.com.evil.test/x',
    payload: '{"charge":true}',
  });
  assert.equal(v.blocked, true);
  assert.equal(v.category, 'FINANCIAL_OR_REGISTRATION');
});

test('classifyNet freezes payment keywords on a neutral host', () => {
  for (const kw of ['credit_card', 'cvv', 'register_domain', 'deploy_production', 'invoice_pay']) {
    const v = classifyNet({ url: 'https://neutral.example/api', payload: `{"x":"${kw}"}` });
    assert.equal(v.blocked, true, `payload ${kw} must freeze`);
    assert.equal(v.category, 'FINANCIAL_OR_REGISTRATION');
  }
});

test('classifyNet scans payload when url is unparseable', () => {
  assert.equal(classifyNet({ url: 'not a url', payload: 'please charge now' }).blocked, true);
  assert.equal(classifyNet({ payload: { buy_domain: 'foo.com' } }).blocked, true);
});

test('classifyNet passes a clean request', () => {
  assert.equal(
    classifyNet({ url: 'https://neutral.example/api', payload: '{"hello":"world"}' }).blocked,
    false,
  );
});

// ===== classifyWrite (pure, path-only) ===================================
test('classifyWrite freezes execution-surface paths', () => {
  for (const p of [
    'config/.env.production',
    'secrets.json',
    'app/credentials.txt',
    'scripts/deploy.sh',
    'keys/server.pem',
    'gcp/service-account.json',
  ]) {
    const v = classifyWrite({ path: p });
    assert.equal(v.blocked, true, `${p} must freeze`);
    assert.equal(v.category, 'EXECUTION_SURFACE_WRITE');
  }
});

test('classifyWrite judges PATH only — descriptive money content passes', () => {
  // The key lesson: a finance report that *describes* a payment must not freeze.
  assert.equal(classifyWrite({ path: 'reports/FinanceReport.md' }).blocked, false);
  assert.equal(classifyWrite({ path: 'reports/payment-summary.md' }).blocked, false);
  assert.equal(classifyWrite({ path: 'src/index.js' }).blocked, false);
});

// ===== Gatekeeper.writeFile (stateful) ===================================
test('writeFile denies escaping the workspace sandbox', async () => {
  const gk = new Gatekeeper({ agent: 'test' });
  await assert.rejects(() => gk.writeFile('../escape.txt', 'x'), /outside .workspace denied/);
  await assert.rejects(() => gk.writeFile('/etc/passwd', 'x'), /outside .workspace denied/);
});

test('writeFile freezes a blocked path and enqueues an approval', async () => {
  const gk = new Gatekeeper({ agent: 'test' });
  const before = await pendingCount();
  await assert.rejects(() => gk.writeFile('secrets.json', 'x'), ApprovalRequiredError);
  assert.equal(await pendingCount(), before + 1, 'a pending approval must be queued');
});

test('writeFile persists a clean workspace artifact', async () => {
  const gk = new Gatekeeper({ agent: 'test' });
  const rel = 'test-tmp/artifact.txt';
  const abs = await gk.writeFile(rel, 'hello');
  assert.equal(await readFile(abs, 'utf8'), 'hello');
  await rm(resolve(ROOT, 'workspace', 'test-tmp'), { recursive: true, force: true });
});

// ===== Gatekeeper.fetch / requestApproval (stateful) =====================
test('fetch freezes a blocked host without hitting the network', async () => {
  const gk = new Gatekeeper({ agent: 'test' });
  await assert.rejects(
    () => gk.fetch('https://api.stripe.com/v1/charges', { method: 'POST', body: '{}' }),
    ApprovalRequiredError,
  );
});

test('requestApproval always freezes', async () => {
  const gk = new Gatekeeper({ agent: 'test' });
  await assert.rejects(
    () => gk.requestApproval({ category: 'FINANCE_GATE', action: 'expense.clear' }),
    ApprovalRequiredError,
  );
});

// ===== global net guard (defense-in-depth) ===============================
test('installGlobalNetGuard screens raw fetch and is idempotent', async () => {
  installGlobalNetGuard();
  installGlobalNetGuard(); // second call must be a no-op
  await assert.rejects(
    () => fetch('https://api.godaddy.com/v1/domains', { method: 'POST', body: 'buy_domain' }),
    ApprovalRequiredError,
  );
});
