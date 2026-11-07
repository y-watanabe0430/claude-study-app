import { Fragment, useEffect, useState } from 'react';
import { matchingPartial } from '../core/grading';
import type { Asset, AnswerRec, Confidence, Question, Response } from '../core/types';
import { useApp } from './ctx';

/**
 * 本文の安全な描画。HTMLとして解釈せず、React のテキストノードとして出す。
 * 対応記法は ``` コードブロック・`インラインコード`・空行区切りの段落のみ。
 */
export function Text({ children }: { children: string }) {
  const blocks = children.split(/```[^\n]*\n?/);
  return (
    <>
      {blocks.map((b, i) =>
        i % 2 === 1 ? (
          <pre key={i} tabIndex={0}><code>{b.replace(/\n$/, '')}</code></pre>
        ) : (
          b.split(/\n{2,}/).filter((x) => x.trim()).map((para, j) => (
            <p key={`${i}-${j}`}>
              {para.split(/`([^`\n]+)`/).map((s, k) => (k % 2 === 1 ? <code key={k}>{s}</code> : <Fragment key={k}>{s}</Fragment>))}
            </p>
          ))
        ),
      )}
    </>
  );
}

/** 図表。画像は端末内DBのBlobから表示し、外部URLは一切読まない */
export function AssetImg({ packId, asset }: { packId: string; asset: Asset }) {
  const { db } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    db.getAsset(packId, asset.path).then((r) => {
      if (!live) return;
      if (!r) return setMissing(true);
      u = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      setUrl(u);
    });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [db, packId, asset.path]);
  if (missing) return <p className="warn">⚠ 図が取り込まれていません ({asset.path})。ZIPパックで取り込んでください。</p>;
  if (!url) return null;
  return (
    <figure className="fig">
      <button type="button" className="plain" onClick={() => setZoom(true)} aria-label="図を拡大する">
        <img src={url} alt={asset.altJa} />
      </button>
      <figcaption>{asset.altJa}</figcaption>
      {zoom && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="拡大表示" onClick={() => setZoom(false)}>
          <img src={url} alt={asset.altJa} />
          <button type="button" className="btn" onClick={() => setZoom(false)}>閉じる</button>
        </div>
      )}
    </figure>
  );
}

export function Assets({ q, placement }: { q: Question; placement: 'stem' | 'explanation' }) {
  const list = (q as Question & { packId?: string }).assets?.filter((a) => a.placement === placement) ?? [];
  const packId = (q as Question & { packId?: string }).packId ?? '';
  return <>{list.map((a) => <AssetImg key={a.path} packId={packId} asset={a} />)}</>;
}

// ---------- 入力部品 ----------
interface InputProps {
  q: Question;
  order: string[];
  value: Response | undefined;
  onChange: (r: Response) => void;
  disabled?: boolean;
}

