import { useState } from 'react';
import { exportBackup, restoreBackup, type RestoreReport } from '../core/backup';
import { ImportConflictError, type AssetInput, type ImportPlan } from '../core/db';
import type { QuestionPack } from '../core/types';
import { validatePack } from '../core/validate';
import { PackError, parseJsonPack, readPackZip } from '../core/zip';
import { describeError, useApp, type FontSize } from './ctx';

interface Staged { name: string; pack: QuestionPack | null; assets?: Map<string, AssetInput>; errors: string[]; warnings: string[]; plan?: ImportPlan }

export function ImportPanel() {
  const { db, reload, toast } = useApp();
  const [st, setSt] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSample = async () => {
    try {
      const r = await fetch('./sample-pack.ja.json');
      await onFile(new File([await r.text()], 'sample-pack.ja.json', { type: 'application/json' }));
    } catch (e) { toast('サンプルを読み込めませんでした: ' + describeError(e), 'err'); }
  };

  const onFile = async (f: File | undefined) => {
    setSt(null);
    if (!f) return;
    try {
      let json: unknown;
      let assets: Map<string, AssetInput> | undefined;
      if (/\.zip$/i.test(f.name)) {
        const z = readPackZip(new Uint8Array(await f.arrayBuffer()));
        json = z.json; assets = z.assets;
      } else json = parseJsonPack(await f.text());
      const v = validatePack(json, assets ? new Set(assets.keys()) : undefined);
      const plan = v.pack ? await db.previewImport(v.pack, assets) : undefined;
      setSt({ name: f.name, pack: v.pack, assets, errors: v.errors, warnings: v.warnings, plan });
    } catch (e) {
      setSt({ name: f.name, pack: null, errors: [e instanceof PackError ? e.message : describeError(e)], warnings: [] });
    }
  };

  const apply = async () => {
    if (!st?.pack) return;
    setBusy(true);
    try {
      const plan = await db.importPack(st.pack, st.assets);
      await reload();
      toast(`取り込みました: 追加 ${plan.added.length} / 更新 ${plan.updated.length} / 変更なし ${plan.unchanged.length}`);
      setSt(null);
    } catch (e) {
      toast(e instanceof ImportConflictError ? e.message : '取り込みに失敗しました(既存のデータは変更されていません): ' + describeError(e), 'err');
    }
    setBusy(false);
  };

  return (
    <div className="panel">
      <label>問題パック (.json / .zip)<input type="file" accept=".json,.zip,application/json,application/zip" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <p><button type="button" className="btn" onClick={loadSample}>動作確認用サンプル(オリジナル4問)を読み込む</button></p>
      {st && (
        <div aria-live="polite">
          <p><strong>{st.name}</strong></p>
          {st.errors.length > 0 && <div className="warn"><p>取り込めません:</p><ul>{st.errors.slice(0, 20).map((m) => <li key={m}>{m}</li>)}</ul></div>}
          {st.warnings.length > 0 && <details><summary>注意 {st.warnings.length}件</summary><ul>{st.warnings.slice(0, 50).map((m) => <li key={m}>{m}</li>)}</ul></details>}
          {st.pack && st.plan && (
            <>
              <p>「{st.pack.titleJa}」v{st.pack.version}: 全{st.pack.questions.length}問 →
                新規 {st.plan.added.length} / 更新 {st.plan.updated.length} / 変更なし {st.plan.unchanged.length}{st.plan.older.length > 0 && ` / 古い版のため無視 ${st.plan.older.length}`}　画像 {st.plan.assets}枚
                ・要確認(隔離) {st.pack.questions.filter((q) => q.status === 'needs_review').length}問</p>
              {st.plan.conflicts.length > 0
                ? <p className="warn">同じ revision で内容が異なる問題があります ({st.plan.conflicts.join(', ')})。revision を上げたパックを使ってください。</p>
                : <button type="button" className="btn primary" disabled={busy} onClick={apply}>この内容で取り込む</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings() {
  const { db, reload, toast, fontSize, setFontSize, showOriginal, setShowOriginal } = useApp();
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [rep, setRep] = useState<RestoreReport | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [del, setDel] = useState('');
  const [persisted, setPersisted] = useState<string>('');

  const exp = async (history: boolean) => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      download(`claude-study-${history ? 'full' : 'materials'}-${day}.backup.zip`, await exportBackup(db, history), 'application/zip');
    } catch (e) { toast('書き出しに失敗しました: ' + describeError(e), 'err'); }
  };
  const restore = async () => {
    if (!pending) return;
    try {
      const r = await restoreBackup(db, new Uint8Array(await pending.arrayBuffer()), mode);
      setRep(r); setPending(null); await reload();
      toast('復元しました');
    } catch (e) { toast('復元できませんでした(既存のデータは変更されていません): ' + describeError(e), 'err'); }
  };
  const persist = async () => {
    const ok = (await navigator.storage?.persist?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    setPersisted(ok ? '永続保存が許可されました' : 'ブラウザが永続保存を許可しませんでした (バックアップを取っておいてください)');
    if (est?.usage != null) setPersisted((p) => `${p} / 使用量 約${Math.round(est.usage! / 1024 / 1024)}MB`);
  };

  return (
    <div>
      <h2>設定</h2>
      <h3>表示</h3>
      <label>文字サイズ<select value={fontSize} onChange={(e) => setFontSize(e.target.value as FontSize)}><option value="s">小</option><option value="m">標準</option><option value="l">大</option></select></label>
      <label className="inline"><input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> 解説に英語原文を表示する (照合用)</label>

      <h3>問題パックの取り込み</h3>
      <ImportPanel />

      <h3>データの保存場所</h3>
      <p>問題・履歴・メモは<strong>この端末のこのブラウザの中だけ</strong>に保存されます。サーバーには送られず、他の端末へも自動では同期されません。ブラウザのデータ削除や容量整理、公開URLの変更で消えることがあるため、定期的にバックアップを書き出してください。iPhoneのSafariとホーム画面から開くアプリでは保存領域が別になる場合があります。</p>
      <p><button type="button" className="btn" onClick={persist}>消えにくい保存を要求する</button> {persisted}</p>

      <h3>バックアップ</h3>
      <p><button type="button" className="btn primary" onClick={() => exp(true)}>完全バックアップ (履歴・メモ込み)</button>{' '}
        <button type="button" className="btn" onClick={() => exp(false)}>教材のみ (問題と図)</button></p>
      <h3>復元</h3>
      <label>バックアップZIP<input type="file" accept=".zip" onChange={(e) => { setPending(e.target.files?.[0] ?? null); setRep(null); }} /></label>
      <label>方法<select value={mode} onChange={(e) => setMode(e.target.value as 'append' | 'replace')}>
        <option value="append">追加・統合 (既存を残し、同じIDの重複は入れない)</option>
        <option value="replace">置き換え (今のデータを消して復元)</option></select></label>
      {pending && <button type="button" className={'btn ' + (mode === 'replace' ? 'danger' : 'primary')} onClick={restore}>{mode === 'replace' ? '現在のデータを消して復元する' : '復元する'}</button>}
      {rep && <div className="notice"><p>復元結果: 問題 {rep.questions} / 画像 {rep.assets} / セッション {rep.sessions} / 回答 {rep.answers} を追加、重複 {rep.skippedDuplicates} 件は追加せず。</p>
        {rep.conflicts.length > 0 && <p className="warn">同じIDで内容が異なる {rep.conflicts.length} 件は既存を残しました: {rep.conflicts.slice(0, 10).join(', ')}</p>}</div>}

      <h3>すべてのデータを削除</h3>
      <p className="hint">この端末の問題・履歴・メモをすべて消します。元に戻せません。先にバックアップを書き出してください。確認のため「削除」と入力してください。</p>
      <input aria-label="確認入力" value={del} onChange={(e) => setDel(e.target.value)} />{' '}
      <button type="button" className="btn danger" disabled={del !== '削除'} onClick={async () => { await db.deleteEverything(); setDel(''); await reload(); toast('すべて削除しました'); }}>すべて削除する</button>
    </div>
  );
}
