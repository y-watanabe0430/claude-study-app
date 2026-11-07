import { useCallback, useEffect, useRef, useState } from 'react';
import type { QuestionRow } from '../core/db';
import { isAnswered, isSubmittable, summarize, type ScoreAnswer } from '../core/grading';
import { isExpired, remainingMs } from '../core/session';
import type { AnswerRec, Confidence, Response, SessionRec } from '../core/types';
import { fmtDuration, fmtJst } from '../core/util';
import { describeError, go, useApp } from './ctx';
import { AnswerInput, Assets, Explanation, MemoBox, Text } from './parts';

function useSessionData(id: string) {
  const { db } = useApp();
  const [s, setS] = useState<SessionRec | null>(null);
  const [qs, setQs] = useState<Map<string, QuestionRow>>(new Map());
  const [answers, setAnswers] = useState<AnswerRec[]>([]);
  const [missing, setMissing] = useState(false);
  const refresh = useCallback(async () => {
    const sess = await db.getSession(id);
    if (!sess) return setMissing(true);
    const m = new Map<string, QuestionRow>();
    // 当時の revision の問題スナップショットで表示する
    for (const r of sess.questionRefs) {
      const q = await db.getQuestion(r.id, r.revision);
      if (q) m.set(r.id, q);
    }
    setQs(m);
    setAnswers(await db.answersBySession(id));
    setS(sess);
  }, [db, id]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { s, setS, qs, answers, refresh, missing };
}

function Timer({ s, now }: { s: SessionRec; now: number }) {
  const r = remainingMs(s, now);
  if (r === null) return null;
  const sec = Math.max(0, Math.ceil(r / 1000));
  return <span className={'timer' + (sec < 300 ? ' low' : '')} role="timer" aria-label={`残り時間 ${Math.floor(sec / 60)}分${sec % 60}秒`}>残り {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>;
}

export function Quiz({ id }: { id: string }) {
  const { db, toast, reload } = useApp();
  const { s, setS, qs, answers, refresh, missing } = useSessionData(id);
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const finishing = useRef(false);

  const finish = useCallback(async (reason: 'submitted' | 'timed_out', cur?: SessionRec) => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      if (cur) await db.saveSession(cur);
      await db.submitSession(id, reason); // DB側でも1度だけ処理される
      await reload();
      go(`result/${id}`);
    } catch (e) {
      finishing.current = false;
      toast('提出に失敗しました: ' + describeError(e), 'err');
    }
  }, [db, id, reload, toast]);

  // 絶対期限での時間管理。タブが裏にあっても、閉じていても、時刻から計算する
  useEffect(() => {
    if (!s || s.status !== 'in_progress') return;
    if (s.deadline && isExpired(s)) { void finish('timed_out', s); return; }
    if (!s.deadline) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (isExpired(s)) void finish('timed_out', s);
    }, 1000);
    const vis = () => { setNow(Date.now()); if (isExpired(s)) void finish('timed_out', s); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [s, finish]);

  useEffect(() => { if (s && s.status !== 'in_progress') go(`result/${id}`); }, [s, id]);

  if (missing) return <p>このセッションは見つかりません。<a href="#/">ホームへ</a></p>;
  if (!s) return <p>読み込み中…</p>;
  if (s.questionRefs.length === 0) return <p>出題できる問題がありません。<a href="#/setup">設定へ</a></p>;

  const idx = Math.min(s.currentIndex, s.questionRefs.length - 1);
  const ref = s.questionRefs[idx]!;
  const q = qs.get(ref.id);
  if (!q) return <p className="warn">この問題のデータが見つかりません ({ref.id})。バックアップから復元してください。</p>;

  const mock = s.mode === 'mock';
  const attempt = s.attempt[q.id] ?? 1;
  const committed = s.committed.includes(q.id);
  const answer = answers.filter((a) => a.questionId === q.id && a.attempt === attempt).at(-1);
  const draft = s.drafts[q.id];
  const order = s.displayOrder[q.id] ?? [];

  const persist = async (next: SessionRec) => {
    setS(next);
    try { await db.saveSession(next); }
    catch (e) { toast('保存できていません: ' + describeError(e), 'err'); }
  };
  const lapse = (cur: SessionRec): SessionRec => {
    const d = Date.now() - shownAt.current;
    shownAt.current = Date.now();
    return { ...cur, elapsedMs: { ...cur.elapsedMs, [q.id]: (cur.elapsedMs[q.id] ?? 0) + d } };
  };
  const jump = (i: number) => { void persist({ ...lapse(s), currentIndex: i }); window.scrollTo(0, 0); };
  const setDraft = (r: Response) => void persist({ ...s, drafts: { ...s.drafts, [q.id]: r } });

  const commit = async () => {
    setBusy(true);
    try {
      const d = Date.now() - shownAt.current;
      shownAt.current = Date.now();
      await db.commitPractice(id, q.id, draft!, d);
      await refresh();
      await reload();
    } catch (e) { toast('回答を保存できませんでした: ' + describeError(e), 'err'); }
    setBusy(false);
  };
  const setConf = async (c: Confidence) => {
    if (!answer) return;
    try { await db.setConfidence(answer.answerId, c); await refresh(); await reload(); }
    catch (e) { toast('保存できませんでした: ' + describeError(e), 'err'); }
  };
  const retry = async () => { await db.retry(id, q.id); shownAt.current = Date.now(); await refresh(); };

  const last = idx === s.questionRefs.length - 1;
  const unansweredCount = s.questionRefs.filter((r) => { const x = qs.get(r.id); return !x || !isAnswered(x, s.drafts[r.id]); }).length;

  return (
    <div className="quiz">
      <header className="quiz-head">
        <span>{mock ? '模擬' : '練習'}　{idx + 1} / {s.questionRefs.length}</span>
        <Timer s={s} now={now} />
      </header>
      <p className="meta">{q.exam}　{q.domainJa}</p>
      {q.ja.scenario && <div className="scenario"><h3>シナリオ</h3><Text>{q.ja.scenario}</Text></div>}
      {q.ja.background && <div className="scenario"><h3>共通背景</h3><Text>{q.ja.background}</Text></div>}
      <div className="stem"><Text>{q.ja.stem}</Text></div>
      <Assets q={q} placement="stem" />

      <AnswerInput q={q} order={order} value={draft} onChange={setDraft} disabled={!mock && committed} />

      {!mock && !committed && (
        <p><button type="button" className="btn primary wide" disabled={busy || !isSubmittable(q, draft)} onClick={commit}>回答を確定する</button>
          {!isSubmittable(q, draft) && <span className="hint">　{q.type === 'multiple' ? `${q.requiredSelections}つ選ぶと確定できます` : '回答すると確定できます'}</span>}</p>
      )}

      {!mock && committed && (
        <>
          <Explanation q={q} answer={answer} onConfidence={setConf} />
          <MemoBox qid={q.id} />
          <p><button type="button" className="btn" onClick={retry}>もう一度挑戦 (履歴は残ります)</button></p>
        </>
      )}

      <nav className="qnav" aria-label="問題移動">
        <button type="button" className="btn" disabled={idx === 0} onClick={() => jump(idx - 1)}>← 前へ</button>
        {!last && <button type="button" className="btn primary" disabled={!mock && !committed} onClick={() => jump(idx + 1)}>次へ →</button>}
        {last && !mock && committed && <button type="button" className="btn primary" onClick={() => finish('submitted')}>結果を見る</button>}
        {mock && <button type="button" className="btn" onClick={() => jump(Math.min(idx + 1, s.questionRefs.length - 1))} disabled={last}>次へ →</button>}
      </nav>

      {mock && (
        <>
          <ol className="qgrid" aria-label="問題一覧">
            {s.questionRefs.map((r, i) => {
              const x = qs.get(r.id);
              const done = !!x && isAnswered(x, s.drafts[r.id]);
              return <li key={r.id}><button type="button" className={'btn sq' + (i === idx ? ' primary' : '')} aria-current={i === idx} aria-label={`${i + 1}問目 ${done ? '回答済み' : '未回答'}`} onClick={() => jump(i)}>{i + 1}{done ? '✓' : ''}</button></li>;
            })}
          </ol>
          {!confirming ? (
            <p><button type="button" className="btn danger wide" onClick={() => setConfirming(true)}>提出に進む</button></p>
          ) : (
            <div className="confirm" role="alertdialog" aria-label="提出の確認">
              <p>未回答 <strong>{unansweredCount}</strong> 問 (未回答は不正解になります)。提出すると解答・解説が表示され、やり直せません。</p>
              <button type="button" className="btn danger" onClick={() => finish('submitted', lapse(s))}>提出する</button>{' '}
              <button type="button" className="btn" onClick={() => setConfirming(false)}>戻る</button>
            </div>
          )}
        </>
      )}
      {!mock && <p><button type="button" className="btn link" onClick={() => finish('submitted')}>途中で終了して結果を見る</button></p>}
    </div>
  );
}

