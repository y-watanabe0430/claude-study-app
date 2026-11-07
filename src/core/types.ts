export const EXAMS = ['CCDV-F', 'CCAO-F', 'CCAR-P', 'CCAR-F'] as const;
export type Exam = (typeof EXAMS)[number];
export const EXAM_NAMES: Record<Exam, string> = {
  'CCDV-F': '開発者・基礎',
  'CCAO-F': 'アソシエイト・基礎',
  'CCAR-P': 'アーキテクト・上級',
  'CCAR-F': 'アーキテクト・基礎',
};
export type QType = 'single' | 'multiple' | 'matching' | 'ordering';

export interface Item { id: string; textJa: string }
export interface Choice extends Item { explanationJa?: string; originalLabel?: string }
export interface Asset { path: string; altJa: string; placement: 'stem' | 'explanation'; sourceFigureId?: string; sourceCardId?: string }

export interface Question {
  id: string;
  revision: number;
  exam: Exam;
  type: QType;
  domainJa: string;
  status: 'ready' | 'needs_review';
  translationStatus: 'original_ja' | 'translated_ja' | 'pending';
  ja: { stem: string; explanation: string; background?: string; scenario?: string };
  choices?: Choice[];
  requiredSelections?: number;
  source: { sourceId: string; originalId: string; url?: string; [k: string]: unknown };
  correctAnswer: { choiceIds?: string[]; matches?: Record<string, string>; order?: string[] };
  matching?: { prompts: Item[]; candidates: Item[]; allowReuse: boolean };
  items?: Item[];
  assets?: Asset[];
  reviewNotes?: string[];
  shuffleChoices?: boolean;
  supplemental?: Record<string, unknown>;
  originalText?: Record<string, unknown>;
  duplicateGroupId?: string | null;
}

export interface QuestionPack {
  schemaVersion: '1.0';
  packId: string;
  version: string;
  titleJa: string;
  language: 'ja';
  createdAt?: string;
  questions: Question[];
  lessons?: Record<string, unknown>[];
}

/** 利用者の回答。type ごとに使う項目が違う */
export interface Response {
  choiceIds?: string[];
  matches?: Record<string, string>;
  order?: string[];
}

export type Mode = 'practice' | 'mock';
export type Confidence = 'understood' | 'unsure' | 'unknown';

/** 保存済みの問題。改訂されても履歴を再現できるよう revision ごとに残す */
export interface StoredQuestion extends Question {
  contentHash: string;
  packId: string;
  packVersion: string;
}

export interface SessionRec {
  id: string;
  exam: Exam | 'mixed';
  mode: Mode;
  questionRefs: { id: string; revision: number }[];
  /** 固定済みの選択肢/項目の表示順 (questionId -> id配列) */
  displayOrder: Record<string, string[]>;
  startedAt: string; // UTC ISO
  /** 絶対期限 (UTC ISO)。模擬のみ */
  deadline: string | null;
  submittedAt: string | null;
  status: 'in_progress' | 'submitted' | 'timed_out';
  currentIndex: number;
  /** 作業中の下書き回答 (確定前) */
  drafts: Record<string, Response>;
  /** 練習で確定済みの問題 */
  committed: string[];
  settings: { shuffle: boolean; limitMinutes: number | null };
  /** 問題ごとの累積所要時間 (ms) */
  elapsedMs: Record<string, number>;
  attempt: Record<string, number>;
}

export interface AnswerRec {
  answerId: string;
  sessionId: string;
  questionId: string;
  revision: number;
  displayOrder: string[];
  response: Response;
  correctAnswer: Question['correctAnswer'];
  correct: boolean;
  answered: boolean;
  timeMs: number;
  confidence: Confidence | null;
  answeredAt: string;
  attempt: number;
}

export interface Progress {
  questionId: string;
  bookmarked: boolean;
  note: string;
  needsReview: boolean;
  intervalDays: number;
  dueAt: string | null;
  updatedAt: string;
}
