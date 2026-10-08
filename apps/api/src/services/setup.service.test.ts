import type { CreateProfileInput } from '@prepflow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySetupRepository } from '../test/in-memory.js';
import { createSetupService } from './setup.service.js';

// 2026-10-03 is a Saturday.
const NOW = new Date('2026-10-03T10:00:00.000Z');
const input: CreateProfileInput = {
  nickname: 'Asha',
  examName: 'DBMS Final',
  examDate: '2026-10-11',
  minutesPerDay: 180,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  weakTopicHints: ['Normalization'],
  blockedDates: [],
  bufferPct: 10,
};

let repo: InMemorySetupRepository;
let service: ReturnType<typeof createSetupService>;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

beforeEach(() => {
  repo = new InMemorySetupRepository();
  service = createSetupService({ repo, clock: () => NOW });
});

describe('createProfileWithExam', () => {
  it('stores the setup and reports honest availability (8 days x 3h = 24h)', async () => {
    const exam = await service.createProfileWithExam(input);
    expect(exam.examDate).toBe('2026-10-11');
    expect(exam.confidence).toBeNull();
    expect(exam.availability).toEqual({ daysUntilExam: 8, studyDays: 8, availableMinutes: 1440 });
    expect(repo.exams.size).toBe(1);
  });

  it('rejects an exam date that has already passed, but tolerates a one-day time-zone lag', async () => {
    expect(await codeOf(service.createProfileWithExam({ ...input, examDate: '2026-10-01' }))).toBe(
      'EXAM_DATE_IN_PAST',
    );
    expect(
      await codeOf(service.createProfileWithExam({ ...input, examDate: '2026-10-02' })),
    ).toBeUndefined();
    expect(repo.exams.size).toBe(1); // only the accepted one was stored
  });

  it('rejects an implausibly distant exam date', async () => {
    expect(await codeOf(service.createProfileWithExam({ ...input, examDate: '2028-10-03' }))).toBe(
      'EXAM_DATE_TOO_FAR',
    );
  });

  it('scenario 3: accepts an exam tomorrow and reports very little time', async () => {
    const exam = await service.createProfileWithExam({ ...input, examDate: '2026-10-04' });
    expect(exam.availability).toEqual({ daysUntilExam: 1, studyDays: 1, availableMinutes: 180 });
  });
});

describe('getExam / updateExam', () => {
  it('returns a clear not-found for an unknown exam', async () => {
    expect(await codeOf(service.getExam('00000000-0000-4000-8000-000000000099'))).toBe(
      'EXAM_NOT_FOUND',
    );
    expect(
      await codeOf(
        service.updateExam('00000000-0000-4000-8000-000000000099', { minutesPerDay: 60 }),
      ),
    ).toBe('EXAM_NOT_FOUND');
  });

  it('scenario 10: changing daily hours updates availability and leaves other fields alone', async () => {
    const created = await service.createProfileWithExam(input);
    const updated = await service.updateExam(created.id, { minutesPerDay: 240 });
    expect(updated.minutesPerDay).toBe(240);
    expect(updated.availability.availableMinutes).toBe(1920);
    expect(updated.name).toBe('DBMS Final');
    expect(updated.weakTopicHints).toEqual(['Normalization']);
  });

  it('changing study days changes the number of study days', async () => {
    const created = await service.createProfileWithExam(input);
    const updated = await service.updateExam(created.id, { studyDays: [1, 2, 3, 4, 5] });
    expect(updated.availability.studyDays).toBe(5);
  });

  it('can clear confidence with null, and validates a changed exam date', async () => {
    const created = await service.createProfileWithExam({ ...input, confidence: 2 });
    expect((await service.updateExam(created.id, { confidence: null })).confidence).toBeNull();
    expect(await codeOf(service.updateExam(created.id, { examDate: '2026-09-01' }))).toBe(
      'EXAM_DATE_IN_PAST',
    );
  });
});
