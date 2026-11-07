import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const LIMITS = {
  maxFiles: 1000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxJsonBytes: 50 * 1024 * 1024,
};

export class PackError extends Error {}

export type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

/** 拡張子ではなく先頭バイトで画像形式を判定する (SVG等は拒否される) */
export function sniffImage(b: Uint8Array): Mime | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && strFromU8(b.subarray(0, 4)) === 'RIFF' && strFromU8(b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

const NAME_RE = /^(pack\.json|assets\/[A-Za-z0-9._-]+\.(png|jpe?g|webp))$/i;

export interface ReadZip {
  json: unknown;
  assets: Map<string, { bytes: Uint8Array; mime: Mime }>;
}

/** 問題パックZIPを安全に展開する。pack.json と assets/ 以下の画像だけ許可 */
export function readPackZip(data: Uint8Array): ReadZip {
  const names = new Set<string>();
  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter(f) {
        count++;
        if (count > LIMITS.maxFiles) throw new PackError(`ZIP内のファイル数が上限(${LIMITS.maxFiles})を超えています`);
        const name = f.name;
        if (name.endsWith('/')) return false; // ディレクトリ
        if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || /^[A-Za-z]:/.test(name)) {
          throw new PackError(`不正なパスが含まれています: ${name}`);
        }
        if (!NAME_RE.test(name)) throw new PackError(`許可されていないファイルです: ${name}`);
        if (names.has(name)) throw new PackError(`ZIP内でパスが重複しています: ${name}`);
        names.add(name);
        const limit = name === 'pack.json' ? LIMITS.maxJsonBytes : LIMITS.maxImageBytes;
        if (f.originalSize > limit) throw new PackError(`ファイルが大きすぎます: ${name}`);
        total += f.originalSize;
        if (total > LIMITS.maxTotalBytes) throw new PackError('ZIPの展開後サイズが上限を超えています');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PackError) throw e;
    throw new PackError('ZIPを読み込めません (破損している可能性があります)');
  }

  const j = files['pack.json'];
  if (!j) throw new PackError('pack.json がありません');
  // 申告サイズの偽装対策として実サイズも確認する
  let actual = 0;
  for (const [n, b] of Object.entries(files)) {
    actual += b.length;
    if (b.length > (n === 'pack.json' ? LIMITS.maxJsonBytes : LIMITS.maxImageBytes)) throw new PackError(`ファイルが大きすぎます: ${n}`);
  }
  if (actual > LIMITS.maxTotalBytes) throw new PackError('ZIPの展開後サイズが上限を超えています');

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(j));
  } catch {
    throw new PackError('pack.json がJSONとして不正です');
  }
  const assets = new Map<string, { bytes: Uint8Array; mime: Mime }>();
  for (const [n, bytes] of Object.entries(files)) {
    if (n === 'pack.json') continue;
    const mime = sniffImage(bytes);
    if (!mime) throw new PackError(`画像として認識できないファイルです: ${n}`);
    assets.set(n, { bytes, mime });
  }
  return { json, assets };
}

export function parseJsonPack(text: string): unknown {
  if (text.length > LIMITS.maxJsonBytes) throw new PackError('JSONが大きすぎます');
  try {
    return JSON.parse(text);
  } catch {
    throw new PackError('JSONとして読み込めません');
  }
}

export function buildZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(out, { level: 6 });
}
export { unzipSync, strFromU8, strToU8 };
