import { Prisma, type PrismaClient } from '@prisma/client';
import type { ExamPatch, ExamRecord, NewExam, SetupRepository } from '../../services/ports.js';

/** The columns we read from an Exam row (plus its profile's nickname). Prisma rows satisfy this structurally. */
interface ExamRow {
  id: string;
  profileId: string;
  name: string;
  examDate: Date;
  minutesPerDay: number;
  studyDays: number[];
  weakTopicHints: string[];
  confidence: number | null;
  revisionIntervalsDays: number[];
  revisionReservePct: number;
  bufferPct: number;
  blockedDates: Date[] | null;
  profile: { nickname: string };
}

const withProfile = { profile: { select: { nickname: true } } } as const;

function toRecord(row: ExamRow): ExamRecord {
  return {
    id: row.id,
    profileId: row.profileId,
    nickname: row.profile.nickname,
    name: row.name,
    examDate: row.examDate,
    minutesPerDay: row.minutesPerDay,
    studyDays: row.studyDays,
    weakTopicHints: row.weakTopicHints,
    confidence: row.confidence,
    revisionIntervalsDays: row.revisionIntervalsDays,
    revisionReservePct: row.revisionReservePct,
    bufferPct: row.bufferPct,
    blockedDates: row.blockedDates ?? [],
  };
}

/** Thin mapping layer: all business rules live in the services. All queries are parameterized by Prisma. */
export class PrismaSetupRepository implements SetupRepository {
  constructor(private readonly db: PrismaClient) {}

  async createProfileWithExam(data: NewExam): Promise<ExamRecord> {
    const profile = await this.db.studyProfile.create({
      data: {
        nickname: data.nickname,
        exams: {
          create: {
            name: data.name,
            examDate: data.examDate,
            minutesPerDay: data.minutesPerDay,
            studyDays: data.studyDays,
            weakTopicHints: data.weakTopicHints,
            confidence: data.confidence,
            bufferPct: data.bufferPct,
            blockedDates: data.blockedDates,
          },
        },
      },
      include: { exams: { include: withProfile } },
    });
    const exam = profile.exams[0];
    if (!exam) throw new Error('Profile was created without an exam');
    return toRecord(exam);
  }

  async findExam(examId: string): Promise<ExamRecord | null> {
    const row = await this.db.exam.findUnique({ where: { id: examId }, include: withProfile });
    return row ? toRecord(row) : null;
  }

  async updateExam(examId: string, patch: ExamPatch): Promise<ExamRecord | null> {
    try {
      const row = await this.db.exam.update({
        where: { id: examId },
        data: {
          name: patch.name,
          examDate: patch.examDate,
          minutesPerDay: patch.minutesPerDay,
          studyDays: patch.studyDays,
          weakTopicHints: patch.weakTopicHints,
          confidence: patch.confidence, // undefined = unchanged, null = cleared
          bufferPct: patch.bufferPct,
          blockedDates: patch.blockedDates,
        },
        include: withProfile,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        return null;
      throw error;
    }
  }
}
