import { emptyReport, finalizeCandidates } from '../ai/analyze';
import { RawTopicSchema, type RawTopic } from '../ai/schema';
import { addDays, type ISODate } from '../core/dates';
import type { Topic } from '../core/types';
import type { AnalysisReport } from '../ai/analyze';
import type { Material, Settings } from '../ui/store';

/**
 * SAMPLE DATA, NOT MODEL OUTPUT.
 *
 * This lets anyone explore the whole app without installing a model. The syllabus is original (it is also
 * `eval/samples/01-structured-syllabus.txt`). The topic proposals below were written by hand to look like
 * what a model might return. They are run through the app's real verification code, so every quote check,
 * importance check and prerequisite step you see is real, but nothing here was produced by Gemma. The app
 * says so wherever the topics are shown, and in every export.
 *
 * Two proposals are deliberately flawed so the safety checks have something to show:
 *  - "Data warehousing and OLAP" quotes a sentence that is not in the syllabus (it is held back).
 *  - "Query optimization" quotes a real line that never mentions it (it is flagged as weakly supported).
 *  - "Transactions" is proposed as "high" importance although nothing in the syllabus says so
 *    (code lowers it to medium).
 */
export const SAMPLE_MATERIAL = `CS 220: Introduction to Databases. Course syllabus.

Week 1 - Relational model. Tables, rows, columns, primary keys and foreign keys. Students learn how relations represent real-world entities.
Week 2 - SQL basics. SELECT, WHERE, ORDER BY and LIMIT. Writing queries that filter and sort a single table.
Week 3 - Joins. Inner joins, outer joins and self joins. Combining rows from several tables, with emphasis on choosing the correct join type.
Week 4 - Aggregation. GROUP BY, HAVING and the aggregate functions COUNT, SUM and AVG. This topic carries 20 percent of the final exam.
Week 5 - Normalization. First, second and third normal form. Removing redundancy and update anomalies from a schema design.
Week 6 - Transactions. The ACID properties, commit and rollback. Why concurrent updates need isolation.
Week 7 - Indexes. B-tree indexes and how they speed up lookups. The cost of indexes on write-heavy tables.

Assessment: final exam 60 percent, project 30 percent, quizzes 10 percent.
`;

const proposal = (over: Partial<RawTopic> & Pick<RawTopic, 'name' | 'evidence'>): RawTopic =>
  RawTopicSchema.parse({
    description: '',
    effort: 'medium',
    difficulty: 2,
    importance: 'medium',
    prerequisites: [],
    ...over,
  });

export const SAMPLE_PROPOSALS: RawTopic[] = [
  proposal({
    name: 'Relational model',
    description: 'How tables, keys and relations represent real-world entities.',
    evidence:
      'Tables, rows, columns, primary keys and foreign keys. Students learn how relations represent real-world entities.',
    effort: 'short',
    difficulty: 1,
  }),
  proposal({
    name: 'SQL basics',
    description: 'Writing single-table queries that filter and sort.',
    evidence:
      'SELECT, WHERE, ORDER BY and LIMIT. Writing queries that filter and sort a single table.',
    effort: 'short',
    difficulty: 1,
    prerequisites: ['Relational model'],
  }),
  proposal({
    name: 'Joins',
    description: 'Combining rows from several tables and choosing the right join type.',
    evidence:
      'Inner joins, outer joins and self joins. Combining rows from several tables, with emphasis on choosing the correct join type.',
    effort: 'long',
    difficulty: 3,
    prerequisites: ['SQL basics'],
  }),
  proposal({
    name: 'Aggregation',
    description: 'Grouping rows and summarising them with aggregate functions.',
    evidence:
      'GROUP BY, HAVING and the aggregate functions COUNT, SUM and AVG. This topic carries 20 percent of the final exam.',
    effort: 'medium',
    difficulty: 2,
    importance: 'high',
    prerequisites: ['SQL basics'],
  }),
  proposal({
    name: 'Normalization',
    description: 'Designing schemas without redundancy or update anomalies.',
    evidence:
      'First, second and third normal form. Removing redundancy and update anomalies from a schema design.',
    effort: 'medium',
    difficulty: 3,
    prerequisites: ['Relational model'],
  }),
  proposal({
    name: 'Transactions',
    description: 'ACID properties, commit and rollback, and isolation of concurrent updates.',
    evidence: 'The ACID properties, commit and rollback. Why concurrent updates need isolation.',
    effort: 'medium',
    difficulty: 2,
    importance: 'high',
  }),
  proposal({
    name: 'Indexes',
    description: 'How B-tree indexes speed up lookups and what they cost on writes.',
    evidence:
      'B-tree indexes and how they speed up lookups. The cost of indexes on write-heavy tables.',
    effort: 'short',
    difficulty: 2,
    prerequisites: ['Relational model'],
  }),
  proposal({
    name: 'Query optimization',
    description: 'Making queries run faster.',
    evidence: 'The cost of indexes on write-heavy tables.',
    effort: 'medium',
    difficulty: 3,
  }),
  proposal({
    name: 'Data warehousing and OLAP',
    description: 'Analytical processing over large historical data.',
    evidence: 'Students build a star schema and run OLAP cube queries over historical sales data.',
    effort: 'long',
    difficulty: 3,
  }),
];

export interface SampleBundle {
  material: Material;
  settings: Pick<
    Settings,
    'goal' | 'examDate' | 'minutesPerDay' | 'sessionMinutes' | 'knownTopics'
  >;
  topics: Topic[];
  report: AnalysisReport;
}

export function loadSample(today: ISODate): SampleBundle {
  const report = emptyReport(
    'sample',
    'sample-fixture',
    'none (hand-written sample)',
    SAMPLE_MATERIAL.length,
  );
  const topics = finalizeCandidates({
    text: SAMPLE_MATERIAL,
    candidates: SAMPLE_PROPOSALS,
    report,
    origin: 'sample',
  });
  return {
    material: { text: SAMPLE_MATERIAL, source: 'paste' },
    settings: {
      goal: 'Databases final (sample)',
      examDate: addDays(today, 8),
      minutesPerDay: 120,
      sessionMinutes: 45,
      knownTopics: '',
    },
    topics,
    report,
  };
}
