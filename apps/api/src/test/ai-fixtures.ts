import type { AiCompletionRequest } from '../ai/provider.js';

/** Extracts what the model would see from a prompt built by buildUserPrompt (test helper). */
export function readPrompt(request: AiCompletionRequest): { chunkId: string; material: string } {
  const chunkId = /Chunk id: (\S+)/.exec(request.user)?.[1] ?? '';
  const start = request.user.indexOf(
    '>>>\n',
    request.user.indexOf('<<<MATERIAL ', request.user.indexOf('Everything between')),
  );
  const end = request.user.lastIndexOf('\n<<<END MATERIAL');
  return { chunkId, material: request.user.slice(start + 4, end) };
}

export interface TopicOverrides {
  name?: string;
  parent?: string | null;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  importance?: 'LOW' | 'MEDIUM' | 'HIGH';
  effort?: 'QUICK' | 'STANDARD' | 'EXTENSIVE';
  weakTopicMatch?: string | null;
  confidence?: number;
}

/** A schema-valid topic whose evidence is a real quote from `material` (or a supplied one). */
export function topic(chunkId: string, quote: string, overrides: TopicOverrides = {}) {
  return {
    name: 'Normalization',
    parent: null,
    summary: 'Organizing tables to reduce redundancy.',
    difficulty: 'MEDIUM',
    importance: 'HIGH',
    effort: 'STANDARD',
    revisionNeed: 'MEDIUM',
    origin: 'EXTRACTED',
    statedEmphasis: false,
    confidence: 0.9,
    prerequisites: [],
    weakTopicMatch: null,
    evidence: [{ chunkId, quote }],
    ...overrides,
  };
}

export const response = (subjects: { name: string; topics: unknown[] }[]) =>
  JSON.stringify({ subjects });

/** First `n` characters of the material as a quote that is guaranteed to be verbatim. */
export const quoteFrom = (material: string, n = 60, from = 0) => material.slice(from, from + n);

export const DBMS_TEXT = [
  'Database Normalization',
  '',
  'Normalization is the process of organizing the columns and tables of a relational database to reduce data redundancy.',
  'The first normal form requires that every attribute holds only atomic values and has no repeating groups.',
  '',
  'Transactions and Concurrency',
  '',
  'A transaction is a unit of work that must satisfy the ACID properties: atomicity, consistency, isolation and durability.',
  'Deadlocks occur when two transactions wait for each other to release locks.',
].join('\n');
