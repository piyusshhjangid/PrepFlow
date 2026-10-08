import {
  computeAvailability,
  parseIsoDate,
  toIsoDate,
  todayIso,
  type CreateProfileInput,
  type ExamResponse,
  type UpdateExamInput,
} from '@prepflow/shared';
import { assertPlannableExamDate } from '../domain/exam-rules.js';
import { NotFoundError } from '../errors/index.js';
import type { ExamPatch, ExamRecord, SetupRepository } from './ports.js';

const EXAM_NOT_FOUND = 'We couldn’t find that study setup. Start a new one to continue.';

export function toExamResponse(record: ExamRecord, today: string): ExamResponse {
  const examDate = toIsoDate(record.examDate);
  return {
    id: record.id,
    profileId: record.profileId,
    nickname: record.nickname,
    name: record.name,
    examDate,
    minutesPerDay: record.minutesPerDay,
    studyDays: record.studyDays,
    weakTopicHints: record.weakTopicHints,
    confidence: record.confidence,
    revisionIntervalsDays: record.revisionIntervalsDays,
    revisionReservePct: record.revisionReservePct,
    blockedDates: record.blockedDates.map(toIsoDate),
    bufferPct: record.bufferPct,
    availability: computeAvailability({
      today,
      examDate,
      studyWeekdays: record.studyDays,
      minutesPerDay: record.minutesPerDay,
      blockedDates: record.blockedDates.map(toIsoDate),
    }),
  };
}

export interface SetupServiceDeps {
  repo: SetupRepository;
  /** Injected so tests control "today". */
  clock?: () => Date;
}

export function createSetupService({ repo, clock = () => new Date() }: SetupServiceDeps) {
  return {
    async createProfileWithExam(input: CreateProfileInput): Promise<ExamResponse> {
      const today = todayIso(clock());
      assertPlannableExamDate(input.examDate, today);
      const record = await repo.createProfileWithExam({
        nickname: input.nickname,
        name: input.examName,
        examDate: parseIsoDate(input.examDate),
        minutesPerDay: input.minutesPerDay,
        studyDays: input.studyDays,
        weakTopicHints: input.weakTopicHints,
        confidence: input.confidence ?? null,
        bufferPct: input.bufferPct,
        blockedDates: input.blockedDates.map(parseIsoDate),
      });
      return toExamResponse(record, today);
    },

    async getExam(examId: string): Promise<ExamResponse> {
      const record = await repo.findExam(examId);
      if (!record) throw new NotFoundError(EXAM_NOT_FOUND, 'EXAM_NOT_FOUND');
      return toExamResponse(record, todayIso(clock()));
    },

    async updateExam(examId: string, input: UpdateExamInput): Promise<ExamResponse> {
      const today = todayIso(clock());
      if (input.examDate !== undefined) assertPlannableExamDate(input.examDate, today);
      const patch: ExamPatch = {
        name: input.examName,
        examDate: input.examDate === undefined ? undefined : parseIsoDate(input.examDate),
        minutesPerDay: input.minutesPerDay,
        studyDays: input.studyDays,
        weakTopicHints: input.weakTopicHints,
        confidence: input.confidence,
        bufferPct: input.bufferPct,
        blockedDates: input.blockedDates?.map(parseIsoDate),
      };
      const record = await repo.updateExam(examId, patch);
      if (!record) throw new NotFoundError(EXAM_NOT_FOUND, 'EXAM_NOT_FOUND');
      return toExamResponse(record, today);
    },
  };
}

export type SetupService = ReturnType<typeof createSetupService>;