export function AnswerInput({ q, order, value, onChange, disabled }: InputProps) {
  if (q.type === 'single' || q.type === 'multiple') {
    const sel = value?.choiceIds ?? [];
    const need = q.requiredSelections ?? 1;
    const byId = new Map(q.choices!.map((c) => [c.id, c]));
    return (
      <fieldset className="choices" disabled={disabled}>
        <legend>
          {q.type === 'single' ? '1つ選んでください' : `${need}つ選んでください`}
          {q.type === 'multiple' && <span className="count"> (選択中 {sel.length}/{need})</span>}
        </legend>
        {order.map((id) => {
          const c = byId.get(id)!;
          const on = sel.includes(id);
          return (
            <label key={id} className={'choice' + (on ? ' on' : '')}>
              <input
                type={q.type === 'single' ? 'radio' : 'checkbox'}
                name={`q-${q.id}`}
                checked={on}
                onChange={() =>
                  onChange({ choiceIds: q.type === 'single' ? [id] : on ? sel.filter((x) => x !== id) : [...sel, id] })
                }
              />
              <span><Text>{c.textJa}</Text></span>
            </label>
          );
        })}
      </fieldset>
    );
  }
  if (q.type === 'matching') {
    const m = q.matching!;
    const cur = value?.matches ?? {};
    const cand = new Map(m.candidates.map((c) => [c.id, c]));
    return (
      <div className="matching">
        <p className="hint">{m.allowReuse ? '同じ候補を複数回選べます。' : '同じ候補は1回だけ選べます。'}</p>
        {m.prompts.map((p) => {
          const usedElsewhere = new Set(Object.entries(cur).filter(([k]) => k !== p.id).map(([, v]) => v));
          return (
            <div key={p.id} className="match-row">
              <label htmlFor={`m-${q.id}-${p.id}`}><Text>{p.textJa}</Text></label>
              <select
                id={`m-${q.id}-${p.id}`}
                disabled={disabled}
                value={cur[p.id] ?? ''}
                onChange={(e) => {
                  const next = { ...cur };
                  if (e.target.value) next[p.id] = e.target.value; else delete next[p.id];
                  onChange({ matches: next });
                }}
              >
                <option value="">選択してください</option>
                {order.map((id) => (
                  <option key={id} value={id} disabled={!m.allowReuse && usedElsewhere.has(id)}>
                    {cand.get(id)!.textJa}{!m.allowReuse && usedElsewhere.has(id) ? ' (使用済み)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    );
  }
  // ordering
  const items = new Map(q.items!.map((i) => [i.id, i]));
  const cur = value?.order ?? order;
  const touched = !!value?.order;
  const move = (i: number, d: number) => {
    const n = [...cur];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j]!, n[i]!];
    onChange({ order: n });
  };
  return (
    <div className="ordering">
      <p className="hint">上下ボタンで正しい順に並べ替えてください。</p>
      <ol>
        {cur.map((id, i) => (
          <li key={id} className="order-row">
            <span className="order-text"><Text>{items.get(id)!.textJa}</Text></span>
            <span className="order-btns">
              <button type="button" className="btn sq" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`「${items.get(id)!.textJa}」を上へ`}>↑</button>
              <button type="button" className="btn sq" disabled={disabled || i === cur.length - 1} onClick={() => move(i, 1)} aria-label={`「${items.get(id)!.textJa}」を下へ`}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      {!touched && !disabled && <button type="button" className="btn" onClick={() => onChange({ order: [...cur] })}>この並びで回答する</button>}
    </div>
  );
}

// ---------- 解説 ----------
const SUPPLEMENT_LABELS: Record<string, string> = {
  wrongExplanation: '誤答の解説',
  note: '補足',
  runnerUp: '次点の選択肢と、誤りの理由',
  sourceNote: '出典についての注記',
};

function labelOf(q: Question, id: string): string {
  return (
    q.choices?.find((c) => c.id === id)?.textJa ??
    q.matching?.candidates.find((c) => c.id === id)?.textJa ??
    q.items?.find((c) => c.id === id)?.textJa ??
    id
  );
}

function ResponseView({ q, r, title }: { q: Question; r: Response | undefined; title: string }) {
  let body: React.ReactNode = <em>未回答</em>;
  if (r?.choiceIds?.length) body = <ul>{r.choiceIds.map((id) => <li key={id}>{labelOf(q, id)}</li>)}</ul>;
  else if (r?.matches && Object.keys(r.matches).length) {
    body = <ul>{q.matching!.prompts.map((p) => <li key={p.id}>{p.textJa} → {r.matches![p.id] ? labelOf(q, r.matches![p.id]!) : '未回答'}</li>)}</ul>;
  } else if (r?.order?.length) body = <ol>{r.order.map((id) => <li key={id}>{labelOf(q, id)}</li>)}</ol>;
  return <div className="resp"><h4>{title}</h4>{body}</div>;
}

export function correctResponse(q: Question): Response {
  return { choiceIds: q.correctAnswer.choiceIds, matches: q.correctAnswer.matches, order: q.correctAnswer.order };
}

/** 自分の回答・正解・理由・メモ・出典を一画面にまとめた振り返り表示 */
export function Explanation({ q, answer, onConfidence, children }: {
  q: Question; answer: AnswerRec | undefined; onConfidence?: (c: Confidence) => void; children?: React.ReactNode;
}) {
  const { showOriginal } = useApp();
  const correct = answer?.correct;
  const partial = q.type === 'matching' && answer?.answered ? matchingPartial(q, answer.response) : null;
  return (
    <section className="explain" aria-label="解説">
      {answer && (
        <p className={'verdict ' + (correct ? 'ok' : 'ng')} role="status">
          {correct ? '✓ 正解' : answer.answered ? '✗ 不正解' : '✗ 未回答 (不正解扱い)'}
          {partial && !correct && <small>　(部分一致 {partial.right}/{partial.total}・採点には含みません)</small>}
        </p>
      )}
      <div className="two">
        <ResponseView q={q} r={answer?.response} title="あなたの回答" />
        <ResponseView q={q} r={correctResponse(q)} title="正解" />
      </div>
      <h4>正解の理由</h4>
      <Text>{q.ja.explanation}</Text>
      {q.choices?.some((c) => c.explanationJa) && (
        <>
          <h4>各選択肢の解説</h4>
          <ul className="per-choice">
            {q.choices.filter((c) => c.explanationJa).map((c) => (
              <li key={c.id}>
                <strong>{q.correctAnswer.choiceIds?.includes(c.id) ? '○ ' : '× '}{c.textJa}</strong>
                <Text>{c.explanationJa!}</Text>
              </li>
            ))}
          </ul>
        </>
      )}
      <Assets q={q} placement="explanation" />
      {q.supplemental && Object.entries(q.supplemental).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
        <div key={k}>
          <h4>{SUPPLEMENT_LABELS[k] ?? k}</h4>
          <Text>{typeof v === 'string' ? v : JSON.stringify(v)}</Text>
        </div>
      ))}
      {q.reviewNotes && q.reviewNotes.length > 0 && <div className="warn"><h4>注記</h4><ul>{q.reviewNotes.map((n) => <li key={n}>{n}</li>)}</ul></div>}
      {showOriginal && q.originalText && <details open><summary>原文 (照合用)</summary><pre>{JSON.stringify(q.originalText, null, 2)}</pre></details>}
      <p className="meta">
        問題ID: {q.id}　分野: {q.domainJa}　出典: {q.source.sourceId} / {q.source.originalId}
        {q.source.url && /^https?:\/\//.test(q.source.url) && <> <a href={q.source.url} target="_blank" rel="noreferrer noopener">出典ページ</a></>}
      </p>
      {onConfidence && answer && (
        <div className="conf" role="group" aria-label="理解度">
          <span>理解度:</span>
          {([['understood', '理解した'], ['unsure', 'あやふや'], ['unknown', '分からない']] as const).map(([k, l]) => (
            <button key={k} type="button" className={'btn' + (answer.confidence === k ? ' primary' : '')} aria-pressed={answer.confidence === k} onClick={() => onConfidence(k)}>{l}</button>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

export function MemoBox({ qid }: { qid: string }) {
  const { db, progress, reload, toast } = useApp();
  const p = progress.get(qid);
  const [text, setText] = useState(p?.note ?? '');
  useEffect(() => setText(progress.get(qid)?.note ?? ''), [qid, progress]);
  const save = async (patch: { note?: string; bookmarked?: boolean }) => {
    try { await db.updateProgress(qid, patch); await reload(); }
    catch (e) { toast('保存できませんでした: ' + (e instanceof Error ? e.message : e), 'err'); }
  };
  return (
    <div className="memo">
      <label htmlFor={`memo-${qid}`}>メモ</label>
      <textarea id={`memo-${qid}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== (p?.note ?? '') && save({ note: text })} />
      <button type="button" className="btn" aria-pressed={!!p?.bookmarked} onClick={() => save({ bookmarked: !p?.bookmarked })}>
        {p?.bookmarked ? '★ ブックマーク済み' : '☆ ブックマーク'}
      </button>
    </div>
  );
}
