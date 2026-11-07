import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudyDb } from './core/db';
import type { AnswerRec, Progress, SessionRec } from './core/types';
import type { PackRow, QuestionRow } from './core/db';
import { AppCtx, describeError, useHash, usePrefs, type Ctx } from './ui/ctx';
import { Settings } from './ui/data';
import { History, Home, Manage, Review, Setup } from './ui/pages';
import { Quiz, Result } from './ui/quiz';

const NAV: [string, string][] = [['', 'ホーム'], ['setup', '学習'], ['review', '復習'], ['history', '履歴'], ['manage', '問題'], ['settings', '設定']];

export function App({ onUpdateReady }: { onUpdateReady: { current: (() => void) | null } }) {
  const [db, setDb] = useState<StudyDb | null>(null);
  const [fatal, setFatal] = useState('');
  const [data, setData] = useState<{ packs: PackRow[]; questions: QuestionRow[]; progress: Map<string, Progress>; answers: AnswerRec[]; sessions: SessionRec[] }>({
    packs: [], questions: [], progress: new Map(), answers: [], sessions: [],
  });
  const [toastMsg, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const [update, setUpdate] = useState(false);
  const prefs = usePrefs();
  const { path, query } = useHash();

  useEffect(() => { StudyDb.open().then(setDb).catch((e) => setFatal(describeError(e))); }, []);
  useEffect(() => { onUpdateReady.current = () => setUpdate(true); }, [onUpdateReady]);
  useEffect(() => { document.documentElement.dataset.font = prefs.fontSize; }, [prefs.fontSize]);

  const reload = useCallback(async () => {
    if (!db) return;
    const [packs, questions, progress, answers, sessions] = await Promise.all([db.listPacks(), db.latestQuestions(), db.allProgress(), db.allAnswers(), db.listSessions()]);
    setData({ packs, questions, progress: new Map(progress.map((p) => [p.questionId, p])), answers, sessions });
  }, [db]);
  useEffect(() => { void reload(); }, [reload]);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    if (kind === 'ok') setTimeout(() => setToast(null), 5000);
  }, []);

  const ctx = useMemo<Ctx | null>(() => (db ? { db, ...data, reload, toast, ...prefs } : null), [db, data, reload, toast, prefs]);

  if (fatal) return <main className="wrap"><p className="warn">この端末では保存領域(IndexedDB)を開けませんでした: {fatal}<br />プライベートブラウズでは利用できない場合があります。</p></main>;
  if (!ctx) return <main className="wrap"><p>読み込み中…</p></main>;

  const [page = '', arg = ''] = path;
  let body;
  switch (page) {
    case 'setup': body = <Setup query={query} />; break;
    case 'review': body = <Review />; break;
    case 'history': body = <History />; break;
    case 'manage': body = <Manage />; break;
    case 'settings': body = <Settings />; break;
    case 'quiz': body = <Quiz key={arg} id={arg} />; break;
    case 'result': body = <Result key={arg} id={arg} />; break;
    default: body = <Home />;
  }
  return (
    <AppCtx.Provider value={ctx}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>本文へ</a>
      <header className="top">
        <h1>Claude資格 問題集</h1>
        <nav aria-label="メイン">
          {NAV.map(([k, l]) => <a key={k} href={`#/${k}`} aria-current={page === k ? 'page' : undefined}>{l}</a>)}
        </nav>
      </header>
      {update && <div className="banner" role="status">新しいバージョンがあります。<button type="button" className="btn" onClick={() => { navigator.serviceWorker.getRegistration().then((r) => r?.waiting?.postMessage('SKIP_WAITING')); }}>更新して再読み込み</button> (学習履歴は消えません)</div>}
      {toastMsg && <div className={'toast ' + toastMsg.kind} role={toastMsg.kind === 'err' ? 'alert' : 'status'}>{toastMsg.msg} <button type="button" className="btn link" onClick={() => setToast(null)}>閉じる</button></div>}
      <main className="wrap" id="main" tabIndex={-1}>{body}</main>
    </AppCtx.Provider>
  );
}
