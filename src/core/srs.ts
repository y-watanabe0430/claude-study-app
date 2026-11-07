import type { Confidence } from './types';

/**
 * 再出題規則 (簡易):
 *  間隔は 1 → 3 → 7 → 14 日。
 *  「理解した」(正解時): 次の段階へ進む。14日の次は復習対象から外す。
 *  「あやふや」「分からない」、または誤答: 1日後に再出題する(段階を最初に戻す)。
 */
export const INTERVALS = [1, 3, 7, 14] as const;

export interface SrsState { intervalDays: number; needsReview: boolean; dueAt: string | null }

export function nextSrs(
  prev: { intervalDays: number } | undefined,
  outcome: Confidence | 'wrong',
  now: Date,
): SrsState {
  const day = 86400000;
  const due = (d: number) => new Date(now.getTime() + d * day).toISOString();
  if (outcome !== 'understood') return { intervalDays: 1, needsReview: true, dueAt: due(1) };
  const next = INTERVALS.find((d) => d > (prev?.intervalDays ?? 0));
  if (!next) return { intervalDays: 0, needsReview: false, dueAt: null };
  return { intervalDays: next, needsReview: true, dueAt: due(next) };
}
