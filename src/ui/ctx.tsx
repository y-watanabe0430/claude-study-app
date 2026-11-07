import { createContext, useContext, useEffect, useState } from 'react';
import type { PackRow, QuestionRow } from '../core/db';
import { StudyDb } from '../core/db';
import type { AnswerRec, Progress, SessionRec } from '../core/types';

export type FontSize = 's' | 'm' | 'l';

export interface Ctx {
  db: StudyDb;
  packs: PackRow[];
  questions: QuestionRow[];
  progress: Map<string, Progress>;
  answers: AnswerRec[];
  sessions: SessionRec[];
  reload: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  fontSize: FontSize;
  setFontSize: (f: FontSize) => void;
  showOriginal: boolean;
  setShowOriginal: (b: boolean) => void;
}

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = (): Ctx => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppCtx がありません');
  return c;
};

/** 保存エラー(容量超過など)を利用者に分かる日本語にする */
export function describeError(e: unknown): string {
  if (e instanceof DOMException && e.name === 'QuotaExceededError') {
    return '端末の保存容量が足りず保存できませんでした。バックアップを書き出してから不要なデータを整理してください。';
  }
  return e instanceof Error ? e.message : String(e);
}

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動作する */ } };

export function usePrefs() {
  const [fontSize, setFs] = useState<FontSize>(() => (lsGet('fontSize') as FontSize) || 'm');
  const [showOriginal, setSo] = useState(() => lsGet('showOriginal') === '1');
  return {
    fontSize, showOriginal,
    setFontSize: (f: FontSize) => { setFs(f); lsSet('fontSize', f); },
    setShowOriginal: (b: boolean) => { setSo(b); lsSet('showOriginal', b ? '1' : '0'); },
  };
}

/** location.hash ベースの簡易ルーター。リロードしても同じ画面に戻れる */
export function useHash(): { path: string[]; query: URLSearchParams } {
  const read = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [p = '', q = ''] = h.split('?');
    return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const f = () => setV(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return v;
}
export const go = (to: string) => { location.hash = '#/' + to.replace(/^\//, ''); };
