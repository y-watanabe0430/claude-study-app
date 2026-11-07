import { useMemo, useState } from 'react';
import { questionStats, filterPool, onePerGroup, FILTER_LABELS, type Filter } from '../core/stats';
import { createSession } from '../core/session';
import { EXAMS, EXAM_NAMES, type Exam, type Mode } from '../core/types';
import { fmtJst } from '../core/util';
import { describeError, go, useApp } from './ctx';
import { ImportPanel } from './data';
import { Text } from './parts';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export function Home() {
  const { questions, progress, answers } = useApp();
  const stats = useMemo(() => questionStats(answers), [answers]);
  const now = new Date();
  return (
    <div>
      <h2>ホーム</h2>
      {questions.length === 0 && (
        <div className="notice">
          <p><strong>まだ問題が登録されていません。</strong>下の「問題を取り込む」で問題パック(JSON/ZIP)を読み込んでください。動作確認には同梱のサンプル(<code>sample-pack.ja.json</code>)が使えます。</p>
        </div>
      )}
      <div className="cards">
        {EXAMS.map((e) => {
          const qs = questions.filter((q) => q.exam === e);
          const ready = qs.filter((q) => q.status === 'ready');
          const done = ready.filter((q) => (stats.get(q.id)?.answeredCount ?? 0) > 0);
          const due = qs.filter((q) => { const p = progress.get(q.id); return p?.needsReview && p.dueAt && new Date(p.dueAt) <= now; });
          const wrong = qs.filter((q) => stats.get(q.id) && !stats.get(q.id)!.last.correct);
          const lastCorrect = ready.filter((q) => stats.get(q.id)?.last.correct).length;
          return (
            <section key={e} className="card">
              <h3>{e}<small> {EXAM_NAMES[e]}</small></h3>
              {qs.length === 0 ? <p className="hint">0問 — 問題パックを取り込んでください</p> : (
                <ul>
                  <li>出題可能 {ready.length}問{qs.length - ready.length > 0 && <>　(要確認で隔離 {qs.length - ready.length}問)</>}</li>
                  <li>未学習 {ready.length - done.length}問</li>
                  <li>要復習 {wrong.length}問 / 期限到来 {due.length}問</li>
                  <li>直近の正答率 {pct(lastCorrect, done.length)}</li>
                </ul>
              )}
              <a className={'btn' + (ready.length ? ' primary' : '')} href={`#/setup?exam=${e}`} aria-disabled={!ready.length}>この資格を学習</a>
            </section>
          );
        })}
      </div>
      <h3>問題を取り込む</h3>
      <ImportPanel />
    </div>
  );
}

