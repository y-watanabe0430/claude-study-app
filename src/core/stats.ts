import type { AnswerRec, Progress, Question } from './types';

export interface QStat {
  /** 実際に回答した回数 (模擬の未回答は含まない) */
  answeredCount: number;
  /** 初回の結果 (未回答の模擬は不正解) */
  first: AnswerRec;
  /** 直近の結果 */
  last: AnswerRec;
}

/** 初回成績と直近成績を区別するため、問題ごとに最初と最後の回答を持つ */
export function questionStats(answers: AnswerRec[]): Map<string, QStat> {
  const sorted = [...answers].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.attempt - b.attempt);
  const m = new Map<string, QStat>();
  for (const a of sorted) {
    const cur = m.get(a.questionId);
    if (!cur) m.set(a.questionId, { answeredCount: a.answered ? 1 : 0, first: a, last: a });
    else {
      cur.last = a;
      if (a.answered) cur.answeredCount++;
    }
  }
  return m;
}

export type Filter = 'all' | 'first' | 'wrong' | 'unsure' | 'bookmark' | 'due';
export const FILTER_LABELS: Record<Filter, string> = {
  all: 'すべて',
  first: '未回答・初めて解く問題',
  wrong: '直近で間違えた問題',
  unsure: 'あやふやな問題 (正解でも対象)',
  bookmark: 'ブックマーク',
  due: '復習期限が来た問題',
};

export function filterPool<T extends Question>(
  qs: T[],
  filter: Filter,
  stats: Map<string, QStat>,
  progress: Map<string, Progress>,
  now: Date = new Date(),
): T[] {
  return qs.filter((q) => {
    const s = stats.get(q.id);
    const p = progress.get(q.id);
    switch (filter) {
      case 'all': return true;
      case 'first': return !s || s.answeredCount === 0;
      case 'wrong': return !!s && !s.last.correct;
      case 'unsure': return !!s && (s.last.confidence === 'unsure' || s.last.confidence === 'unknown');
      case 'bookmark': return !!p?.bookmarked;
      case 'due': return !!p?.needsReview && !!p.dueAt && new Date(p.dueAt) <= now;
    }
  });
}

/** duplicateGroupId が同じ問題からは1問だけ出す (分野成績の水増し防止) */
export function onePerGroup<T extends Question>(qs: T[]): T[] {
  const seen = new Set<string>();
  return qs.filter((q) => {
    if (!q.duplicateGroupId) return true;
    if (seen.has(q.duplicateGroupId)) return false;
    seen.add(q.duplicateGroupId);
    return true;
  });
}
