import { BaseAgent } from '../baseAgent.js';
import { completeJSON } from '../../lib/llm.js';

const SYSTEM = `You are agent-designer in an autonomous micro-SaaS factory.
Define a clean, modern visual system (brand, color, type, spacing) and a
simple dashboard wireframe. Use Tailwind-style utility conventions.`;

const SCHEMA = {
  type: 'object',
  properties: {
    brand: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        primary: { type: 'string' },
        accent: { type: 'string' },
        neutral: { type: 'string' },
      },
      required: ['name', 'primary', 'accent', 'neutral'],
      additionalProperties: false,
    },
    typography: {
      type: 'object',
      properties: {
        sans: { type: 'string' },
        scale: { type: 'array', items: { type: 'number' } },
      },
      required: ['sans', 'scale'],
      additionalProperties: false,
    },
    radius: {
      type: 'object',
      properties: { sm: { type: 'string' }, md: { type: 'string' }, lg: { type: 'string' } },
      required: ['sm', 'md', 'lg'],
      additionalProperties: false,
    },
    wireframe: { type: 'string', description: 'ASCII/markdown dashboard wireframe' },
  },
  required: ['brand', 'typography', 'radius', 'wireframe'],
  additionalProperties: false,
};

const STUB = {
  brand: { name: 'Recyql', primary: '#4f46e5', accent: '#22d3ee', neutral: '#0f172a' },
  typography: { sans: 'Inter, system-ui', scale: [12, 14, 16, 20, 24, 32] },
  radius: { sm: '4px', md: '8px', lg: '16px' },
  wireframe: [
    '# Dashboard wireframe',
    '[ Navbar: logo | Posts | Settings ]',
    '[ Sidebar: queue ] [ Main: post composer + recycle schedule ]',
    '[ Footer: plan + upgrade CTA ]',
  ].join('\n'),
};

// agent-designer — BLUEPRINTING. Spec -> Design_Tokens.json + wireframe.
export class DesignerAgent extends BaseAgent {
  async run() {
    const spec = await this.readArtifact('Architecture_Spec.json');
    const out = (await completeJSON({
      system: SYSTEM,
      prompt: `Design the visual system + dashboard wireframe for this product:\n\n${spec}`,
      schema: SCHEMA,
      source: this.id,
    })) ?? STUB;
    const { wireframe, ...tokens } = out;
    return [
      await this.emit('Design_Tokens.json', tokens),
      await this.emit('layouts/dashboard.wireframe.md', wireframe),
    ];
  }
}
