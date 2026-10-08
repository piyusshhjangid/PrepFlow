/**
 * Demo seed: a fictional student with an exam in 8 days.
 *
 * - All data is fictional. No real student's information belongs in this repository.
 * - It creates the profile, exam, material, subjects and topics (with prerequisites).
 * - It does NOT create a study plan: plans are produced by the planning engine, not by hand.
 * - Re-running is safe: the demo profile has a fixed id and is recreated each time.
 */

import { loadEnvFiles } from '../src/config/load-env.js';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildMaterialText, revisionWeightByDifficulty, subjects } from './seed-data.js';

loadEnvFiles();
const prisma = new PrismaClient();

const DEMO_PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function main(): Promise<void> {
  const materialText = buildMaterialText();

  // Evidence must be verbatim. Fail loudly if the demo data ever drifts from this rule.
  for (const subject of subjects) {
    for (const topic of subject.topics) {
      if (!materialText.includes(topic.phrase)) {
        throw new Error(`Seed evidence for "${topic.name}" is not present in the material text`);
      }
    }
  }

  await prisma.studyProfile.deleteMany({ where: { id: DEMO_PROFILE_ID } }); // cascades to everything below

  const profile = await prisma.studyProfile.create({
    data: { id: DEMO_PROFILE_ID, nickname: 'Demo Student' },
  });

  const exam = await prisma.exam.create({
    data: {
      profileId: profile.id,
      name: 'Semester 5 Exams',
      examDate: new Date(utcToday().getTime() + 8 * DAY_MS),
      minutesPerDay: 180,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
      weakTopicHints: ['Normalization', 'Deadlocks', 'Dynamic Programming'],
      confidence: 2,
    },
  });

  const material = await prisma.studyMaterial.create({
    data: {
      examId: exam.id,
      sourceType: 'TEXT',
      contentHash: createHash('sha256').update(materialText).digest('hex'),
      extractedText: materialText,
      charCount: materialText.length,
    },
  });

  const run = await prisma.analysisRun.create({
    data: {
      examId: exam.id,
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      fingerprint: 'seed-demo-data',
      provider: 'seed',
      model: 'none (demo data)',
      finishedAt: new Date(),
    },
  });

  const topicIdsByName = new Map<string, string>();
  let totalMinutes = 0;
  let topicCount = 0;

  for (const [subjectIndex, subject] of subjects.entries()) {
    const createdSubject = await prisma.subject.create({
      data: { examId: exam.id, name: subject.name, sortOrder: subjectIndex },
    });
    for (const [topicIndex, topic] of subject.topics.entries()) {
      const created = await prisma.topic.create({
        data: {
          subjectId: createdSubject.id,
          analysisRunId: run.id,
          name: topic.name,
          sortOrder: topicIndex,
          difficulty: topic.difficulty,
          importance: topic.importance,
          revisionWeight: revisionWeightByDifficulty[topic.difficulty],
          estimatedMinutes: topic.minutes,
          origin: 'EXTRACTED',
          evidence: [
            {
              materialId: material.id,
              chunkId: 'seed',
              page: null,
              pageEnd: null,
              snippet: topic.phrase,
            },
          ],
          isWeak: topic.weak ?? false,
        },
      });
      topicIdsByName.set(topic.name, created.id);
      totalMinutes += topic.minutes;
      topicCount += 1;
    }
  }

  for (const subject of subjects) {
    for (const topic of subject.topics) {
      if (!topic.prerequisites?.length) continue;
      const topicId = topicIdsByName.get(topic.name);
      if (!topicId) throw new Error(`Missing topic id for ${topic.name}`);
      await prisma.topic.update({
        where: { id: topicId },
        data: {
          prerequisites: {
            connect: topic.prerequisites.map((name) => {
              const id = topicIdsByName.get(name);
              if (!id) throw new Error(`Unknown prerequisite "${name}" for "${topic.name}"`);
              return { id };
            }),
          },
        },
      });
    }
  }

  const availableMinutes = 8 * exam.minutesPerDay;
  console.log('Seeded demo data');
  console.log(`  profile id : ${profile.id}`);
  console.log(`  exam       : ${exam.name} on ${exam.examDate.toISOString().slice(0, 10)}`);
  console.log(`  topics     : ${topicCount} across ${subjects.length} subjects`);
  console.log(
    `  workload   : ${(totalMinutes / 60).toFixed(1)}h estimated vs ${(availableMinutes / 60).toFixed(1)}h available (8 days x 3h)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
