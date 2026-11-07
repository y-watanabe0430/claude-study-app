// 公開用 dist に原本・私的パック・翻訳チェックポイント・秘密情報が入っていないか検査する
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FORBIDDEN_EXT = /\.(xlsx|xls|pdf|zip|docx)$/i;
const FORBIDDEN_NAME = /(inputs_private|dist-private|translations|checkpoint|\.private\.json|\.backup\.zip|\.env)/i;
// 公開してよい JSON は同梱のオリジナルサンプルだけ
const ALLOWED_JSON = new Set(['sample-pack.ja.json']);
const SECRET = /(sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const problems = [];
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (FORBIDDEN_EXT.test(rel)) problems.push(`禁止拡張子: ${rel}`);
  if (FORBIDDEN_NAME.test(rel)) problems.push(`禁止名: ${rel}`);
  if (/\.json$/i.test(rel) && !ALLOWED_JSON.has(rel.split('/').pop())) {
    if (!/manifest\.webmanifest$/.test(rel)) problems.push(`許可リスト外のJSON: ${rel}`);
  }
  if (/\.(js|css|html|json|webmanifest|svg|txt)$/i.test(rel) && SECRET.test(readFileSync(f, 'utf8'))) problems.push(`秘密情報らしき文字列: ${rel}`);
}

// 同梱サンプルは「オリジナル教材」であることを確認 (第三者教材の混入防止)
const sample = files.find((f) => f.endsWith('sample-pack.ja.json'));
if (sample) {
  const j = JSON.parse(readFileSync(sample, 'utf8'));
  for (const q of j.questions) if (q.source?.sourceId !== 'handoff-original') problems.push(`サンプルに出典不明の問題: ${q.id}`);
}

console.log(`dist内のファイル ${files.length}件:`);
for (const f of files) console.log('  ' + relative(root, f).replace(/\\/g, '/'));
if (problems.length) {
  console.error('\n公開物の検査に失敗しました:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('\n公開物の検査: OK (原本・私的パック・秘密情報なし)');
