// Central logging layout. All agent communications stream here with a
// consistent tag format so the orchestrator terminal acts as a live dashboard.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = resolve(ROOT, 'workspace', '.agenticorp.log');

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const LEVEL_COLOR = {
  INFO: COLOR.cyan,
  OK: COLOR.green,
  WARN: COLOR.yellow,
  ERROR: COLOR.red,
  STATE: COLOR.magenta,
  GATE: COLOR.yellow,
};

function ts() {
  return new Date().toISOString();
}

async function persist(line) {
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, line + '\n', 'utf8');
  } catch {
    // logging must never crash the engine
  }
}

function emit(level, source, msg, meta) {
  const color = LEVEL_COLOR[level] ?? COLOR.reset;
  const tag = `[${source}]`.padEnd(18);
  const head = `${COLOR.dim}${ts()}${COLOR.reset} ${color}${level.padEnd(5)}${COLOR.reset} ${COLOR.blue}${tag}${COLOR.reset}`;
  const extra = meta ? ` ${COLOR.dim}${JSON.stringify(meta)}${COLOR.reset}` : '';
  // eslint-disable-next-line no-console
  console.log(`${head} ${msg}${extra}`);
  void persist(`${ts()} ${level} ${source} ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`);
}

export const log = {
  info: (src, msg, meta) => emit('INFO', src, msg, meta),
  ok: (src, msg, meta) => emit('OK', src, msg, meta),
  warn: (src, msg, meta) => emit('WARN', src, msg, meta),
  error: (src, msg, meta) => emit('ERROR', src, msg, meta),
  state: (src, msg, meta) => emit('STATE', src, msg, meta),
  gate: (src, msg, meta) => emit('GATE', src, msg, meta),
};

// Render the active sprint board to the terminal.
export function renderSprintBoard(state, history) {
  const bar = '═'.repeat(60);
  const lines = [
    `${COLOR.magenta}${bar}${COLOR.reset}`,
    `${COLOR.magenta} AGENTICORP — SPRINT BOARD${COLOR.reset}`,
    `${COLOR.magenta}${bar}${COLOR.reset}`,
    ` Active state : ${COLOR.cyan}${state}${COLOR.reset}`,
    ` Completed    : ${COLOR.dim}${history.join(' -> ') || '(none)'}${COLOR.reset}`,
    `${COLOR.magenta}${bar}${COLOR.reset}`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}
