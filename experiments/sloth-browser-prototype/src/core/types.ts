import type { ISODate } from './dates';

export type Level = 'low' | 'medium' | 'high';
/** Where a topic list came from. Shown to the student and written into every export, so sample or rule-based topics are never mistaken for model output. */
export type Origin = 'model' | 'outline' | 'sample';
/**
 * How directly the quote's own words relate to the topic's name (computed by code, see core/support.ts).
 * It checks the link between a topic and its quote; it does not say the topic is correct or will be examined.
 */
export type Support = 'direct' | 'nearby' | 'weak';
/** Who or what set the importance label: a signal found in the material, the model, a default, or the student. */
export type ImportanceBasis = 'material' | 'model' | 'default' | 'student';
export type Effort = 'short' | 'medium' | 'long';

/** A passage of the student's own material. `quote` is always copied from the source, never from the model. */
export interface Evidence {
  quote: string;
  start: number;
  end: number;
  /** 1-based PDF page, derived by code from the extracted text; null for pasted text. */
  page: number | null;
}

export interface Topic {
  id: string;
  name: string;
  /** Model-written explanation. Not a source fact. */
  description: string;
  effort: Effort;
  /** 1 easy .. 3 hard, as judged by the model from the material. A suggestion. */
  difficulty: 1 | 2 | 3;
  /** Model suggestion (defaults to medium); the student can change it. */
  importance: Level;
  /** Ids of topics the model suggests understanding first. */
  prerequisites: string[];
  /** Study estimate in minutes, computed by code from effort and difficulty; editable. */
  minutes: number;
  /** `verified`: the quote was found in the source. `unverified`: it was not, so the topic is held back. */
  status: 'verified' | 'unverified';
  /** Why a topic is unverified (machine-readable); shown to the student in plain words. */
  unverifiedReason?: 'empty' | 'too-short' | 'too-long' | 'ellipsis' | 'not-found';
  evidence: Evidence | null;
  /** Optional so state saved by earlier versions still loads. */
  origin?: Origin;
  support?: Support;
  importanceBasis?: ImportanceBasis;
  /** The passage of the material that signals importance (copied from the source), when one was found. */
  importanceCue?: string;
  /** What the model suggested before code or the student changed it. */
  suggestedImportance?: Level;
  /** The estimate code computed from effort and difficulty, kept so a student edit can be shown as an edit. */
  autoMinutes?: number;
  /** The student flagged this as a weak spot. */
  weak: boolean;
  /** The student already understands it. */
  done: boolean;
  /** Whether to plan it. Unverified topics start excluded. */
  include: boolean;
  /** Position in the material, used for stable tie-breaking. */
  order: number;
}

export interface TopicProgress {
  studiedMinutes: number;
  lastStudiedOn: ISODate | null;
  reviewsDone: number;
}

export type ProgressMap = Record<string, TopicProgress>;
