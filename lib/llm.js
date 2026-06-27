// Thin wrapper over the Anthropic SDK so agents call one helper. If no API
// key is configured, `complete()` returns null and the caller falls back to
// its deterministic stub — this keeps the pipeline and tests runnable offline.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { log } from './logger.js';
import { recordSpend } from './spend.js';

// Model tiers. Opus = hardest reasoning/code; Sonnet = balanced; Haiku = cheap
// structured output. Pricing per 1M tok (in/out): opus $5/$25, sonnet $3/$15,
// haiku $1/$5.
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

// Resolve the model for a call: explicit override > per-agent map > default.
function modelFor(source, override) {
  return override ?? AGENT_MODELS[source] ?? DEFAULT_MODEL;
}

let client = null;

export function llmAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

// Single-shot completion. Returns the response text, or null if no API key.
// Streams so large reports don't hit the SDK HTTP timeout.
export async function complete({ system, prompt, source = 'llm', effort = 'high', maxTokens = 8000, model }) {
  if (!llmAvailable()) {
    log.warn(source, 'ANTHROPIC_API_KEY not set — using deterministic stub');
    return null;
  }
  const chosen = modelFor(source, model);
  try {
    const stream = getClient().messages.stream({
      model: chosen,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = await stream.finalMessage();
    const text = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    log.ok(source, 'LLM response received', {
      model: chosen,
      in: msg.usage?.input_tokens,
      out: msg.usage?.output_tokens,
    });
    await recordSpend({ source, model: chosen, inTok: msg.usage?.input_tokens ?? 0, outTok: msg.usage?.output_tokens ?? 0 });
    return text;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      log.error(source, `LLM API error ${e.status}: ${e.message}`);
    } else {
      log.error(source, `LLM call failed: ${e.message}`);
    }
    return null; // fall back to stub rather than crash the pipeline
  }
}

// Structured completion. `schema` is a JSON Schema (type: "object"). Returns
// the parsed object, or null if no API key / parse failure -> caller stubs.
export async function completeJSON({ system, prompt, schema, source = 'llm', effort = 'high', maxTokens = 16000, model }) {
  if (!llmAvailable()) {
    log.warn(source, 'ANTHROPIC_API_KEY not set — using deterministic stub');
    return null;
  }
  const chosen = modelFor(source, model);
  try {
    const response = await getClient().messages.parse({
      model: chosen,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: jsonSchemaOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.parsed_output == null) {
      log.warn(source, 'LLM returned unparseable output — using stub');
      return null;
    }
    log.ok(source, 'LLM JSON received', {
      model: chosen,
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
    });
    await recordSpend({ source, model: chosen, inTok: response.usage?.input_tokens ?? 0, outTok: response.usage?.output_tokens ?? 0 });
    return response.parsed_output;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      log.error(source, `LLM API error ${e.status}: ${e.message}`);
    } else {
      log.error(source, `LLM call failed: ${e.message}`);
    }
    return null;
  }
}
