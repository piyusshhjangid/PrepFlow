-- Checkpoint D: study plans, daily execution, versioned rebalancing.
-- StudyPlan/StudyTask existed since the initial migration (empty, never written by Checkpoint C);
-- this migration extends them and adds the exam settings the planner needs.

-- AlterEnum: a task can be started before it is finished.
-- (Not used elsewhere in this migration, so it is safe inside the migration transaction.)
ALTER TYPE "TaskStatus" ADD VALUE 'IN_PROGRESS';

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('MUST', 'SHOULD', 'IF_TIME', 'DEFER');

-- CreateEnum
CREATE TYPE "PlanTrigger" AS ENUM ('GENERATE', 'RECOVER_MISSED', 'REPLAN_REMAINING');

-- AlterTable: planner settings on the exam
ALTER TABLE "Exam" ADD COLUMN     "bufferPct" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "blockedDates" DATE[];

-- AlterTable: plan versions record how and from what they were made
ALTER TABLE "StudyPlan" ADD COLUMN     "trigger" "PlanTrigger" NOT NULL DEFAULT 'GENERATE',
ADD COLUMN     "planDate" DATE,
ADD COLUMN     "basedOnAnalysisRunId" TEXT,
ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "archivedReason" TEXT;
UPDATE "StudyPlan" SET "planDate" = "createdAt"::date WHERE "planDate" IS NULL;
ALTER TABLE "StudyPlan" ALTER COLUMN "planDate" SET NOT NULL;

-- AlterTable: tasks keep a snapshot of their topic so history survives re-analysis
ALTER TABLE "StudyTask" ADD COLUMN     "topicName" TEXT,
ADD COLUMN     "subjectName" TEXT,
ADD COLUMN     "partIndex" INTEGER,
ADD COLUMN     "partCount" INTEGER,
ADD COLUMN     "originalDate" DATE,
ADD COLUMN     "actualMinutes" INTEGER,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "priorityScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tier" "PriorityTier" NOT NULL DEFAULT 'SHOULD',
ADD COLUMN     "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "carriedFromTaskId" TEXT;
UPDATE "StudyTask" AS t
   SET "topicName" = tp."name", "subjectName" = s."name"
  FROM "Topic" tp JOIN "Subject" s ON s."id" = tp."subjectId"
 WHERE tp."id" = t."topicId";
UPDATE "StudyTask" SET "topicName" = '' WHERE "topicName" IS NULL;
UPDATE "StudyTask" SET "subjectName" = '' WHERE "subjectName" IS NULL;
ALTER TABLE "StudyTask" ALTER COLUMN "topicName" SET NOT NULL;
ALTER TABLE "StudyTask" ALTER COLUMN "subjectName" SET NOT NULL;

-- A task outlives its topic: re-analysis replaces topics, but finished work must not disappear.
ALTER TABLE "StudyTask" ALTER COLUMN "topicId" DROP NOT NULL;
ALTER TABLE "StudyTask" DROP CONSTRAINT "StudyTask_topicId_fkey";
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StudyTask_planId_status_idx" ON "StudyTask"("planId", "status");
