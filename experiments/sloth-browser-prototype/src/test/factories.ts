import type { Topic } from '../core/types';

let counter = 0;
export function topic(over: Partial<Topic> & { name?: string } = {}): Topic {
  counter++;
  const name = over.name ?? `Topic ${counter}`;
  return {
    id: over.id ?? name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description: '',
    effort: 'medium',
    difficulty: 2,
    importance: 'medium',
    prerequisites: [],
    minutes: 60,
    status: 'verified',
    evidence: null,
    weak: false,
    done: false,
    include: true,
    order: counter,
    ...over,
  };
}
