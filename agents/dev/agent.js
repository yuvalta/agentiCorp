import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-developer in an autonomous micro-SaaS factory.
Implement the backlog as a COMPLETE, RUNNABLE Node.js project (ESM).

Hard constraints (so the QA agent can verify without a network install):
- ZERO external dependencies. Use only Node built-ins (node:http, node:test, etc.).
  Do NOT use Express or any npm package.
- Include a package.json with "type": "module" and a "test" script using node --test.
- Include at least one test file (*.test.js) using node:test + node:assert that
  exercises the core acceptance criteria.
- Provide a Dockerfile.
- Code must be clean, documented, and pass \`node --check\` on every .js file.
Return every file with a path relative to the product root.`;

const SCHEMA = {
  type: 'object',
  properties: {
    entrypoint: { type: 'string' },
    testCommand: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  required: ['entrypoint', 'testCommand', 'files'],
  additionalProperties: false,
};

const STUB = {
  entrypoint: 'server.js',
  testCommand: 'node --test',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify(
        { name: 'product', version: '0.1.0', type: 'module', scripts: { start: 'node server.js', test: 'node --test' } },
        null,
        2,
      ),
    },
    {
      path: 'app.js',
      content: [
        '// Zero-dependency in-memory posts API.',
        'export function createApp() {',
        '  const posts = [];',
        '  return {',
        '    health: () => ({ ok: true }),',
        '    create: (body) => {',
        '      if (!body || !body.body) throw new Error("body required");',
        '      const post = { id: posts.length + 1, ...body };',
        '      posts.push(post);',
        '      return post;',
        '    },',
        '    list: () => posts,',
        '  };',
        '}',
      ].join('\n'),
    },
    {
      path: 'server.js',
      content: [
        "import { createServer } from 'node:http';",
        "import { createApp } from './app.js';",
        'const app = createApp();',
        'export const server = createServer((req, res) => {',
        "  if (req.url === '/health') { res.end(JSON.stringify(app.health())); return; }",
        "  res.statusCode = 404; res.end('not found');",
        '});',
        'if (process.env.NODE_ENV !== "test") server.listen(process.env.PORT ?? 3000);',
      ].join('\n'),
    },
    {
      path: 'app.test.js',
      content: [
        "import { test } from 'node:test';",
        "import assert from 'node:assert';",
        "import { createApp } from './app.js';",
        "test('health ok', () => { assert.deepEqual(createApp().health(), { ok: true }); });",
        "test('create + list', () => {",
        '  const a = createApp();',
        "  a.create({ body: 'hi' });",
        '  assert.equal(a.list().length, 1);',
        '});',
        "test('validation', () => { assert.throws(() => createApp().create({})); });",
      ].join('\n'),
    },
    {
      path: 'Dockerfile',
      content: ['FROM node:20-alpine', 'WORKDIR /app', 'COPY . .', 'CMD ["node", "server.js"]'].join('\n'),
    },
  ],
};

// agent-developer — CONSTRUCTION. Backlog+spec+design -> real project in src/.
export class DeveloperAgent extends BaseAgent {
  async run() {
    const backlog = await this.readArtifact('Product_Backlog.json');
    const spec = await this.readArtifact('Architecture_Spec.json');
    const out = (await completeJSON({
      system: SYSTEM,
      prompt: `Architecture:\n${spec}\n\nBacklog:\n${backlog}\n\nImplement the full MVP project now.`,
      schema: SCHEMA,
      source: this.id,
      maxTokens: 32000,
    })) ?? STUB;

    const written = [];
    for (const f of out.files) {
      // Confine every generated file under src/.
      const rel = `src/${String(f.path).replace(/^(\.\/|\/|src\/)/, '')}`;
      written.push(await this.emit(rel, f.content));
    }
    // Record how QA should run the product.
    await this.emit('src/.build.json', { entrypoint: out.entrypoint, testCommand: out.testCommand });
    return written;
  }
}