export function Result({ id }: { id: string }) {
  const { s, qs, answers, missing, refresh } = useSessionData(id);
  const { reload, db } = useApp();
  const [onlyWrong, setOnlyWrong] = useState(false);
  useEffect(() => { void reload(); }, [reload]);
  if (missing) return <p>このセッションは見つかりません。<a href="#/history">履歴へ</a></p>;
  if (!s) return <p>読み込み中…</p>;

  // 問題ごとに最後の attempt を採用。未回答/未確定は不正解として分母に含める
  const rows = s.questionRefs.map((r) => {
    const q = qs.get(r.id);
    const a = answers.filter((x) => x.questionId === r.id).sort((x, y) => x.attempt - y.attempt || x.answeredAt.localeCompare(y.answeredAt)).at(-1);
    return { r, q, a };
  });
  const sc: ScoreAnswer[] = rows.map(({ r, q, a }) => ({
    questionId: r.id, correct: !!a?.correct, answered: !!a?.answered, domainJa: q?.domainJa ?? '不明', sourceId: q?.source.sourceId ?? '不明',
  }));
  const sum = summarize(sc);
  const secs = s.submittedAt ? new Date(s.submittedAt).getTime() - new Date(s.startedAt).getTime() : 0;
  const shown = rows.filter((x) => !onlyWrong || !x.a?.correct);

  const setConf = async (a: AnswerRec, c: Confidence) => { await db.setConfidence(a.answerId, c); await refresh(); await reload(); };

  return (
    <div className="result">
      <h2>{s.mode === 'mock' ? '模擬' : '練習'}の結果{s.status === 'timed_out' && '（時間切れで自動提出）'}</h2>
      <p className="big" role="status">{sum.correct} / {sum.total} 問正解 ({Math.round(sum.rate * 100)}%)</p>
      <p>未回答 {sum.unanswered} 問 / 所要時間 {fmtDuration(secs)} / 開始 {fmtJst(s.startedAt)} (JST)</p>
      <p className="hint">この正答率は学習用の目安です。本番試験のスケールスコアには換算できません。</p>
      {(['byDomain', 'bySource'] as const).map((k) => (
        <div key={k} className="tablewrap">
          <table>
            <caption>{k === 'byDomain' ? '分野別' : '出典別'}</caption>
            <thead><tr><th>{k === 'byDomain' ? '分野' : '出典'}</th><th>正解</th><th>出題</th><th>未回答</th><th>正答率</th></tr></thead>
            <tbody>{sum[k].map((r) => <tr key={r.key}><td>{r.key}</td><td>{r.correct}</td><td>{r.total}</td><td>{r.unanswered}</td><td>{Math.round((r.correct / r.total) * 100)}%</td></tr>)}</tbody>
          </table>
        </div>
      ))}
      <h3>全問の振り返り</h3>
      <label className="inline"><input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> 間違い・未回答のみ</label>
      {shown.map(({ r, q, a }) => (
        <details key={r.id} className="qcard">
          <summary>{a?.correct ? '✓' : '✗'} {rows.findIndex((x) => x.r.id === r.id) + 1}. {q?.ja.stem.slice(0, 60) ?? r.id}…</summary>
          {q ? (
            <>
              <div className="stem"><Text>{q.ja.stem}</Text></div>
              <Assets q={q} placement="stem" />
              <Explanation q={q} answer={a ?? undefined} onConfidence={a && s.mode === 'practice' ? (c) => void setConf(a, c) : undefined} />
              <MemoBox qid={q.id} />
            </>
          ) : <p className="warn">問題データがありません</p>}
        </details>
      ))}
      <p><a className="btn primary" href="#/setup">続けて学習する</a> <a className="btn" href="#/review">復習へ</a></p>
    </div>
  );
}
