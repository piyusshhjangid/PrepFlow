import { z } from 'zod';

const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

/**
 * One topic as the model proposes it. Out-of-range labels fall back to a neutral default rather than
 * discarding a good topic; the name and the quote are mandatory.
 */
export const RawTopicSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).catch(''),
  evidence: z.string().trim().min(1).max(2000),
  effort: z.preprocess(lower, z.enum(['short', 'medium', 'long'])).catch('medium'),
  difficulty: z
    .preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int().min(1).max(3))
    .catch(2),
  importance: z.preprocess(lower, z.enum(['low', 'medium', 'high'])).catch('medium'),
  prerequisites: z.array(z.string().trim().min(1).max(120)).max(10).catch([]),
});
export type RawTopic = z.infer<typeof RawTopicSchema>;

export const ResponseShape = z.object({ topics: z.array(z.unknown()) });

/** The same contract as a JSON Schema, sent to Ollama's constrained-output `format` option. */
export const TOPICS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          effort: { type: 'string', enum: ['short', 'medium', 'long'] },
          difficulty: { type: 'integer', enum: [1, 2, 3] },
          importance: { type: 'string', enum: ['low', 'medium', 'high'] },
          prerequisites: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'evidence', 'effort', 'difficulty'],
      },
    },
  },
  required: ['topics'],
} as const;
