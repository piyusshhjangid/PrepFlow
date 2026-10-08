/**
 * Fictional demo data used by the seed script. Kept free of any database code so its
 * invariants can be unit-tested (see seed-data.test.ts). No real student's information
 * belongs here.
 */
import type { Difficulty, Importance } from '@prepflow/shared';

export interface DemoTopic {
  name: string;
  /** Verbatim phrase from the demo material; becomes the topic's evidence snippet. */
  phrase: string;
  difficulty: Difficulty;
  importance: Importance;
  minutes: number;
  prerequisites?: string[];
  weak?: boolean;
}

export interface DemoSubject {
  name: string;
  topics: DemoTopic[];
}

export const subjects: DemoSubject[] = [
  {
    name: 'Database Management Systems',
    topics: [
      {
        name: 'ER Modeling and Relational Model',
        phrase: 'ER diagrams, relational model, keys',
        difficulty: 'EASY',
        importance: 'MEDIUM',
        minutes: 90,
      },
      {
        name: 'SQL Queries and Joins',
        phrase: 'SQL: SELECT, joins, subqueries, aggregation',
        difficulty: 'MEDIUM',
        importance: 'HIGH',
        minutes: 150,
      },
      {
        name: 'Functional Dependencies',
        phrase: 'Functional dependencies and closure',
        difficulty: 'MEDIUM',
        importance: 'MEDIUM',
        minutes: 90,
        prerequisites: ['ER Modeling and Relational Model'],
      },
      {
        name: 'Normalization',
        phrase: 'Normalization (1NF, 2NF, 3NF, BCNF)',
        difficulty: 'HARD',
        importance: 'HIGH',
        minutes: 180,
        prerequisites: ['Functional Dependencies'],
        weak: true,
      },
      {
        name: 'Transactions and ACID',
        phrase: 'Transactions and ACID properties',
        difficulty: 'MEDIUM',
        importance: 'HIGH',
        minutes: 120,
      },
      {
        name: 'Concurrency Control',
        phrase: 'Concurrency control: locking, 2PL, timestamps',
        difficulty: 'HARD',
        importance: 'HIGH',
        minutes: 150,
        prerequisites: ['Transactions and ACID'],
      },
      {
        name: 'Indexing and B+ Trees',
        phrase: 'Indexing, B and B+ trees',
        difficulty: 'HARD',
        importance: 'MEDIUM',
        minutes: 120,
      },
    ],
  },
  {
    name: 'Operating Systems',
    topics: [
      {
        name: 'Processes and Threads',
        phrase: 'Processes, threads, context switching',
        difficulty: 'EASY',
        importance: 'HIGH',
        minutes: 120,
      },
      {
        name: 'CPU Scheduling',
        phrase: 'CPU scheduling: FCFS, SJF, Round Robin, priority',
        difficulty: 'MEDIUM',
        importance: 'HIGH',
        minutes: 120,
        prerequisites: ['Processes and Threads'],
      },
      {
        name: 'Synchronization',
        phrase: 'Synchronization: critical section, semaphores, monitors',
        difficulty: 'HARD',
        importance: 'HIGH',
        minutes: 150,
        prerequisites: ['Processes and Threads'],
      },
      {
        name: 'Deadlocks',
        phrase: 'Deadlocks: conditions, prevention, avoidance, detection',
        difficulty: 'HARD',
        importance: 'HIGH',
        minutes: 150,
        prerequisites: ['Synchronization'],
        weak: true,
      },
      {
        name: 'Memory Management',
        phrase: 'Memory management: paging and segmentation',
        difficulty: 'MEDIUM',
        importance: 'MEDIUM',
        minutes: 150,
      },
      {
        name: 'Virtual Memory',
        phrase: 'Virtual memory and page replacement',
        difficulty: 'HARD',
        importance: 'MEDIUM',
        minutes: 150,
        prerequisites: ['Memory Management'],
      },
    ],
  },
  {
    name: 'Design and Analysis of Algorithms',
    topics: [
      {
        name: 'Asymptotic Analysis',
        phrase: 'Asymptotic notation and recurrences',
        difficulty: 'EASY',
        importance: 'HIGH',
        minutes: 90,
      },
      {
        name: 'Divide and Conquer',
        phrase: 'Divide and conquer: merge sort, quick sort',
        difficulty: 'MEDIUM',
        importance: 'MEDIUM',
        minutes: 120,
        prerequisites: ['Asymptotic Analysis'],
      },
      {
        name: 'Greedy Algorithms',
        phrase: 'Greedy algorithms: activity selection, Huffman coding',
        difficulty: 'MEDIUM',
        importance: 'HIGH',
        minutes: 120,
        prerequisites: ['Asymptotic Analysis'],
      },
      {
        name: 'Dynamic Programming',
        phrase: 'Dynamic programming: knapsack, LCS, matrix chain',
        difficulty: 'HARD',
        importance: 'HIGH',
        minutes: 210,
        prerequisites: ['Divide and Conquer'],
        weak: true,
      },
      {
        name: 'Graph Algorithms',
        phrase: 'Graph traversal, shortest paths, spanning trees',
        difficulty: 'MEDIUM',
        importance: 'HIGH',
        minutes: 150,
      },
    ],
  },
];

export const revisionWeightByDifficulty: Record<Difficulty, number> = {
  EASY: 0.3,
  MEDIUM: 0.5,
  HARD: 0.8,
};

export function buildMaterialText(): string {
  const lines: string[] = ['SAMPLE SYLLABUS (fictional demo data)', ''];
  subjects.forEach((subject, index) => {
    lines.push(`Unit ${index + 1}: ${subject.name}`);
    for (const topic of subject.topics) lines.push(`- ${topic.phrase}`);
    lines.push('');
  });
  return lines.join('\n');
}
