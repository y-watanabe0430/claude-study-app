import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { grade, isAnswered } from './grading';
import { nextSrs } from './srs';
import type {
  AnswerRec, Confidence, Progress, Question, QuestionPack, Response, SessionRec, StoredQuestion,
} from './types';
import { sha256Hex, stableStringify, uuid } from './util';
import type { Mime } from './zip';

export const DB_VERSION = 1;
const STORES = ['packs', 'questions', 'assets', 'sessions', 'answers', 'progress'] as const;
type StoreName = (typeof STORES)[number];

export interface PackRow { packId: string; version: string; titleJa: string; importedAt: string; questionCount: number; lessons: Record<string, unknown>[] }
export type QuestionRow = StoredQuestion & { key: string };
export interface AssetRow { key: string; packId: string; path: string; mime: Mime; bytes: Uint8Array; sha256: string }
export interface AssetInput { bytes: Uint8Array; mime: Mime }

export class ImportConflictError extends Error {
  constructor(public conflicts: string[]) {
    super('同じ revision で内容が異なる問題があるため取り込みを中止しました: ' + conflicts.join(', '));
  }
}

export interface ImportPlan {
  added: string[];
  updated: string[]; // revision 上昇
  unchanged: string[];
  conflicts: string[]; // 同 revision・異内容
  older: string[]; // 保存済みより古い revision
  assets: number;
}

export async function contentHash(q: Question): Promise<string> {
  return sha256Hex(stableStringify(q));
}
const qKey = (id: string, rev: number) => `${id}@${rev}`;

type Tx = IDBPTransaction<unknown, StoreName[], 'readwrite'>;

export class StudyDb {
  private constructor(private db: IDBPDatabase<unknown>) {}

