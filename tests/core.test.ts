import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/core/backup';
import { ImportConflictError, StudyDb } from '../src/core/db';
import { grade, isSubmittable, summarize } from '../src/core/grading';
import { canShuffle, createSession, isExpired, makeDisplayOrder, remainingMs } from '../src/core/session';
import { nextSrs } from '../src/core/srs';
import type { Question, QuestionPack } from '../src/core/types';
import { mulberry32 } from '../src/core/util';
import { validatePack } from '../src/core/validate';
import { PackError, buildZip, readPackZip } from '../src/core/zip';

const sample = (): QuestionPack => JSON.parse(readFileSync('public/sample-pack.ja.json', 'utf8'));
const byId = (p: QuestionPack, id: string) => p.questions.find((q) => q.id === id)! as Question;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('サンプルパックの検証', () => {
  it('4形式ともエラーなく検証できる', () => {
    const r = validatePack(sample());
    expect(r.errors).toEqual([]);
    expect(r.pack!.questions.map((q) => q.type).sort()).toEqual(['matching', 'multiple', 'ordering', 'single']);
  });
  it('正解IDの参照切れ・選択数不一致・重複IDを拒否する', () => {
    const p = sample();
    byId(p, 'CCDV-F:original:1').correctAnswer.choiceIds = ['nope'];
    byId(p, 'CCAO-F:original:2').requiredSelections = 3;
    p.questions.push(structuredClone(p.questions[0]!));
    const e = validatePack(p).errors.join('\n');
    expect(e).toContain('"nope" が選択肢に存在しません');
    expect(e).toContain('指定選択数(3)と正解数(2)が一致しません');
    expect(e).toContain('重複');
  });
  it('needs_review は矛盾があっても警告として取り込める (例: 1個選択なのに正解2個)', () => {
    const p = sample();
    const q = byId(p, 'CCAO-F:original:2');
    q.status = 'needs_review';
    q.requiredSelections = 1;
    const r = validatePack(p);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain('要確認');
  });
  it('ready で翻訳 pending は不可。不正な画像パスも不可', () => {
    const p = sample();
    byId(p, 'CCDV-F:original:1').translationStatus = 'pending';
    byId(p, 'CCAO-F:original:2').assets = [{ path: 'https://x/y.png', altJa: 'a', placement: 'stem' }];
    byId(p, 'CCAR-F:original:3').assets = [{ path: 'assets/../x.png', altJa: 'a', placement: 'stem' }];
    byId(p, 'CCAR-P:original:4').assets = [{ path: 'assets/a.svg', altJa: 'a', placement: 'stem' }];
    const e = validatePack(p).errors.join('\n');
    expect(e).toContain('翻訳が未完了');
    expect(e.match(/画像パスが不正/g)).toHaveLength(3);
  });
  it('空パックは警告、画像不足は警告', () => {
    expect(validatePack({ ...sample(), questions: [] }).warnings.join()).toContain('0件');
    const p = sample();
    byId(p, 'CCDV-F:original:1').assets = [{ path: 'assets/a.png', altJa: '図', placement: 'stem' }];
    expect(validatePack(p, new Set()).warnings.join()).toContain('画像不足');
  });
});

describe('採点', () => {
  const p = sample();
  it('multiple は選択順に依存せず、1つ余分なら不正解', () => {
    const q = byId(p, 'CCAO-F:original:2');
    expect(grade(q, { choiceIds: ['secret', 'facts'] })).toBe(true);
    expect(grade(q, { choiceIds: ['facts', 'secret', 'fluent'] })).toBe(false);
    expect(grade(q, { choiceIds: ['facts'] })).toBe(false);
    expect(isSubmittable(q, { choiceIds: ['facts'] })).toBe(false);
    expect(isSubmittable(q, { choiceIds: ['facts', 'secret'] })).toBe(true);
  });
  it('matching/ordering は完全一致。再利用不可の重複は確定できない', () => {
    const m = byId(p, 'CCAR-F:original:3');
    expect(grade(m, { matches: { find: 'search', inspect: 'read' } })).toBe(true);
    expect(grade(m, { matches: { find: 'read', inspect: 'search' } })).toBe(false);
    expect(isSubmittable(m, { matches: { find: 'read', inspect: 'read' } })).toBe(false);
    const o = byId(p, 'CCAR-P:original:4');
    expect(grade(o, { order: ['requirements', 'evaluate', 'release'] })).toBe(true);
    expect(grade(o, { order: ['evaluate', 'requirements', 'release'] })).toBe(false);
  });
  it('未回答は不正解として全出題数を分母にする', () => {
    const s = summarize([
      { questionId: 'a', correct: true, answered: true, domainJa: 'X', sourceId: 's' },
      { questionId: 'b', correct: false, answered: false, domainJa: 'X', sourceId: 's' },
    ]);
    expect(s.rate).toBe(0.5);
    expect(s.byDomain[0]).toMatchObject({ total: 2, correct: 1, unanswered: 1 });
  });
});

