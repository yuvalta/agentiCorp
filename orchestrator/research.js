// Standalone research run — produces ONE fresh TrendReport (the next idea)
// without advancing the whole pipeline. Used to seed/iterate ideas before
// committing one at the kickoff gate. `npm run research`.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchAgent } from '../agents/research/agent.js';
import { installGlobalNetGuard } from '../lib/Gatekeeper.js';
import { log } from '../lib/logger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  installGlobalNetGuard();
  const registry = JSON.parse(await readFile(resolve(ROOT, 'config', 'agents.json'), 'utf8'));
  const spec = registry.agents['agent-research'];
  const agent = new ResearchAgent({ id: 'agent-research', spec });
  await agent.execute();
  const report = await readFile(resolve(ROOT, 'workspace', 'TrendReport.md'), 'utf8');
  log.ok('research', 'Idea ready in workspace/TrendReport.md');
  // eslint-disable-next-line no-console
  console.log('\n' + report + '\n');
}

main().catch((e) => {
  log.error('research', e.stack ?? e.message);
  process.exitCode = 1;
});
