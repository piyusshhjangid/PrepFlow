import {
  getPlanResponseSchema,
  planGenerationResponseSchema,
  taskActionResponseSchema,
  todayResponseSchema,
  topicDetailResponseSchema,
  type GetPlanResponse,
  type PlanGenerationResponse,
  type RebalanceInput,
  type TaskActionResponse,
  type TodayResponse,
  type TopicDetailResponse,
  addMaterialResponseSchema,
  analysisResultResponseSchema,
  latestAnalysisResponseSchema,
  startAnalysisResponseSchema,
  type AnalysisResultResponse,
  type LatestAnalysisResponse,
  type StartAnalysisResponse,
  createProfileResponseSchema,
  examResponseSchema,
  listMaterialsResponseSchema,
  type AddMaterialResponse,
  type CreateProfileInput,
  type CreateProfileResponse,
  type ExamResponse,
  type ListMaterialsResponse,
  type UpdateExamInput,
  type ReviewTopicInput,
} from '@prepflow/shared';
import { apiRequest } from './http';

export const api = {
  createProfile: (input: CreateProfileInput): Promise<CreateProfileResponse> =>
    apiRequest('/api/profiles', {
      method: 'POST',
      json: input,
      schema: createProfileResponseSchema,
    }),

  getExam: (examId: string): Promise<ExamResponse> =>
    apiRequest(`/api/exams/${examId}`, { schema: examResponseSchema }),

  updateExam: (examId: string, input: UpdateExamInput): Promise<ExamResponse> =>
    apiRequest(`/api/exams/${examId}`, {
      method: 'PATCH',
      json: input,
      schema: examResponseSchema,
    }),

  listMaterials: (examId: string): Promise<ListMaterialsResponse> =>
    apiRequest(`/api/exams/${examId}/materials`, { schema: listMaterialsResponseSchema }),

  addText: (examId: string, text: string): Promise<AddMaterialResponse> =>
    apiRequest(`/api/exams/${examId}/materials/text`, {
      method: 'POST',
      json: { text },
      schema: addMaterialResponseSchema,
    }),

  uploadPdf: (examId: string, file: File): Promise<AddMaterialResponse> => {
    const form = new FormData();
    form.append('file', file);
    return apiRequest(`/api/exams/${examId}/materials/pdf`, {
      method: 'POST',
      form,
      schema: addMaterialResponseSchema,
    });
  },

  deleteMaterial: (materialId: string): Promise<void> =>
    apiRequest(`/api/materials/${materialId}`, { method: 'DELETE' }),

  startAnalysis: (examId: string): Promise<StartAnalysisResponse> =>
    apiRequest(`/api/exams/${examId}/analysis`, {
      method: 'POST',
      schema: startAnalysisResponseSchema,
    }),

  latestAnalysis: (examId: string): Promise<LatestAnalysisResponse> =>
    apiRequest(`/api/exams/${examId}/analysis/latest`, { schema: latestAnalysisResponseSchema }),

  analysisResult: (examId: string): Promise<AnalysisResultResponse> =>
    apiRequest(`/api/exams/${examId}/analysis/result`, { schema: analysisResultResponseSchema }),

  updateTopic: (
    examId: string,
    topicId: string,
    input: ReviewTopicInput,
  ): Promise<AnalysisResultResponse> =>
    apiRequest(`/api/exams/${examId}/topics/${topicId}`, {
      method: 'PATCH',
      json: input,
      schema: analysisResultResponseSchema,
    }),

  deleteTopic: (examId: string, topicId: string): Promise<void> =>
    apiRequest(`/api/exams/${examId}/topics/${topicId}`, { method: 'DELETE' }),

  // ---- planning (Checkpoint D). `date` is the browser's local calendar date.
  generatePlan: (examId: string, planDate: string): Promise<PlanGenerationResponse> =>
    apiRequest(`/api/exams/${examId}/plan`, {
      method: 'POST',
      json: { planDate },
      schema: planGenerationResponseSchema,
    }),

  getPlan: (examId: string, date: string): Promise<GetPlanResponse> =>
    apiRequest(`/api/exams/${examId}/plan?date=${date}`, { schema: getPlanResponseSchema }),

  getToday: (examId: string, date: string): Promise<TodayResponse> =>
    apiRequest(`/api/exams/${examId}/plan/today?date=${date}`, { schema: todayResponseSchema }),

  rebalance: (examId: string, input: Partial<RebalanceInput>): Promise<PlanGenerationResponse> =>
    apiRequest(`/api/exams/${examId}/plan/rebalance`, {
      method: 'POST',
      json: input,
      schema: planGenerationResponseSchema,
    }),

  getTopic: (examId: string, topicId: string, date: string): Promise<TopicDetailResponse> =>
    apiRequest(`/api/exams/${examId}/topics/${topicId}?date=${date}`, {
      schema: topicDetailResponseSchema,
    }),

  taskAction: (
    taskId: string,
    action: 'start' | 'complete' | 'skip' | 'uncomplete',
    date: string,
  ): Promise<TaskActionResponse> =>
    apiRequest(`/api/study-tasks/${taskId}/${action}`, {
      method: 'POST',
      json: { planDate: date },
      schema: taskActionResponseSchema,
    }),
};
