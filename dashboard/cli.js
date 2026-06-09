// CEO approval CLI. The only authority that can clear a gate or a frozen
// action. Usage:
//   npm run approve -- PROJECT_KICKOFF        # approve a gate
//   npm run approve -- FINANCIAL_CLEARANCE
//   npm run approve -- DEPLOYMENT
//   npm run approve -- list                   # show pending queue
//   npm run approve -- deny <gate>

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CEO_ACTIONS = resolve(ROOT, 'dashboard', 'ceo_actions.json');
const PENDING = resolve(ROOT, 'dashboard', 'pending_approvals.json');

async function loadJSON(p, fb) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; }
}

const [cmd, arg] = process.argv.slice(2);

if (!cmd || cmd === 'list') {
  const pend = await loadJSON(PENDING, { pending: [] });
  const open = pend.pending.filter((a) => a.status === 'PENDING');
  if (open.length === 0) {
    console.log('No pending approvals.');
  } else {
    console.log('PENDING APPROVALS:');
    for (const a of open) {
      console.log(`  #${a.id} [${a.category}] ${a.agent} :: ${a.action} ${JSON.stringify(a.detail)}`);
    }
  }
  process.exit(0);
}

const decision = cmd === 'deny' ? 'DENY' : 'APPROVE';
const gate = cmd === 'deny' ? arg : cmd;
if (!gate) {
  console.error('Specify a gate, e.g. PROJECT_KICKOFF | FINANCIAL_CLEARANCE | DEPLOYMENT');
  process.exit(1);
}

// Record the CEO decision.
const actions = await loadJSON(CEO_ACTIONS, { approvals: [] });
actions.approvals.push({ gate, decision, decidedAt: new Date().toISOString() });
await writeFile(CEO_ACTIONS, JSON.stringify(actions, null, 2));

// Mark matching pending entries resolved.
const pend = await loadJSON(PENDING, { pending: [] });
for (const a of pend.pending) {
  if (a.status === 'PENDING' && (a.action === gate || a.detail?.gate === gate)) {
    a.status = decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
    a.decidedAt = new Date().toISOString();
  }
}
await writeFile(PENDING, JSON.stringify(pend, null, 2));

console.log(`Recorded ${decision} for gate "${gate}". Re-run \`npm start\` to resume the engine.`);
