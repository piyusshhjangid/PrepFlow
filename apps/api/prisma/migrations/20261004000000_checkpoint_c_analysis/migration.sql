-- Checkpoint C: exam-level analysis runs (all materials), real pipeline stages, richer topics.
-- Existing AnalysisRun rows (none are created before Checkpoint C) are discarded: they pointed at a
-- single material and recorded no result.

-- AlterEnum: new status
ALTER TYPE "AnalysisStatus" ADD VALUE 'PARTIAL';

-- AlterEnum: replace the stage list (no row can reference the old values once AnalysisRun is rebuilt)
DROP TABLE "AnalysisRun" CASCADE;
DROP TYPE "AnalysisStage";
CREATE TYPE "AnalysisStage" AS ENUM ('LOADING', 'CHUNKING', 'ANALYZING', 'VALIDATING', 'MERGING', 'PERSISTING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EffortClass" AS ENUM ('QUICK', 'STANDARD', 'EXTENSIVE');

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "AnalysisStage",
    "fingerprint" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "processedChunks" INTEGER NOT NULL DEFAULT 0,
    "failedChunks" INTEGER NOT NULL DEFAULT 0,
    "topicCount" INTEGER NOT NULL DEFAULT 0,
    "droppedTopics" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "validationFailures" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "effortClass" "EffortClass",
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "statedEmphasis" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weakHint" TEXT;

-- CreateIndex
CREATE INDEX "AnalysisRun_examId_createdAt_idx" ON "AnalysisRun"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_examId_fingerprint_idx" ON "AnalysisRun"("examId", "fingerprint");

-- CreateIndex
CREATE INDEX "Topic_parentId_idx" ON "Topic"("parentId");

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