describe('出題とタイマー', () => {
  it('シャッフルしても全IDが保たれ、位置参照を含む問題はシャッフルしない', () => {
    const q = byId(sample(), 'CCAO-F:original:2');
    const o = makeDisplayOrder(q, true, mulberry32(7));
    expect([...o].sort()).toEqual(q.choices!.map((c) => c.id).sort());
    const pos = { ...q, choices: [...q.choices!, { id: 'x', textJa: 'AとBの両方' }] } as Question;
    expect(canShuffle(pos)).toBe(false);
    expect(makeDisplayOrder(pos, true, mulberry32(7))).toEqual(pos.choices!.map((c) => c.id));
  });
  it('needs_review は出題に混ざらない。順序は固定保存される', () => {
    const p = sample();
    byId(p, 'CCDV-F:original:1').status = 'needs_review';
    const s = createSession(p.questions, { exam: 'mixed', mode: 'practice', shuffleChoices: true, shuffleQuestions: true, limitMinutes: null, count: 10, seed: 1 });
    expect(s.questionRefs).toHaveLength(3);
    expect(s.questionRefs.map((r) => r.id)).not.toContain('CCDV-F:original:1');
    expect(Object.keys(s.displayOrder)).toHaveLength(3);
  });
  it('絶対期限: 時刻だけで残り時間と期限切れが決まる', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const s = createSession(sample().questions, { exam: 'mixed', mode: 'mock', shuffleChoices: false, shuffleQuestions: false, limitMinutes: 10, count: 4, now });
    expect(remainingMs(s, now.getTime() + 60000)).toBe(9 * 60000);
    expect(isExpired(s, now.getTime() + 11 * 60000)).toBe(true);
    expect(isExpired({ ...s, status: 'submitted' }, now.getTime() + 11 * 60000)).toBe(false);
  });
  it('練習には時間制限が付かない', () => {
    const s = createSession(sample().questions, { exam: 'mixed', mode: 'practice', shuffleChoices: false, shuffleQuestions: false, limitMinutes: 10, count: 4 });
    expect(s.deadline).toBeNull();
  });
});

describe('復習間隔', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  it('誤答・あやふやは1日後、理解で 1→3→7→14 と進み最後に外れる', () => {
    expect(nextSrs(undefined, 'wrong', now).intervalDays).toBe(1);
    expect(nextSrs({ intervalDays: 7 }, 'unsure', now).intervalDays).toBe(1);
    expect(nextSrs(undefined, 'understood', now).intervalDays).toBe(1);
    expect(nextSrs({ intervalDays: 1 }, 'understood', now).intervalDays).toBe(3);
    expect(nextSrs({ intervalDays: 7 }, 'understood', now).intervalDays).toBe(14);
    expect(nextSrs({ intervalDays: 14 }, 'understood', now)).toMatchObject({ needsReview: false, dueAt: null });
  });
});

describe('ZIPパックの安全性', () => {
  const pack = JSON.stringify(sample());
  it('正しいZIPは読め、画像は先頭バイトで判定される', () => {
    const r = readPackZip(buildZip({ 'pack.json': pack, 'assets/a.png': PNG }));
    expect(r.assets.get('assets/a.png')!.mime).toBe('image/png');
  });
  it('SVG・偽装画像・../・外部パス・pack.json欠落・破損を拒否する', () => {
    expect(() => readPackZip(buildZip({ 'pack.json': pack, 'assets/a.svg': '<svg onload=alert(1)/>' }))).toThrow(PackError);
    expect(() => readPackZip(buildZip({ 'pack.json': pack, 'assets/a.png': 'not an image' }))).toThrow('画像として認識できない');
    expect(() => readPackZip(buildZip({ 'pack.json': pack, 'assets/../evil.png': PNG }))).toThrow(PackError);
    expect(() => readPackZip(buildZip({ 'pack.json': pack, '/abs.png': PNG }))).toThrow(PackError);
    expect(() => readPackZip(buildZip({ 'assets/a.png': PNG }))).toThrow('pack.json がありません');
    expect(() => readPackZip(new Uint8Array([1, 2, 3, 4]))).toThrow(PackError);
  });
});

