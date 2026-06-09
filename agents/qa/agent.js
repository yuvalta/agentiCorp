import { BaseAgent } from '../baseAgent.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = resolve(ROOT, 'workspace', 'src');

async function listJsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...(await listJsFiles(full)));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// agent-qa — CONSTRUCTION. REAL verification: syntax-check every JS file and
// run the product's test suite. BLOCKS deployment (throws) on any failure.
export class QaAgent extends BaseAgent {
  async run() {
    const checks = [];

    // 1. Syntax check every generated .js file.
    const jsFiles = await listJsFiles(SRC);
    for (const file of jsFiles) {
      try {
        await run(process.execPath, ['--check', file], { timeout: 15000 });
        checks.push({ name: `node --check ${file.replace(SRC + '/', '')}`, pass: true });
      } catch (e) {
        checks.push({ name: `node --check ${file.replace(SRC + '/', '')}`, pass: false, detail: e.stderr?.slice(0, 400) });
      }
    }

    // 2. Run the product test suite in its own directory.
    let testOutput = '';
    try {
      const { stdout } = await run(process.execPath, ['--test'], { cwd: SRC, timeout: 60000 });
      testOutput = stdout.slice(-600);
      checks.push({ name: 'node --test', pass: true });
    } catch (e) {
      testOutput = (e.stdout ?? '').slice(-600) + (e.stderr ?? '').slice(-300);
      checks.push({ name: 'node --test', pass: false, detail: testOutput });
    }

    const failed = checks.filter((c) => !c.pass);
    const audit = {
      ranAt: new Date().toISOString(),
      filesChecked: jsFiles.length,
      checks,
      testOutput,
      passed: checks.length - failed.length,
      failed: failed.length,
      verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    };
    await this.emit('QA_Audit_Log.json', audit);

    if (failed.length > 0) {
      throw new Error(`agent-qa BLOCKED deployment: ${failed.length} check(s) failed`);
    }
    return ['QA_Audit_Log.json'];
  }
}
