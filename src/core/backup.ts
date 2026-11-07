import type { AssetRow, QuestionRow, StudyDb } from './db';
import { contentHash } from './db';
import type { AnswerRec, Progress, SessionRec } from './types';
import { sha256Hex, stableStringify } from './util';
import { LIMITS, PackError, buildZip, sniffImage, strFromU8, unzipSync } from './zip';

export const BACKUP_SCHEMA = 1;
export const APP_ID = 'claude-study-app';

interface BackupAssetMeta { key: string; packId: string; path: string; mime: AssetRow['mime']; sha256: string; file: string }
interface BackupJson {
  schemaVersion: number;
  appId: string;
  exportedAt: string;
  includesHistory: boolean;
  packs: unknown[];
  questions: QuestionRow[];
  assets: BackupAssetMeta[];
  sessions: SessionRec[];
  answers: AnswerRec[];
  progress: Progress[];
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 完全バックアップZIP。includeHistory=false なら教材(問題と画像)だけ */
export async function exportBackup(db: StudyDb, includeHistory: boolean): Promise<Uint8Array> {
  const d = await db.dumpAll();
  const assets = d.assets as AssetRow[];
  const files: Record<string, Uint8Array | string> = {};
  const metas: BackupAssetMeta[] = assets.map((a, i) => {
    const file = `assets/${i}.${EXT[a.mime]}`;
    files[file] = a.bytes;
    return { key: a.key, packId: a.packId, path: a.path, mime: a.mime, sha256: a.sha256, file };
  });
  const json: BackupJson = {
    schemaVersion: BACKUP_SCHEMA,
    appId: APP_ID,
    exportedAt: new Date().toISOString(),
    includesHistory: includeHistory,
    packs: d.packs,
    questions: d.questions as QuestionRow[],
    assets: metas,
    sessions: includeHistory ? (d.sessions as SessionRec[]) : [],
    answers: includeHistory ? (d.answers as AnswerRec[]) : [],
    progress: includeHistory ? (d.progress as Progress[]) : [],
  };
  files['backup.json'] = JSON.stringify(json);
  return buildZip(files);
}

export interface RestoreReport {
  mode: 'append' | 'replace';
  questions: number;
  assets: number;
  sessions: number;
  answers: number;
  skippedDuplicates: number;
  conflicts: string[]; // 同IDで内容が異なり既存を残したもの
}

const BACKUP_NAME = /^(backup\.json|assets\/\d+\.(png|jpg|webp))$/;

async function parseBackup(data: Uint8Array): Promise<{ json: BackupJson; files: Record<string, Uint8Array> }> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter(f) {
        if (f.name.endsWith('/')) return false;
        if (!BACKUP_NAME.test(f.name)) throw new PackError(`許可されていないファイルです: ${f.name}`);
        total += f.originalSize;
        if (total > LIMITS.maxTotalBytes * 2) throw new PackError('バックアップが大きすぎます');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PackError) throw e;
    throw new PackError('バックアップZIPを読み込めません (破損している可能性があります)');
  }
  if (!files['backup.json']) throw new PackError('backup.json がありません');
  let json: BackupJson;
  try { json = JSON.parse(strFromU8(files['backup.json'])) as BackupJson; } catch { throw new PackError('backup.json が不正です'); }
  if (json.appId !== APP_ID) throw new PackError('このアプリのバックアップではありません');
  if (json.schemaVersion !== BACKUP_SCHEMA) throw new PackError(`未対応のバックアップ形式です (schemaVersion=${json.schemaVersion})`);
  for (const k of ['questions', 'assets', 'sessions', 'answers', 'progress', 'packs'] as const) {
    if (!Array.isArray(json[k])) throw new PackError(`backup.json の ${k} が不正です`);
  }
  // 整合性: 問題の本文ハッシュと画像のチェックサムを検証
  for (const q of json.questions) {
    const { key: _k, contentHash: h, packId: _p, packVersion: _v, ...rest } = q;
    if ((await contentHash(rest as never)) !== h) throw new PackError(`問題 ${q.id} のハッシュが一致しません (改変または破損)`);
  }
  for (const a of json.assets) {
    const b = files[a.file];
    if (!b) throw new PackError(`画像が欠落しています: ${a.file}`);
    if ((await sha256Hex(b)) !== a.sha256) throw new PackError(`画像のチェックサムが一致しません: ${a.file}`);
    if (sniffImage(b) !== a.mime) throw new PackError(`画像形式が不正です: ${a.file}`);
  }
  return { json, files };
}

/**
 * 復元。すべて検証してから1トランザクションで書き込み、失敗時は既存データを保つ。
 * append: 同じIDで同一内容なら重複させず、内容が異なれば既存を残して警告に記録する。
 */
export async function restoreBackup(db: StudyDb, data: Uint8Array, mode: 'append' | 'replace'): Promise<RestoreReport> {
  const { json, files } = await parseBackup(data);
  const cur = mode === 'append' ? await db.dumpAll() : null;
  const report: RestoreReport = { mode, questions: 0, assets: 0, sessions: 0, answers: 0, skippedDuplicates: 0, conflicts: [] };

  const merge = <T>(store: keyof NonNullable<typeof cur>, incoming: T[], idOf: (r: T) => string, label: string): T[] => {
    const existing = new Map<string, unknown>(((cur?.[store] ?? []) as T[]).map((r) => [idOf(r), r]));
    const out: T[] = [];
    for (const r of incoming) {
      const e = existing.get(idOf(r));
      if (e === undefined) out.push(r);
      else if (stableStringify(e) === stableStringify(r)) report.skippedDuplicates++;
      else report.conflicts.push(`${label}:${idOf(r)}`);
    }
    return out;
  };

  const assets: AssetRow[] = json.assets.map((a) => ({ key: a.key, packId: a.packId, path: a.path, mime: a.mime, sha256: a.sha256, bytes: files[a.file]! }));
  const questions = merge('questions', json.questions, (q) => q.key, '問題');
  const rows = {
    packs: json.packs,
    questions,
    assets: merge('assets', assets, (a) => a.key, '画像'),
    sessions: merge('sessions', json.sessions, (s) => s.id, 'セッション'),
    answers: merge('answers', json.answers, (a) => a.answerId, '回答'),
    // 進行状態は新しい方を採用
    progress: json.progress.filter((p) => {
      const e = ((cur?.progress ?? []) as Progress[]).find((x) => x.questionId === p.questionId);
      return !e || e.updatedAt < p.updatedAt;
    }),
  };
  await db.writeRows(rows, mode);
  report.questions = rows.questions.length;
  report.assets = rows.assets.length;
  report.sessions = rows.sessions.length;
  report.answers = rows.answers.length;
  return report;
}
