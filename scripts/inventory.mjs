// inputs_private/ の元教材を棚卸しして INPUT_AUDIT.md を作る (ファイルの有無とサイズのみ。内容は読まない)
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../inputs_private', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const expected = [
  ['必須', 'CCDV-F_Question_Archive.xlsx', 106],
  ['必須', 'CCAO-F_Question_Archive.xlsx', 120],
  ['必須', 'CCAR-P_Question_Archive.xlsx', 126],
  ['必須', 'CCAR-F_Question_Archive.xlsx', 120],
  ['推奨', 'Claude_4_Exams_Diagrams_JA.zip', null],
];
const present = existsSync(dir) ? readdirSync(dir).filter((n) => n !== 'README.md') : [];
const rows = expected.map(([req, name, n]) => {
  const p = join(dir, name);
  const has = present.includes(name);
  return `| ${req} | ${name} | ${n ?? '図50枚'} | ${has ? `あり (${statSync(p).size} bytes)` : '**未添付**'} |`;
});
const extra = present.filter((n) => !expected.some(([, e]) => e === n));
const missing = expected.filter(([, name]) => !present.includes(name)).length;
const md = `# INPUT_AUDIT (元教材の棚卸し)

作成: ${new Date().toISOString()} / 対象: inputs_private/

| 区分 | ファイル | 期待件数 | 状態 |
|---|---|---|---|
${rows.join('\n')}

${extra.length ? `その他のファイル: ${extra.join(', ')}\n` : ''}
## 判定
${missing === 0 ? '全ファイルが揃っています。変換前にシート名・実件数・言語・図表を人が確認してください (このスクリプトは内容を読みません)。' : `**${missing} 件が未添付のため、教材準備(段階B)は未着手です。** 外部サイトから代替教材を収集することはしません。\`inputs_private/\` に上記ファイルを置いてから再実行してください。`}

※ 期待件数は保存時の記録であり、実体の件数・正解の正しさを保証しません。
`;
writeFileSync(new URL('../docs/INPUT_AUDIT.md', import.meta.url), md);
console.log(md);
