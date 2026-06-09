// Thin wrapper over the Anthropic SDK so agents call one helper. If no API
// key is configured, `complete()` returns null and the caller falls back to
// its deterministic stub — this keeps the pipeline and tests runnable offline.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { log } from './logger.js';

const MODEL = 'claude-opus-4-8';
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
export async function complete({ system, prompt, source = 'llm', effort = 'high', maxTokens = 8000 }) {
  if (!llmAvailable()) {
    log.warn(source, 'ANTHROPIC_API_KEY not set — using deterministic stub');
    return null;
  }
  try {
    const stream = getClient().messages.stream({
      model: MODEL,
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
      in: msg.usage?.input_tokens,
      out: msg.usage?.output_tokens,
    });
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
export async function completeJSON({ system, prompt, schema, source = 'llm', effort = 'high', maxTokens = 16000 }) {
  if (!llmAvailable()) {
    log.warn(source, 'ANTHROPIC_API_KEY not set — using deterministic stub');
    return null;
  }
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
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
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
    });
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
