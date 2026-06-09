// org-orchestrator — the asynchronous, event-driven state machine that
// governs agent execution. Runs the pipeline, halting at CEO gates and on
// any frozen Gatekeeper action. Engine state persists so a re-run resumes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATES, TRANSITIONS, GATES } from './states.js';
import { AGENT_CLASSES } from '../agents/index.js';
import { Gatekeeper, ApprovalRequiredError, installGlobalNetGuard } from '../lib/Gatekeeper.js';
import { log, renderSprintBoard } from '../lib/logger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = resolve(ROOT, 'workspace', '.engine_state.json');
const CEO_ACTIONS = resolve(ROOT, 'dashboard', 'ceo_actions.json');
const CONFIG = resolve(ROOT, 'config', 'agents.json');

async function loadJSON(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveState(state, history) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ state, history, updatedAt: new Date().toISOString() }, null, 2));
}

// Has the CEO recorded an APPROVE for this gate in ceo_actions.json?
async function gateApproved(gate) {
  const actions = await loadJSON(CEO_ACTIONS, { approvals: [] });
  return (actions.approvals ?? []).some(
    (a) => a.gate === gate && String(a.decision).toUpperCase() === 'APPROVE',
  );
}

async function runState(stateName, registry) {
  const t = TRANSITIONS[stateName];
  if (!t?.agents) return;
  for (const agentId of t.agents) {
    const spec = registry.agents[agentId];
    const AgentClass = AGENT_CLASSES[agentId];
    if (!spec || !AgentClass) throw new Error(`orchestrator: unknown agent ${agentId}`);
    const agent = new AgentClass({ id: agentId, spec });
    await agent.execute();
  }
}

export async function tick() {
  installGlobalNetGuard();
  const registry = await loadJSON(CONFIG, { agents: {} });
  const persisted = await loadJSON(STATE_FILE, { state: STATES.IDLE, history: [] });
  let { state, history } = persisted;

  renderSprintBoard(state, history);

  while (state && state !== STATES.DEPLOYED) {
    const t = TRANSITIONS[state];
    if (!t) break;

    // Gate states: freeze until the CEO approves.
    if (t.gate) {
      if (await gateApproved(t.gate)) {
        log.ok('orchestrator', `gate ${t.gate} APPROVED by CEO -> advancing`);
        history.push(state);
        state = t.next;
        await saveState(state, history);
        continue;
      }
      // Not approved: enqueue request and freeze the enterprise here.
      const gk = new Gatekeeper({ agent: 'orchestrator' });
      try {
        await gk.requestApproval({
          category: 'STRATEGIC_GATE',
          action: t.gate,
          detail: { gate: t.gate, prompt: GATES[t.gate] },
        });
      } catch (e) {
        if (!(e instanceof ApprovalRequiredError)) throw e;
      }
      log.gate('orchestrator', `FROZEN at ${state}. Awaiting CEO: ${t.gate}`);
      log.info('orchestrator', `Approve with: npm run approve -- ${t.gate}`);
      await saveState(state, history);
      return { frozen: true, state, gate: t.gate };
    }

    // Work states: run the agents.
    log.state('orchestrator', `enter ${state}`);
    try {
      await runState(state, registry);
    } catch (e) {
      if (e instanceof ApprovalRequiredError) {
        log.gate('orchestrator', `FROZEN: agent action needs approval -> #${e.approval.id}`);
        await saveState(state, history);
        return { frozen: true, state, approval: e.approval };
      }
      log.error('orchestrator', `state ${state} failed: ${e.message}`);
      await saveState(state, history);
      return { error: true, state, message: e.message };
    }

    history.push(state);
    state = t.next;
    await saveState(state, history);
  }

  if (state === STATES.DEPLOYED) {
    history.push('DEPLOYED');
    await saveState(STATES.DEPLOYED, history);
    log.ok('orchestrator', 'Pipeline complete. App cleared for production deployment.');
    renderSprintBoard(STATES.DEPLOYED, history);
  }
  return { done: true, state };
}

// Run directly: `npm start`.
if (import.meta.url === `file://${process.argv[1]}`) {
  tick().catch((e) => {
    log.error('orchestrator', e.stack ?? e.message);
    process.exitCode = 1;
  });
}
