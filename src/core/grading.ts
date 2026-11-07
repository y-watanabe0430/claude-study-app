import type { Question, Response } from './types';

export function isAnswered(q: Question, r: Response | undefined): boolean {
  if (!r) return false;
  switch (q.type) {
    case 'single':
    case 'multiple':
      return (r.choiceIds?.length ?? 0) > 0;
    case 'matching':
      return q.matching!.prompts.every((p) => !!r.matches?.[p.id]);
    case 'ordering':
      return (r.order?.length ?? 0) === (q.items?.length ?? -1);
  }
}

/** 「確定」可能な有効回答か。multiple は指定数ちょうど選ぶ必要がある */
export function isSubmittable(q: Question, r: Response | undefined): boolean {
  if (!isAnswered(q, r)) return false;
  if (q.type === 'single') return r!.choiceIds!.length === 1;
  if (q.type === 'multiple') {
    return r!.choiceIds!.length === (q.requiredSelections ?? q.correctAnswer.choiceIds!.length);
  }
  if (q.type === 'matching' && !q.matching!.allowReuse) {
    const vals = Object.values(r!.matches!);
    return new Set(vals).size === vals.length;
  }
  return true;
}

/** 完全一致で採点。選択順は無関係、1つ余分に選べば不正解。未回答は不正解 */
export function grade(q: Question, r: Response | undefined): boolean {
  if (!r) return false;
  switch (q.type) {
    case 'single':
    case 'multiple': {
      const a = new Set(r.choiceIds ?? []);
      const c = new Set(q.correctAnswer.choiceIds ?? []);
      return a.size === c.size && [...c].every((x) => a.has(x));
    }
    case 'matching': {
      const c = q.correctAnswer.matches ?? {};
      return q.matching!.prompts.every((p) => r.matches?.[p.id] === c[p.id]);
    }
    case 'ordering': {
      const c = q.correctAnswer.order ?? [];
      return !!r.order && r.order.length === c.length && r.order.every((x, i) => x === c[i]);
    }
  }
}

/** matching の部分一致 (補助表示のみ。採点には使わない) */
export function matchingPartial(q: Question, r: Response | undefined): { right: number; total: number } {
  const c = q.correctAnswer.matches ?? {};
  const ps = q.matching?.prompts ?? [];
  return { right: ps.filter((p) => r?.matches?.[p.id] === c[p.id]).length, total: ps.length };
}

export interface ScoreAnswer {
  questionId: string;
  correct: boolean;
  answered: boolean;
  domainJa: string;
  sourceId: string;
}
export interface ScoreRow { key: string; total: number; correct: number; unanswered: number }

/** 全出題数を分母にする (未回答は不正解)。分野集計も未回答を含む */
export function summarize(items: ScoreAnswer[]) {
  const group = (f: (i: ScoreAnswer) => string): ScoreRow[] => {
    const m = new Map<string, ScoreRow>();
    for (const i of items) {
      const k = f(i);
      const row = m.get(k) ?? { key: k, total: 0, correct: 0, unanswered: 0 };
      row.total++;
      if (i.correct) row.correct++;
      if (!i.answered) row.unanswered++;
      m.set(k, row);
    }
    return [...m.values()];
  };
  const total = items.length;
  const correct = items.filter((i) => i.correct).length;
  return {
    total,
    correct,
    unanswered: items.filter((i) => !i.answered).length,
    rate: total ? correct / total : 0,
    byDomain: group((i) => i.domainJa),
    bySource: group((i) => i.sourceId),
  };
}
