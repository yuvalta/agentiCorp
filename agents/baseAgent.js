// BaseAgent: every agent is an isolated module with strict, schema-checked
// inputs and outputs. Side effects flow only through its own Gatekeeper
// instance. Subclasses implement run(ctx) and return their declared outputs.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gatekeeper } from '../lib/Gatekeeper.js';
import { log } from '../lib/logger.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(ROOT, 'workspace');

export class BaseAgent {
  constructor({ id, spec }) {
    this.id = id;                 // e.g. "agent-research"
    this.spec = spec;             // entry from config/agents.json
    this.gate = new Gatekeeper({ agent: id });
  }

  // Verify every declared input exists in /workspace before running.
  async #checkInputs() {
    for (const input of this.spec.inputs ?? []) {
      if (input.endsWith('/')) continue; // directory output, skip presence check
      try {
        await readFile(resolve(WORKSPACE, input), 'utf8');
      } catch {
        throw new Error(`${this.id}: missing required input "${input}"`);
      }
    }
  }

  // Read a workspace artifact (helper for subclasses).
  async readArtifact(name) {
    return readFile(resolve(WORKSPACE, name), 'utf8');
  }

  // Persist an output through the Gatekeeper and record it for verification.
  async emit(name, contents) {
    const body = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
    await this.gate.writeFile(name, body);
    log.ok(this.id, `wrote ${name}`);
    return name;
  }

  // Template method: validate inputs, run, then confirm declared outputs.
  async execute(ctx = {}) {
    log.info(this.id, `start (${this.spec.role})`);
    await this.#checkInputs();
    const produced = await this.run(ctx);
    const declared = (this.spec.outputs ?? []).filter((o) => !o.endsWith('/'));
    for (const out of declared) {
      try {
        await readFile(resolve(WORKSPACE, out), 'utf8');
      } catch {
        throw new Error(`${this.id}: declared output "${out}" was not produced`);
      }
    }
    log.ok(this.id, 'done');
    return produced;
  }

  // Subclasses override.
  async run() {
    throw new Error(`${this.id}: run() not implemented`);
  }
}