let n = 0;
async function freshDb() {
  return StudyDb.open('test-' + n++);
}

describe('取り込みの冪等性と原子性', () => {
  let db: StudyDb;
  beforeEach(async () => { db = await freshDb(); });

  it('再取り込みで増殖しない', async () => {
    const p = sample();
    expect((await db.importPack(p)).added).toHaveLength(4);
    const again = await db.importPack(p);
    expect(again.unchanged).toHaveLength(4);
    expect(await db.latestQuestions()).toHaveLength(4);
  });
  it('同revision・異内容は衝突として停止し、何も変更しない', async () => {
    await db.importPack(sample());
    const p = sample();
    p.questions[0]!.ja.stem = '改変された本文';
    p.questions.push({ ...structuredClone(p.questions[1]!), id: 'CCAO-F:original:99' });
    await expect(db.importPack(p)).rejects.toBeInstanceOf(ImportConflictError);
    expect(await db.latestQuestions()).toHaveLength(4);
  });
  it('revision を上げると更新され、旧revisionも履歴用に残る', async () => {
    await db.importPack(sample());
    const p = sample();
    p.questions[0]!.revision = 2;
    p.questions[0]!.ja.stem = '改訂後の本文';
    expect((await db.importPack(p)).updated).toEqual(['CCDV-F:original:1']);
    const latest = (await db.latestQuestions()).find((q) => q.id === 'CCDV-F:original:1')!;
    expect(latest.revision).toBe(2);
    expect((await db.getQuestion('CCDV-F:original:1', 1))!.ja.stem).not.toBe('改訂後の本文');
  });
});