export function Manage() {
  const { questions, packs } = useApp();
  const [exam, setExam] = useState<'all' | Exam>('all');
  const [status, setStatus] = useState<'all' | 'ready' | 'needs_review' | 'pending'>('all');
  const [text, setText] = useState('');
  const list = questions.filter((q) =>
    (exam === 'all' || q.exam === exam) &&
    (status === 'all' || (status === 'pending' ? q.translationStatus === 'pending' : q.status === status)) &&
    (!text || (q.ja.stem + q.domainJa + q.id).toLowerCase().includes(text.toLowerCase())));
  const ready = questions.filter((q) => q.status === 'ready').length;
  const lessons = packs.flatMap((p) => p.lessons);
  return (
    <div>
      <h2>問題管理</h2>
      <p>登録 {questions.length}問 / 準備完了 <strong>{ready}</strong>問 / 要確認 (隔離・通常出題なし) <strong>{questions.length - ready}</strong>問 / 翻訳未完了 {questions.filter((q) => q.translationStatus === 'pending').length}問 / 図表不足の可能性: 下表の「図」欄を確認</p>
      <div className="filters">
        <label>資格 <select value={exam} onChange={(e) => setExam(e.target.value as 'all' | Exam)}><option value="all">すべて</option>{EXAMS.map((e) => <option key={e}>{e}</option>)}</select></label>
        <label>状態 <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">すべて</option><option value="ready">準備完了</option><option value="needs_review">要確認</option><option value="pending">翻訳未完了</option></select></label>
        <label>検索 <input type="search" value={text} onChange={(e) => setText(e.target.value)} /></label>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>ID</th><th>資格</th><th>分野</th><th>形式</th><th>出典</th><th>状態</th><th>翻訳</th><th>図</th><th>類似G</th></tr></thead>
          <tbody>
            {list.map((q) => (
              <tr key={q.key}>
                <td title={q.ja.stem}>{q.id}<br /><small>rev {q.revision}</small></td><td>{q.exam}</td><td>{q.domainJa}</td><td>{q.type}</td>
                <td>{q.source.sourceId}</td>
                <td>{q.status === 'ready' ? '準備完了' : <strong>要確認</strong>}{q.reviewNotes?.length ? <small><br />{q.reviewNotes.join(' / ')}</small> : null}</td>
                <td>{q.translationStatus}</td><td>{q.assets?.length ?? 0}</td><td>{q.duplicateGroupId ?? ''}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={9}>該当する問題がありません</td></tr>}
          </tbody>
        </table>
      </div>
      {lessons.length > 0 && (
        <>
          <h3>補足講義 ({lessons.length}件)</h3>
          {lessons.map((l, i) => (
            <details key={String(l.id ?? i)} className="qcard">
              <summary>{String(l.titleJa ?? l.id)}</summary>
              {typeof l.leadJa === 'string' && <Text>{l.leadJa}</Text>}
              {Array.isArray(l.points) && <ul>{(l.points as unknown[]).map((p, k) => <li key={k}>{typeof p === 'string' ? p : JSON.stringify(p)}</li>)}</ul>}
            </details>
          ))}
        </>
      )}
      <h3>取り込み済みパック</h3>
      <ul>{packs.map((p) => <li key={p.packId}>{p.titleJa} (v{p.version}, {p.questionCount}問, {fmtJst(p.importedAt)})</li>)}</ul>
    </div>
  );
}

export function Setup({ query }: { query: URLSearchParams }) {
  const { db, questions, progress, answers, reload, toast } = useApp();
  const [exam, setExam] = useState<Exam | 'mixed'>((query.get('exam') as Exam) || 'mixed');
  const [mode, setMode] = useState<Mode>('practice');
  const [filter, setFilter] = useState<Filter>((query.get('filter') as Filter) || 'all');
  const [count, setCount] = useState(10);
  const [shuffleChoices, setSC] = useState(true);
  const [shuffleQuestions, setSQ] = useState(true);
  const [limit, setLimit] = useState(15);
  const [mixSources, setMix] = useState(true);
  const [dedupe, setDedupe] = useState(false);
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => questionStats(answers), [answers]);
  const pool = useMemo(() => {
    let qs = questions.filter((q) => q.status === 'ready' && (exam === 'mixed' || q.exam === exam));
    qs = filterPool(qs, filter, stats, progress);
    if (!mixSources) qs = qs.filter((q) => q.source.sourceId === (qs[0]?.source.sourceId ?? ''));
    return dedupe ? onePerGroup(qs) : qs;
  }, [questions, exam, filter, stats, progress, mixSources, dedupe]);

  const start = async () => {
    setBusy(true);
    try {
      const s = createSession(pool, { exam, mode, shuffleChoices, shuffleQuestions, limitMinutes: mode === 'mock' ? limit : null, count: Math.min(count, pool.length) });
      await db.saveSession(s);
      await reload();
      go(`quiz/${s.id}`);
    } catch (e) { toast('開始できませんでした: ' + describeError(e), 'err'); }
    setBusy(false);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void start(); }} className="form" noValidate>
      <h2>学習設定</h2>
      <label>資格<select value={exam} onChange={(e) => setExam(e.target.value as Exam | 'mixed')}><option value="mixed">混在 (すべて)</option>{EXAMS.map((e) => <option key={e} value={e}>{e} {EXAM_NAMES[e]}</option>)}</select></label>
      <label>モード<select value={mode} onChange={(e) => setMode(e.target.value as Mode)}><option value="practice">練習 (1問ごとに解説)</option><option value="mock">模擬 (提出まで正解を隠す・時間制限)</option></select></label>
      <label>出題対象<select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>{(Object.keys(FILTER_LABELS) as Filter[]).map((f) => <option key={f} value={f}>{FILTER_LABELS[f]}</option>)}</select></label>
      <label>問題数 (最大 {pool.length})<input type="number" min={1} max={Math.max(1, pool.length)} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></label>
      {mode === 'mock' && <label>制限時間 (分)<input type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))} /></label>}
      <label className="inline"><input type="checkbox" checked={shuffleQuestions} onChange={(e) => setSQ(e.target.checked)} /> 問題の順番をシャッフル</label>
      <label className="inline"><input type="checkbox" checked={shuffleChoices} onChange={(e) => setSC(e.target.checked)} /> 選択肢の順番をシャッフル</label>
      <label className="inline"><input type="checkbox" checked={mixSources} onChange={(e) => setMix(e.target.checked)} /> 複数の教材(出典)を混在させる</label>
      <label className="inline"><input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> 類似問題グループから1問ずつ出す</label>
      {pool.length === 0 && <p className="warn">この条件で出題できる問題がありません。{questions.length === 0 && <a href="#/">問題を取り込んでください</a>}</p>}
      <button className="btn primary wide" type="submit" disabled={busy || pool.length === 0}>開始する ({Math.min(count, pool.length)}問)</button>
    </form>
  );
}

