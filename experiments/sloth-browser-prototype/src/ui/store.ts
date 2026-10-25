import { z } from 'zod';
import type { AnalysisReport } from '../ai/analyze';
import { DEFAULT_MODEL } from '../ai/ollama';
import { addDays, isISODate, localToday, type ISODate } from '../core/dates';
import { completeTask, DEFAULTS, type PlanTask } from '../core/planner';
import { clampMinutes } from '../core/topics';
import type { ProgressMap, Topic } from '../core/types';

export interface Settings {
  goal: string;
  examDate: ISODate;
  minutesPerDay: number;
  sessionMinutes: number;
  /** Free text: topics the student already understands. */
  knownTopics: string;
  model: string;
}

export interface Material {
  text: string;
  source: 'paste' | 'pdf';
  fileName?: string;
  pageCount?: number;
  lowTextPages?: number;
}

export interface AppState {
  version: 1;
  settings: Settings;
  material: Material;
  topics: Topic[];
  report: AnalysisReport | null;
  progress: ProgressMap;
  /** Snapshots for "undo", most recent last. */
  history: ProgressMap[];
}

export const HISTORY_LIMIT = 20;
export const STORAGE_KEY = 'prepflow-sloth:v1';

export function initialState(today: ISODate = localToday()): AppState {
  return {
    version: 1,
    settings: {
      goal: '',
      examDate: addDays(today, 7),
      minutesPerDay: DEFAULTS.minutesPerDay,
      sessionMinutes: DEFAULTS.sessionMinutes,
      knownTopics: '',
      model: DEFAULT_MODEL,
    },
    material: { text: '', source: 'paste' },
    topics: [],
    report: null,
    progress: {},
    history: [],
  };
}

export type Action =
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'material'; material: Material }
  | { type: 'analyzed'; topics: Topic[]; report: AnalysisReport }
  | {
      type: 'sample';
      material: Material;
      settings: Partial<Settings>;
      topics: Topic[];
      report: AnalysisReport;
    }
  | { type: 'topic'; id: string; patch: Partial<Topic> }
  | { type: 'complete'; task: PlanTask; today: ISODate }
  | { type: 'undo' }
  | { type: 'reset'; today?: ISODate };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'material':
      return { ...state, material: action.material };
    case 'analyzed':
      return { ...state, topics: action.topics, report: action.report, history: [] };
    case 'sample':
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
        material: action.material,
        topics: action.topics,
        report: action.report,
        progress: {},
        history: [],
      };
    case 'topic':
      return {
        ...state,
        topics: state.topics.map((t) => {
          if (t.id !== action.id) return t;
          let next: Topic = { ...t, ...action.patch };
          if (action.patch.importance !== undefined && action.patch.importance !== t.importance) {
            // Remember what was suggested, and record that the student overrode it.
            next = {
              ...next,
              importanceBasis: 'student',
              suggestedImportance: t.suggestedImportance ?? t.importance,
            };
          }
          return action.patch.minutes === undefined
            ? next
            : { ...next, minutes: clampMinutes(action.patch.minutes) };
        }),
      };
    case 'complete':
      return {
        ...state,
        progress: completeTask(action.task, state.progress, action.today),
        history: [...state.history, state.progress].slice(-HISTORY_LIMIT),
      };
    case 'undo': {
      const previous = state.history.at(-1);
      return previous
        ? { ...state, progress: previous, history: state.history.slice(0, -1) }
        : state;
    }
    case 'reset':
      return {
        ...initialState(action.today),
        settings: { ...initialState(action.today).settings, model: state.settings.model },
      };
  }
}

const ProgressEntry = z.object({
  studiedMinutes: z.number().min(0).max(100_000),
  lastStudiedOn: z.string().refine(isISODate).nullable(),
  reviewsDone: z.number().int().min(0).max(100),
});
const ProgressSchema = z.record(z.string(), ProgressEntry);
const EvidenceSchema = z.object({
  quote: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  page: z.number().int().min(1).nullable(),
});
const TopicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  effort: z.enum(['short', 'medium', 'long']),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  importance: z.enum(['low', 'medium', 'high']),
  prerequisites: z.array(z.string()),
  minutes: z.number().int().min(5).max(600),
  status: z.enum(['verified', 'unverified']),
  unverifiedReason: z.enum(['empty', 'too-short', 'too-long', 'ellipsis', 'not-found']).optional(),
  evidence: EvidenceSchema.nullable(),
  weak: z.boolean(),
  done: z.boolean(),
  include: z.boolean(),
  order: z.number().int(),
  // Added after the first release; optional so earlier saved state still loads.
  origin: z.enum(['model', 'outline', 'sample']).optional(),
  support: z.enum(['direct', 'nearby', 'weak']).optional(),
  importanceBasis: z.enum(['material', 'model', 'default', 'student']).optional(),
  importanceCue: z.string().max(400).optional(),
  suggestedImportance: z.enum(['low', 'medium', 'high']).optional(),
  autoMinutes: z.number().int().min(5).max(600).optional(),
});
const PersistedSchema = z.object({
  version: z.literal(1),
  settings: z.object({
    goal: z.string().max(300),
    examDate: z.string().refine(isISODate),
    minutesPerDay: z.number().int(),
    sessionMinutes: z.number().int(),
    knownTopics: z.string().max(5000),
    model: z.string().min(1).max(100),
  }),
  material: z.object({
    text: z.string().max(200_000),
    source: z.enum(['paste', 'pdf']),
    fileName: z.string().max(300).optional(),
    pageCount: z.number().int().optional(),
    lowTextPages: z.number().int().optional(),
  }),
  topics: z.array(TopicSchema).max(300),
  report: z
    .custom<AnalysisReport>((v) => v === null || (typeof v === 'object' && v !== null))
    .nullable(),
  progress: ProgressSchema,
  history: z.array(ProgressSchema).max(HISTORY_LIMIT),
});

/** Saved data is untrusted: anything that does not match the schema is discarded, never partially used. */
export function loadState(
  storage: Pick<Storage, 'getItem'> | undefined,
  today: ISODate = localToday(),
): AppState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return initialState(today);
    const parsed = PersistedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as AppState) : initialState(today);
  } catch {
    return initialState(today);
  }
}

/** Returns false when the browser refused to store (private mode, quota). */
export function saveState(storage: Pick<Storage, 'setItem'> | undefined, state: AppState): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return storage !== undefined;
  } catch {
    return false;
  }
}

export function clearState(storage: Pick<Storage, 'removeItem'> | undefined): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
