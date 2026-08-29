// Archive the newest idea as a dated markdown file.
//
// workspace/TrendReport.md is overwritten by every research run, so without
// this only ideas.json retains history (as embedded `report` strings, which are
// awkward to read). This writes one readable file per idea into
// workspace/ideas/, which is bind-mounted to the host so the operator can read
// and back them up without docker.
//
// Runs BEFORE notify in `npm run nightly`: if the WhatsApp send fails, the
// idea is already on disk rather than lost.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/logger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'workspace', 'ideas');

function slug(s) {
  return String(s ?? 'idea')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'idea';
}

async function main() {
  let store;
  try {
    store = JSON.parse(await readFile(resolve(ROOT, 'workspace', 'ideas.json'), 'utf8'));
  } catch (e) {
    log.error('archive', `cannot read ideas.json: ${e.message}`);
    process.exit(1);
  }

  const idea = (store.ideas ?? []).at(-1);
  if (!idea) {
    log.error('archive', 'no ideas in store — did the research run fail?');
    process.exit(1);
  }

  const day = (idea.createdAt ?? new Date().toISOString()).slice(0, 10);
  const file = resolve(OUT_DIR, `${day}-${idea.id}-${slug(idea.title)}.md`);

  // Frontmatter mirrors the structured fields so the archive stays greppable
  // and sortable without parsing ideas.json.
  const doc = [
    '---',
    `id: ${idea.id}`,
    `date: ${idea.createdAt ?? new Date().toISOString()}`,
    `title: ${JSON.stringify(idea.title ?? '')}`,
    `score: ${idea.score ?? 0}`,
    `confidence: ${idea.confidence ?? 'unknown'}`,
    `status: ${idea.status ?? 'new'}`,
    '---',
    '',
    idea.report ?? '(no report captured)',
    '',
  ].join('\n');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(file, doc, 'utf8');
  log.ok('archive', `wrote ${file.replace(`${ROOT}/`, '')}`);
}

main().catch((e) => {
  log.error('archive', e.stack ?? e.message);
  process.exit(1);
});
