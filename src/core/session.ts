import type { AnswerRec, Exam, Mode, Question, Response, SessionRec } from './types';
import { mulberry32, shuffled, uuid } from './util';

/** 「AとB」「上記すべて」など位置・他選択肢を参照する文言があればシャッフルしない */
const POSITIONAL =
  /(?:^|[^A-Za-z])[A-E]\s*(?:と|および|かつ|または|、|,|&|and|or)\s*[A-E](?:[^A-Za-z]|$)|選択肢\s*[A-E]|上記(?:の)?(?:すべて|いずれも|どれも)|すべて(?:の)?(?:選択肢|上記)|(?:どれ|いずれ)も当てはまらない/i;

export function canShuffle(q: Question): boolean {
  if (q.shuffleChoices === false) return false;
  const texts = [...(q.choices ?? []), ...(q.matching?.candidates ?? []), ...(q.items ?? [])].map((c) => c.textJa);
  return !texts.some((t) => POSITIONAL.test(t));
}

/** 表示順(選択肢/候補/項目のID配列)を決める。決めた順は session に固定保存する */
export function makeDisplayOrder(q: Question, shuffle: boolean, rnd: () => number): string[] {
  const base = q.type === 'matching' ? q.matching!.candidates : q.type === 'ordering' ? q.items! : q.choices!;
  const ids = base.map((b) => b.id);
  if (!shuffle || !canShuffle(q)) return ids;
  let out = shuffled(ids, rnd);
  if (q.type === 'ordering') {
    // 初期表示が正解順と同じにならないようにする
    for (let i = 0; i < 5 && out.join() === (q.correctAnswer.order ?? []).join(); i++) out = shuffled(ids, rnd);
  }
  return out;
}

export interface SessionOptions {
  exam: Exam | 'mixed';
  mode: Mode;
  shuffleChoices: boolean;
  shuffleQuestions: boolean;
  limitMinutes: number | null;
  count: number;
  now?: Date;
  seed?: number;
}

/** 出題可能な問題(ready のみ)から出題を作る。needs_review は混ぜない */
export function createSession(pool: Question[], o: SessionOptions): SessionRec {
  const now = o.now ?? new Date();
  const rnd = mulberry32(o.seed ?? Math.floor(Math.random() * 2 ** 32));
  const eligible = pool.filter((q) => q.status === 'ready');
  const picked = (o.shuffleQuestions ? shuffled(eligible, rnd) : eligible).slice(0, Math.max(0, o.count));
  const displayOrder: Record<string, string[]> = {};
  for (const q of picked) displayOrder[q.id] = makeDisplayOrder(q, o.shuffleChoices, rnd);
  const limit = o.mode === 'mock' ? o.limitMinutes : null;
  return {
    id: uuid(),
    exam: o.exam,
    mode: o.mode,
    questionRefs: picked.map((q) => ({ id: q.id, revision: q.revision })),
    displayOrder,
    startedAt: now.toISOString(),
    deadline: limit ? new Date(now.getTime() + limit * 60000).toISOString() : null,
    submittedAt: null,
    status: 'in_progress',
    currentIndex: 0,
    drafts: {},
    committed: [],
    settings: { shuffle: o.shuffleChoices, limitMinutes: limit },
    elapsedMs: {},
    attempt: {},
  };
}

/** 絶対期限から残り時間を求める。バックグラウンドや閉じていた時間も進む */
export function remainingMs(s: Pick<SessionRec, 'deadline'>, nowMs: number = Date.now()): number | null {
  return s.deadline ? new Date(s.deadline).getTime() - nowMs : null;
}
export function isExpired(s: Pick<SessionRec, 'deadline' | 'status'>, nowMs: number = Date.now()): boolean {
  const r = remainingMs(s, nowMs);
  return s.status === 'in_progress' && r !== null && r <= 0;
}

export function emptyResponse(q: Question): Response {
  return q.type === 'single' || q.type === 'multiple' ? { choiceIds: [] } : q.type === 'matching' ? { matches: {} } : { order: [] };
}

export type { AnswerRec };