  static async open(name = 'claude-study'): Promise<StudyDb> {
    const db = await openDB(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        // バージョン移行はここに段階的に追加する。既存ストアは消さない
        if (oldVersion < 1) {
          db.createObjectStore('packs', { keyPath: 'packId' });
          const q = db.createObjectStore('questions', { keyPath: 'key' });
          q.createIndex('byId', 'id');
          q.createIndex('byExam', 'exam');
          db.createObjectStore('assets', { keyPath: 'key' });
          db.createObjectStore('sessions', { keyPath: 'id' });
          const a = db.createObjectStore('answers', { keyPath: 'answerId' });
          a.createIndex('bySession', 'sessionId');
          a.createIndex('byQuestion', 'questionId');
          db.createObjectStore('progress', { keyPath: 'questionId' });
        }
      },
    });
    return new StudyDb(db);
  }

  close() { this.db.close(); }

  private tx(stores: StoreName[]): Tx {
    return this.db.transaction(stores, 'readwrite') as unknown as Tx;
  }

  // ---------- 問題パック ----------
  async classify(pack: QuestionPack, hashes: string[], tx?: Tx): Promise<ImportPlan> {
    const t = tx ?? (this.db.transaction(['questions'], 'readonly') as unknown as Tx);
    const plan: ImportPlan = { added: [], updated: [], unchanged: [], conflicts: [], older: [], assets: 0 };
    for (let i = 0; i < pack.questions.length; i++) {
      const q = pack.questions[i]!;
      const same = (await t.objectStore('questions').get(qKey(q.id, q.revision))) as QuestionRow | undefined;
      const hash = hashes[i]!;
      if (same) {
        (same.contentHash === hash ? plan.unchanged : plan.conflicts).push(q.id);
        continue;
      }
      const all = (await t.objectStore('questions').index('byId').getAll(q.id)) as QuestionRow[];
      if (all.length === 0) plan.added.push(q.id);
      else if (all.some((r) => r.revision > q.revision)) plan.older.push(q.id);
      else plan.updated.push(q.id);
    }
    return plan;
  }

  async previewImport(pack: QuestionPack, assets?: Map<string, AssetInput>): Promise<ImportPlan> {
    const plan = await this.classify(pack, await Promise.all(pack.questions.map(contentHash)));
    plan.assets = assets?.size ?? 0;
    return plan;
  }

  /** 全検証済みのパックを1トランザクションで保存。失敗・衝突時は何も変更しない */
  async importPack(pack: QuestionPack, assets?: Map<string, AssetInput>): Promise<ImportPlan> {
    const hashes = await Promise.all(pack.questions.map(contentHash));
    const assetRows: AssetRow[] = [];
    for (const [path, a] of assets ?? []) {
      assetRows.push({ key: `${pack.packId}:${path}`, packId: pack.packId, path, mime: a.mime, bytes: a.bytes, sha256: await sha256Hex(a.bytes) });
    }
    const tx = this.tx(['packs', 'questions', 'assets']);
    try {
      const plan = await this.classify(pack, hashes, tx);
      if (plan.conflicts.length) throw new ImportConflictError(plan.conflicts);
      const skip = new Set([...plan.unchanged, ...plan.older]);
      for (let i = 0; i < pack.questions.length; i++) {
        const q = pack.questions[i]!;
        if (skip.has(q.id)) continue;
        const row: QuestionRow = { ...q, contentHash: hashes[i]!, packId: pack.packId, packVersion: pack.version, key: qKey(q.id, q.revision) };
        await tx.objectStore('questions').put(row);
      }
      for (const r of assetRows) await tx.objectStore('assets').put(r);
      const row: PackRow = {
        packId: pack.packId, version: pack.version, titleJa: pack.titleJa, importedAt: new Date().toISOString(),
        questionCount: pack.questions.length, lessons: pack.lessons ?? [],
      };
      await tx.objectStore('packs').put(row);
      await tx.done;
      plan.assets = assetRows.length;
      return plan;
    } catch (e) {
      try { tx.abort(); } catch { /* すでに終了 */ }
      await tx.done.catch(() => undefined);
      throw e;
    }
  }

  async listPacks(): Promise<PackRow[]> { return (await this.db.getAll('packs')) as PackRow[]; }

  /** id ごとに最新 revision の問題だけを返す */
  async latestQuestions(): Promise<QuestionRow[]> {
    const all = (await this.db.getAll('questions')) as QuestionRow[];
    const m = new Map<string, QuestionRow>();
    for (const r of all) {
      const cur = m.get(r.id);
      if (!cur || cur.revision < r.revision) m.set(r.id, r);
    }
    return [...m.values()];
  }
  async getQuestion(id: string, revision: number): Promise<QuestionRow | undefined> {
    return (await this.db.get('questions', qKey(id, revision))) as QuestionRow | undefined;
  }
  async getAsset(packId: string, path: string): Promise<AssetRow | undefined> {
    return (await this.db.get('assets', `${packId}:${path}`)) as AssetRow | undefined;
  }

  // ---------- 進行状態 ----------
  async getProgress(qid: string): Promise<Progress | undefined> { return (await this.db.get('progress', qid)) as Progress | undefined; }
  async allProgress(): Promise<Progress[]> { return (await this.db.getAll('progress')) as Progress[]; }
  private blank(qid: string): Progress {
    return { questionId: qid, bookmarked: false, note: '', needsReview: false, intervalDays: 0, dueAt: null, updatedAt: new Date().toISOString() };
  }
  async updateProgress(qid: string, patch: Partial<Progress>): Promise<Progress> {
    const tx = this.tx(['progress']);
    const cur = ((await tx.objectStore('progress').get(qid)) as Progress | undefined) ?? this.blank(qid);
    const next = { ...cur, ...patch, questionId: qid, updatedAt: new Date().toISOString() };
    await tx.objectStore('progress').put(next);
    await tx.done;
    return next;
  }

  // ---------- セッション・回答 ----------
  async saveSession(s: SessionRec): Promise<void> { await this.db.put('sessions', s); }
  async getSession(id: string): Promise<SessionRec | undefined> { return (await this.db.get('sessions', id)) as SessionRec | undefined; }
  async listSessions(): Promise<SessionRec[]> { return (await this.db.getAll('sessions')) as SessionRec[]; }
  async answersBySession(id: string): Promise<AnswerRec[]> { return (await this.db.getAllFromIndex('answers', 'bySession', id)) as AnswerRec[]; }
  async allAnswers(): Promise<AnswerRec[]> { return (await this.db.getAll('answers')) as AnswerRec[]; }

  /** 練習: 回答を確定。確定済みの回答は改変しない(再挑戦は新しい attempt) */
  async commitPractice(sessionId: string, qid: string, response: Response, timeMs: number): Promise<AnswerRec> {
    const tx = this.tx(['sessions', 'answers', 'progress', 'questions']);
    try {
      const s = (await tx.objectStore('sessions').get(sessionId)) as SessionRec | undefined;
      if (!s || s.status !== 'in_progress') throw new Error('このセッションは終了しています');
      if (s.committed.includes(qid)) throw new Error('この問題は確定済みです');
      const ref = s.questionRefs.find((r) => r.id === qid);
      if (!ref) throw new Error('セッションに含まれない問題です');
      const q = (await tx.objectStore('questions').get(qKey(qid, ref.revision))) as QuestionRow;
      const correct = grade(q, response);
      const now = new Date().toISOString();
      const rec: AnswerRec = {
        answerId: uuid(), sessionId, questionId: qid, revision: q.revision, displayOrder: s.displayOrder[qid] ?? [],
        response, correctAnswer: q.correctAnswer, correct, answered: true, timeMs,
        confidence: null, answeredAt: now, attempt: s.attempt[qid] ?? 1,
      };
      await tx.objectStore('answers').put(rec);
      s.committed.push(qid);
      s.drafts[qid] = response;
      s.elapsedMs[qid] = (s.elapsedMs[qid] ?? 0) + timeMs;
      await tx.objectStore('sessions').put(s);
      if (!correct) await this.applySrs(tx, qid, 'wrong');
      await tx.done;
      return rec;
    } catch (e) {
      try { tx.abort(); } catch { /* noop */ }
      await tx.done.catch(() => undefined);
      throw e;
    }
  }

  private async applySrs(tx: Tx, qid: string, outcome: Confidence | 'wrong') {
    const cur = ((await tx.objectStore('progress').get(qid)) as Progress | undefined) ?? this.blank(qid);
    const n = nextSrs(cur, outcome, new Date());
    await tx.objectStore('progress').put({ ...cur, ...n, updatedAt: new Date().toISOString() });
  }

  /** 解説後の「理解した/あやふや/分からない」。誤答は理解したと答えても復習対象のまま */
  async setConfidence(answerId: string, conf: Confidence): Promise<void> {
    const tx = this.tx(['answers', 'progress']);
    const a = (await tx.objectStore('answers').get(answerId)) as AnswerRec | undefined;
    if (!a) { await tx.done; return; }
    a.confidence = conf; // 確定した回答内容そのものは変えない
    await tx.objectStore('answers').put(a);
    await this.applySrs(tx, a.questionId, a.correct ? conf : 'wrong');
    await tx.done;
  }

  /** 練習の再挑戦: 過去の回答は残し、新しい attempt を始める */
  async retry(sessionId: string, qid: string): Promise<SessionRec> {
    const tx = this.tx(['sessions']);
    const s = (await tx.objectStore('sessions').get(sessionId)) as SessionRec;
    s.committed = s.committed.filter((x) => x !== qid);
    delete s.drafts[qid];
    s.attempt[qid] = (s.attempt[qid] ?? 1) + 1;
    await tx.objectStore('sessions').put(s);
    await tx.done;
    return s;
  }

  /**
   * セッション終了。期限切れ・手動提出が競合しても1度だけ処理する。
   * 模擬では未回答も含め全問分の回答レコードを作る(未回答は不正解)。
   */
  async submitSession(sessionId: string, reason: 'submitted' | 'timed_out'): Promise<SessionRec | null> {
    const tx = this.tx(['sessions', 'answers', 'progress', 'questions']);
    try {
      const s = (await tx.objectStore('sessions').get(sessionId)) as SessionRec | undefined;
      if (!s || s.status !== 'in_progress') { await tx.done; return null; }
      const nowIso = new Date().toISOString();
      if (s.mode === 'mock') {
        for (const ref of s.questionRefs) {
          const q = (await tx.objectStore('questions').get(qKey(ref.id, ref.revision))) as QuestionRow;
          const r = s.drafts[ref.id];
          const answered = isAnswered(q, r);
          const correct = answered && grade(q, r);
          await tx.objectStore('answers').put({
            answerId: uuid(), sessionId, questionId: q.id, revision: q.revision, displayOrder: s.displayOrder[q.id] ?? [],
            response: r ?? {}, correctAnswer: q.correctAnswer, correct, answered, timeMs: s.elapsedMs[q.id] ?? 0,
            confidence: null, answeredAt: nowIso, attempt: 1,
          } satisfies AnswerRec);
          if (!correct) await this.applySrs(tx, q.id, 'wrong');
        }
      }
      s.status = reason;
      s.submittedAt = nowIso;
      await tx.objectStore('sessions').put(s);
      await tx.done;
      return s;
    } catch (e) {
      try { tx.abort(); } catch { /* noop */ }
      await tx.done.catch(() => undefined);
      throw e;
    }
  }

  // ---------- 全体 ----------
  async dumpAll() {
    const out = {} as Record<StoreName, unknown[]>;
    for (const s of STORES) out[s] = await this.db.getAll(s);
    return out;
  }

  async deleteEverything(): Promise<void> {
    const tx = this.tx([...STORES]);
    for (const s of STORES) await tx.objectStore(s).clear();
    await tx.done;
  }

  /** 復元用。行を1トランザクションで書き込む。replace は先に全消去 */
  async writeRows(
    rows: Partial<Record<StoreName, unknown[]>>,
    mode: 'append' | 'replace',
  ): Promise<void> {
    const tx = this.tx([...STORES]);
    try {
      if (mode === 'replace') for (const s of STORES) await tx.objectStore(s).clear();
      for (const s of STORES) for (const r of rows[s] ?? []) await tx.objectStore(s).put(r);
      await tx.done;
    } catch (e) {
      try { tx.abort(); } catch { /* noop */ }
      await tx.done.catch(() => undefined);
      throw e;
    }
  }

  async getRaw<T>(store: StoreName, key: string): Promise<T | undefined> { return (await this.db.get(store, key)) as T | undefined; }
}
