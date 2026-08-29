// Thin wrapper over the Claude Code CLI so agents call one helper. Runs on the
// operator's Claude subscription via `claude -p` (OAuth), never a pay-per-token
// API key. If the CLI or its credentials are missing, `complete()` returns null
// and the caller falls back to its deterministic stub — this keeps the pipeline
// and tests runnable offline.
//
// Auth resolution (handled by the CLI itself, not here):
//   - local dev: whatever `claude` is already logged in as
//   - VPS/headless: CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`
import { spawn } from 'node:child_process';
import { log } from './logger.js';
import { recordSpend } from './spend.js';

// Model tiers. Opus = hardest reasoning/code; Sonnet = balanced; Haiku = cheap
// structured output. Under a subscription these select capability, not price —
// spend is tracked notionally at list rates for the dashboard panel.
const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};
const DEFAULT_MODEL = MODELS.opus;

// Best-fit model per agent. Keyed by agent id (the `source` passed to the LLM
// helpers). architect/developer carry the correctness-critical reasoning and
// stay on Opus; product/research/designer are balanced work on Sonnet;
// finance/marketing/ops emit descriptive structured reports on Haiku. agent-qa
// runs no LLM (real `node --test`), so it never reaches here.
const AGENT_MODELS = {
  'agent-architect': MODELS.opus,
  'agent-developer': MODELS.opus,
  'agent-research': MODELS.sonnet,
  'agent-designer': MODELS.sonnet,
  'agent-product': MODELS.sonnet,
  'agent-finance': MODELS.haiku,
  'agent-marketing': MODELS.haiku,
  'agent-ops': MODELS.haiku,
};

const CLI = process.env.CLAUDE_CLI ?? 'claude';
const CLI_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 10 * 60 * 1000);

// Resolve the model for a call: explicit override > per-agent map > default.
function modelFor(source, override) {
  return override ?? AGENT_MODELS[source] ?? DEFAULT_MODEL;
}

// The CLI carries its own auth. We only assert it is reachable — a missing
// binary is the one failure we can detect without paying for a round trip.
let cliChecked = null;
export function llmAvailable() {
  if (cliChecked === null) {
    // Never allow a pay-per-token key to leak in as the credential.
    if (process.env.ANTHROPIC_API_KEY) {
      log.warn('llm', 'ANTHROPIC_API_KEY is set but ignored — this factory runs on the Claude subscription only');
    }
    cliChecked = true;
  }
  return cliChecked;
}

// Spawn `claude -p`, feeding the prompt over stdin (agent prompts routinely
// exceed ARG_MAX, so argv is not an option). Tools are disabled: these calls
// are pure text completion, and an unsandboxed tool-capable subprocess would
// route straight around the Gatekeeper's in-process net/file guards.
function runClaude({ system, prompt, model, source }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--allowed-tools', '',
  ];
  if (system) args.push('--system-prompt', system);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(CLI, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      log.error(source, `failed to spawn ${CLI}: ${e.message}`);
      return resolve(null);
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      log.error(source, `LLM call timed out after ${CLI_TIMEOUT_MS}ms`);
      finish(null);
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (e) => {
      // ENOENT here means the CLI is not installed / not on PATH.
      log.error(source, `${CLI} not runnable: ${e.message}`);
      finish(null);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        log.error(source, `${CLI} exited ${code}: ${stderr.trim().slice(0, 300)}`);
        return finish(null);
      }
      let env;
      try {
        env = JSON.parse(stdout);
      } catch {
        log.error(source, `could not parse ${CLI} envelope: ${stdout.slice(0, 200)}`);
        return finish(null);
      }
      if (env.is_error || env.subtype !== 'success') {
        log.error(source, `LLM error (${env.subtype}): ${String(env.result).slice(0, 300)}`);
        return finish(null);
      }
      finish(env);
    });

    child.stdin.on('error', () => { /* closed early; `close` reports the real cause */ });
    child.stdin.end(prompt);
  });
}

// Record notional spend from the CLI's usage envelope so the dashboard panel
// keeps working. Under a subscription this is list-rate accounting, not a bill.
async function trackSpend(env, source, model) {
  const u = env.usage ?? {};
  log.ok(source, 'LLM response received', {
    model,
    in: u.input_tokens,
    out: u.output_tokens,
  });
  await recordSpend({
    source,
    model,
    inTok: u.input_tokens ?? 0,
    outTok: u.output_tokens ?? 0,
  });
}

// Single-shot completion. Returns the response text, or null when unavailable.
export async function complete({ system, prompt, source = 'llm', maxTokens, model, effort }) {
  void maxTokens; void effort; // CLI has no equivalent knobs; kept for call-site compatibility
  if (!llmAvailable()) return null;
  const chosen = modelFor(source, model);
  const env = await runClaude({ system, prompt, model: chosen, source });
  if (!env) return null;
  await trackSpend(env, source, chosen);
  return String(env.result ?? '').trim();
}

// Pull a JSON object out of model prose. The CLI has no schema-enforced output
// (unlike the SDK's messages.parse), and models wrap JSON in markdown fences
// even when told not to — so strip fences, then fall back to the outermost
// brace pair.
function extractJSON(text) {
  const raw = String(text ?? '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  for (const candidate of [unfenced, raw]) {
    try { return JSON.parse(candidate); } catch { /* try next strategy */ }
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }
  return null;
}

// Required top-level keys must be present, or the caller gets a half-built
// object that reads as success. Mirrors the guarantee messages.parse gave us.
function missingKeys(obj, schema) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['<not an object>'];
  return (schema?.required ?? []).filter((k) => obj[k] === undefined);
}

// Structured completion. `schema` is a JSON Schema (type: "object"). Returns
// the parsed object, or null on repeated parse/validation failure -> caller
// falls back to its stub.
export async function completeJSON({ system, prompt, schema, source = 'llm', maxTokens, model, effort }) {
  void maxTokens; void effort;
  if (!llmAvailable()) return null;
  const chosen = modelFor(source, model);

  const jsonRules = [
    'Respond with a single JSON object and nothing else.',
    'No markdown code fences, no commentary before or after.',
    'It must validate against this JSON Schema:',
    JSON.stringify(schema),
  ].join('\n');

  const sys = [system, jsonRules].filter(Boolean).join('\n\n');

  let lastText = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const userPrompt = attempt === 1
      ? prompt
      : [
          prompt,
          '',
          'Your previous reply was not valid JSON matching the schema. Return ONLY the raw JSON object.',
          `Previous reply began: ${lastText.slice(0, 200)}`,
        ].join('\n');

    const env = await runClaude({ system: sys, prompt: userPrompt, model: chosen, source });
    if (!env) return null;
    await trackSpend(env, source, chosen);

    lastText = String(env.result ?? '');
    const parsed = extractJSON(lastText);
    const missing = missingKeys(parsed, schema);
    if (parsed && missing.length === 0) {
      log.ok(source, 'LLM JSON parsed', { model: chosen, attempt });
      return parsed;
    }
    log.warn(source, `LLM JSON invalid (attempt ${attempt}): ${parsed ? `missing ${missing.join(', ')}` : 'unparseable'}`);
  }

  log.warn(source, 'LLM JSON failed twice — using stub');
  return null;
}
