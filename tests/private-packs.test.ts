// 非公開の問題パック(dist-private/)を、アプリ本体のコードで検証する。
// パックが無い環境(CI・他の人のクローン)では全体をスキップする。パックの内容はログに出さない。
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/core/backup';
import { StudyDb } from '../src/core/db';
import { grade, isSubmittable } from '../src/core/grading';
import { createSession } from '../src/core/session';
import { EXAMS, type Exam, type Question, type QuestionPack } from '../src/core/types';
import { validatePack } from '../src/core/validate';
import { readPackZip } from '../src/core/zip';

const DIR = 'dist-private';
const present = EXAMS.every((e) => existsSync(`${DIR}/${e}.pack.zip`)) && existsSync(`${DIR}/ALL.pack.zip`);
const EXPECTED: Record<Exam, number> = { 'CCDV-F': 106, 'CCAO-F': 120, 'CCAR-P': 126, 'CCAR-F': 120 };

function load(name: string) {
  const z = readPackZip(new Uint8Array(readFileSync(`${DIR}/${name}.pack.zip`)));
  const v = validatePack(z.json, new Set(z.assets.keys()));
  return { z, v };
}
let n = 0;
const fresh = () => StudyDb.open('priv-' + n++);

describe.skipIf(!present)('非公開パック (472問)', () => {
  it('資格別パックと全資格パックが検証に通り、件数が期待値と一致する', () => {
    let total = 0;
    for (const e of EXAMS) {
      const { v } = load(e);
      expect(v.errors, `${e} errors`).toEqual([]);
      expect(v.pack!.questions).toHaveLength(EXPECTED[e]);
      expect(v.warnings.filter((w) => w.includes('画像不足')), `${e} 画像不足`).toEqual([]);
      total += v.pack!.questions.length;
    }
    expect(total).toBe(472);
    const all = load('ALL');
    expect(all.v.errors).toEqual([]);
    expect(all.v.pack!.questions).toHaveLength(472);
    expect(new Set(all.v.pack!.questions.map((q) => q.id)).size).toBe(472);
  });

  it('出典内訳・翻訳状態・隔離なし・訂正の記録が報告と一致する', () => {
    const qs = load('ALL').v.pack!.questions;
    expect(qs.filter((q) => q.source.sourceId === 'matthew')).toHaveLength(236);
    expect(qs.filter((q) => q.source.sourceId === 'minorun')).toHaveLength(236);
    expect(qs.filter((q) => q.translationStatus === 'translated_ja')).toHaveLength(236);
    expect(qs.filter((q) => q.translationStatus === 'original_ja')).toHaveLength(236);
    expect(qs.filter((q) => q.translationStatus === 'pending')).toHaveLength(0);
    // Matthew版 CCDV-F 5.9 は、原本の解答欄(A,D)が原本自身の他の記述と矛盾していたため、根拠つきで C に訂正済み (revision 2)
    expect(qs.filter((q) => q.status === 'needs_review')).toEqual([]);
    const q59 = qs.find((q) => q.id === 'CCDV-F:matthew:MP-5.9')!;
    expect(q59.revision).toBe(2);
    expect(q59.type).toBe('single');
    expect(q59.correctAnswer.choiceIds).toEqual(['c']);
    expect((q59.supplemental as { originalAnswerKey?: string }).originalAnswerKey).toBe('A, D');
    expect(q59.reviewNotes!.join('')).toContain('正解を訂正');
    expect(q59.originalText).toBeTruthy();
  });

  it('ready の全問が、正解の回答で正解になり、確定できる有効回答である', () => {
    for (const q of load('ALL').v.pack!.questions.filter((x) => x.status === 'ready')) {
      const r =
        q.type === 'matching' ? { matches: q.correctAnswer.matches }
        : q.type === 'ordering' ? { order: q.correctAnswer.order }
        : { choiceIds: q.correctAnswer.choiceIds };
      expect(grade(q as Question, r), q.id).toBe(true);
      expect(isSubmittable(q as Question, r), q.id).toBe(true);
    }
  });

  it('図表50枚(問題40・講義10)が実在し、図表IDで関連付けられている', () => {
    const { v, z } = load('ALL');
    const qAssets = v.pack!.questions.flatMap((q) => q.assets ?? []);
    expect(qAssets).toHaveLength(40);
    const lessonAssets = (v.pack!.lessons ?? []).flatMap((l) => (l.assets as { path: string }[]) ?? []);
    expect(lessonAssets).toHaveLength(10);
    expect(v.pack!.lessons).toHaveLength(10);
    for (const a of [...qAssets, ...lessonAssets] as { path: string; altJa: string; sourceFigureId?: string }[]) {
      expect(z.assets.has(a.path), a.path).toBe(true);
      expect(a.sourceFigureId, a.path).toBeTruthy();
      expect(a.altJa.length).toBeGreaterThan(3);
    }
    expect(z.assets.size).toBe(50);
  });

  it('Matthew版(英語)は日本語に翻訳され、原文は originalText に残り、通常画面の項目は日本語を含む', () => {
    const hasJa = (s: string) => /[぀-ヿ一-鿿]/.test(s);
    for (const q of load('ALL').v.pack!.questions.filter((x) => x.source.sourceId === 'matthew')) {
      expect(hasJa(q.ja.stem), q.id).toBe(true);
      expect(hasJa(q.ja.explanation), q.id).toBe(true);
      expect(q.originalText, q.id).toBeTruthy();
      if (q.type !== 'matching') {
        expect(q.choices!.length, q.id).toBeGreaterThanOrEqual(4);
        // 選択肢の訳が原文の数と一致し、数字のみの選択肢を除き日本語を含む
        const orig = (q.originalText as { choices: string[] }).choices;
        expect(q.choices!.length, q.id).toBe(orig.length);
        q.choices!.forEach((c, i) => { if (/[A-Za-z]{3,}/.test(orig[i]!)) expect(hasJa(c.textJa), `${q.id} ${c.id}`).toBe(true); });
      }
    }
  });

  it('CCAR-P の対応付け5問は、小設問5つと候補を全て保持している', () => {
    const m = load('CCAR-P').v.pack!.questions.filter((q) => q.type === 'matching');
    expect(m).toHaveLength(5);
    for (const q of m) {
      expect(q.matching!.prompts).toHaveLength(5);
      expect(Object.keys(q.correctAnswer.matches!)).toHaveLength(5);
      expect(q.matching!.allowReuse).toBe(true);
    }
  });

  it('みのるん版は、表示順・正解記号が対応済みのまま保持され、誤答解説が選択肢ごとに分解されている', () => {
    const qs = load('ALL').v.pack!.questions.filter((q) => q.source.sourceId === 'minorun');
    expect(qs.every((q) => q.status === 'ready')).toBe(true);
    for (const q of qs) {
      const wrong = q.choices!.filter((c) => !q.correctAnswer.choiceIds!.includes(c.id));
      expect(wrong.every((c) => !!c.explanationJa), q.id).toBe(true);
      expect(new Set(q.choices!.map((c) => c.originalLabel)).size, q.id).toBe(q.choices!.length);
    }
  });

  it('アプリへ取り込める。再取り込みで増殖せず、資格別→全資格の順でも重複しない。5.9 を含む全問が出題対象になる', async () => {
    const db = await fresh();
    for (const e of EXAMS) {
      const { z, v } = load(e);
      const p = await db.importPack(v.pack as QuestionPack, z.assets);
      expect(p.added).toHaveLength(EXPECTED[e]);
    }
    const all = load('ALL');
    const plan = await db.importPack(all.v.pack as QuestionPack, all.z.assets);
    expect(plan.added).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(472);
    const again = await db.importPack(all.v.pack as QuestionPack, all.z.assets);
    expect(again.unchanged).toHaveLength(472);
    const latest = await db.latestQuestions();
    expect(latest).toHaveLength(472);

    const s = createSession(latest, { exam: 'mixed', mode: 'mock', shuffleChoices: true, shuffleQuestions: false, limitMinutes: 60, count: 1000 });
    expect(s.questionRefs).toHaveLength(472);
    expect(s.questionRefs.map((r) => r.id)).toContain('CCDV-F:matthew:MP-5.9');
    for (const e of EXAMS) {
      const sx = createSession(latest.filter((q) => q.exam === e), { exam: e, mode: 'practice', shuffleChoices: false, shuffleQuestions: false, limitMinutes: null, count: 1000 });
      expect(sx.questionRefs.length).toBe(EXPECTED[e]);
    }
    // 図が取り込まれ、問題から引ける
    const withFig = latest.filter((q) => q.assets?.length);
    expect(withFig).toHaveLength(40);
    for (const q of withFig) expect(await db.getAsset(q.packId, q.assets![0]!.path), q.id).toBeTruthy();
  });

  it('画像入りの完全バックアップを空の保存領域に復元すると、問題数・画像が一致する', async () => {
    const src = await fresh();
    const all = load('ALL');
    await src.importPack(all.v.pack as QuestionPack, all.z.assets);
    const bytes = await exportBackup(src, true);
    const dst = await fresh();
    await restoreBackup(dst, bytes, 'replace');
    expect(await dst.latestQuestions()).toHaveLength(472);
    const q = (await dst.latestQuestions()).find((x) => x.assets?.length)!;
    const a = await dst.getAsset(q.packId, q.assets![0]!.path);
    expect(a!.bytes.length).toBeGreaterThan(1000);
  }, 60000);
});