describe('セッションと履歴', () => {
  let db: StudyDb;
  beforeEach(async () => {
    db = await freshDb();
    await db.importPack(sample());
  });
  const start = async (mode: 'practice' | 'mock') => {
    const s = createSession(await db.latestQuestions(), { exam: 'mixed', mode, shuffleChoices: true, shuffleQuestions: false, limitMinutes: 5, count: 4 });
    await db.saveSession(s);
    return s;
  };

  it('練習: 確定は一度だけ。誤答は復習対象。再挑戦は新しい attempt で履歴を保つ', async () => {
    const s = await start('practice');
    const a = await db.commitPractice(s.id, 'CCDV-F:original:1', { choiceIds: ['bundle'] }, 1200);
    expect(a.correct).toBe(false);
    await expect(db.commitPractice(s.id, 'CCDV-F:original:1', { choiceIds: ['server'] }, 10)).rejects.toThrow('確定済み');
    expect((await db.getProgress('CCDV-F:original:1'))!.needsReview).toBe(true);
    await db.retry(s.id, 'CCDV-F:original:1');
    const b = await db.commitPractice(s.id, 'CCDV-F:original:1', { choiceIds: ['server'] }, 800);
    expect(b.attempt).toBe(2);
    const all = await db.answersBySession(s.id);
    expect(all.map((x) => x.correct).sort()).toEqual([false, true]);
  });
  it('正解でも「あやふや」なら復習対象になる', async () => {
    const s = await start('practice');
    const a = await db.commitPractice(s.id, 'CCDV-F:original:1', { choiceIds: ['server'] }, 500);
    expect(await db.getProgress('CCDV-F:original:1')).toBeUndefined();
    await db.setConfidence(a.answerId, 'unsure');
    expect((await db.getProgress('CCDV-F:original:1'))!.needsReview).toBe(true);
  });
  it('模擬: 提出は一度だけ。未回答も含め全問分を記録し不正解扱い', async () => {
    const s = await start('mock');
    s.drafts['CCDV-F:original:1'] = { choiceIds: ['server'] };
    await db.saveSession(s);
    const [r1, r2] = await Promise.all([db.submitSession(s.id, 'timed_out'), db.submitSession(s.id, 'submitted')]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    const answers = await db.answersBySession(s.id);
    expect(answers).toHaveLength(4);
    expect(answers.filter((a) => a.correct)).toHaveLength(1);
    expect(answers.filter((a) => !a.answered)).toHaveLength(3);
  });
  it('問題が改訂されても過去回答は当時の問題で再現できる', async () => {
    const s = await start('practice');
    await db.commitPractice(s.id, 'CCDV-F:original:1', { choiceIds: ['server'] }, 1);
    const p = sample();
    p.questions[0]!.revision = 2;
    p.questions[0]!.correctAnswer = { choiceIds: ['bundle'] };
    await db.importPack(p);
    const [a] = await db.answersBySession(s.id);
    const old = await db.getQuestion(a!.questionId, a!.revision);
    expect(old!.correctAnswer.choiceIds).toEqual(['server']);
    expect(a!.correct).toBe(true);
  });
});

describe('バックアップと復元', () => {
  it('画像付き完全バックアップを空の保存領域へ復元すると全て一致する', async () => {
    const src = await freshDb();
    const p = sample();
    p.questions[0]!.assets = [{ path: 'assets/fig.png', altJa: '図', placement: 'stem' }];
    await src.importPack(p, new Map([['assets/fig.png', { bytes: PNG, mime: 'image/png' as const }]]));
    const s = createSession(await src.latestQuestions(), { exam: 'mixed', mode: 'practice', shuffleChoices: true, shuffleQuestions: false, limitMinutes: null, count: 4 });
    await src.saveSession(s);
    await src.commitPractice(s.id, 'CCAO-F:original:2', { choiceIds: ['facts'] }, 100);
    await src.updateProgress('CCDV-F:original:1', { note: 'メモ', bookmarked: true });

    const bytes = await exportBackup(src, true);
    const dst = await freshDb();
    const rep = await restoreBackup(dst, bytes, 'replace');
    expect(rep.conflicts).toEqual([]);
    expect(await dst.latestQuestions()).toHaveLength(4);
    expect((await dst.getAsset(p.packId, 'assets/fig.png'))!.bytes).toEqual(PNG);
    expect((await dst.getProgress('CCDV-F:original:1'))!.note).toBe('メモ');
    const restored = await dst.getSession(s.id);
    expect(restored!.status).toBe('in_progress');
    expect(restored!.displayOrder).toEqual(s.displayOrder);
    expect(await dst.answersBySession(s.id)).toHaveLength(1);

    // 端末間統合: もう一度 append しても重複しない
    const again = await restoreBackup(dst, bytes, 'append');
    expect(again.answers).toBe(0);
    expect(again.sessions).toBe(0);
    expect(await dst.answersBySession(s.id)).toHaveLength(1);
  });
  it('教材のみのバックアップに履歴は含まれない', async () => {
    const src = await freshDb();
    await src.importPack(sample());
    await src.updateProgress('CCDV-F:original:1', { note: 'x' });
    const dst = await freshDb();
    await restoreBackup(dst, await exportBackup(src, false), 'replace');
    expect(await dst.allProgress()).toHaveLength(0);
    expect(await dst.latestQuestions()).toHaveLength(4);
  });
  it('破損・改変バックアップは拒否し既存データを壊さない', async () => {
    const src = await freshDb();
    await src.importPack(sample());
    const good = await exportBackup(src, true);
    const dst = await freshDb();
    await dst.importPack({ ...sample(), packId: 'existing' });
    await expect(restoreBackup(dst, good.slice(0, 50), 'replace')).rejects.toThrow(PackError);
    const tampered = (await import('../src/core/zip')).unzipSync(good);
    const j = JSON.parse(new TextDecoder().decode(tampered['backup.json']));
    j.questions[0].ja.stem = '改変';
    tampered['backup.json'] = new TextEncoder().encode(JSON.stringify(j));
    const bad = buildZip(tampered);
    await expect(restoreBackup(dst, bad, 'replace')).rejects.toThrow('ハッシュが一致しません');
    expect(await dst.listPacks()).toHaveLength(1);
    expect(await dst.latestQuestions()).toHaveLength(4);
  });
  it('同IDで異なる内容の回答は既存を残して警告する', async () => {
    const src = await freshDb();
    await src.importPack(sample());
    const s = createSession(await src.latestQuestions(), { exam: 'mixed', mode: 'practice', shuffleChoices: false, shuffleQuestions: false, limitMinutes: null, count: 1 });
    await src.saveSession(s);
    const a = await src.commitPractice(s.id, s.questionRefs[0]!.id, { choiceIds: ['server'] }, 1);
    const bytes = await exportBackup(src, true);
    await src.setConfidence(a.answerId, 'unsure'); // 手元の内容を変える
    const rep = await restoreBackup(src, bytes, 'append');
    expect(rep.conflicts.some((c) => c.startsWith('回答:'))).toBe(true);
    expect((await src.answersBySession(s.id))[0]!.confidence).toBe('unsure');
  });
});