export function Review() {
  const { questions, progress, answers } = useApp();
  const stats = useMemo(() => questionStats(answers), [answers]);
  const ready = questions.filter((q) => q.status === 'ready');
  const defs: { f: Filter; desc: string }[] = [
    { f: 'wrong', desc: '直近の回答が不正解、または模擬で未回答だった問題' },
    { f: 'unsure', desc: '「あやふや」「分からない」と答えた問題 (正解でも対象)' },
    { f: 'bookmark', desc: 'ブックマークした問題' },
    { f: 'due', desc: '復習日が来た問題' },
  ];
  return (
    <div>
      <h2>復習</h2>
      <div className="cards">
        {defs.map(({ f, desc }) => {
          const n = filterPool(ready, f, stats, progress).length;
          return (
            <section className="card" key={f}>
              <h3>{FILTER_LABELS[f]}　{n}問</h3>
              <p className="hint">{desc}</p>
              <a className={'btn' + (n ? ' primary' : '')} href={`#/setup?filter=${f}`}>この条件で出題</a>
            </section>
          );
        })}
      </div>
      <h3>再出題の規則</h3>
      <p>間違えた・「あやふや」「分からない」とした問題は<strong>1日後</strong>に復習対象になります。正解して「理解した」を選ぶたびに、間隔が <strong>1日 → 3日 → 7日 → 14日</strong> と延び、14日の復習を終えると対象から外れます。復習で再び間違えたり「あやふや」にすると1日後に戻ります。</p>
    </div>
  );
}

export function History() {
  const { sessions, answers, questions } = useApp();
  const stats = useMemo(() => questionStats(answers), [answers]);
  const first = [...stats.values()];
  const firstRate = pct(first.filter((s) => s.first.correct).length, first.length);
  const lastRate = pct(first.filter((s) => s.last.correct).length, first.length);
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const nameOf = (id: string) => questions.find((q) => q.id === id)?.ja.stem ?? id;
  return (
    <div>
      <h2>履歴</h2>
      <p>学習した問題 {first.length}問　<strong>初回の正答率 {firstRate}</strong>　<strong>直近の正答率 {lastRate}</strong>　(全回答 {answers.length}件を保存)</p>
      <ul className="hist">
        {sorted.map((s) => {
          const a = answers.filter((x) => x.sessionId === s.id);
          const ok = a.filter((x) => x.correct).length;
          return (
            <li key={s.id}>
              <a href={s.status === 'in_progress' ? `#/quiz/${s.id}` : `#/result/${s.id}`}>
                {fmtJst(s.startedAt)}　{s.mode === 'mock' ? '模擬' : '練習'}　{s.exam}
                {s.status === 'in_progress' ? <strong>途中 (再開する)</strong> : `${ok}/${s.questionRefs.length}問正解`}
              </a>
            </li>
          );
        })}
        {sorted.length === 0 && <li>まだ履歴がありません</li>}
      </ul>
      <details><summary>問題ごとの初回/直近</summary>
        <div className="tablewrap"><table><thead><tr><th>問題</th><th>回答回数</th><th>初回</th><th>直近</th></tr></thead>
          <tbody>{[...stats.entries()].map(([id, s]) => <tr key={id}><td>{nameOf(id).slice(0, 40)}</td><td>{s.answeredCount}</td><td>{s.first.correct ? '○' : '×'}</td><td>{s.last.correct ? '○' : '×'}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  );
}
