// inputs_private/ の元教材を棚卸しして docs/INPUT_AUDIT.md を作る。
// 記録するのはファイルの有無・シート名・件数・言語・図表の対応だけで、問題本文は書かない(公開リポジトリに置くため)。
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { EXAMS, EXPECTED, loadExam, loadFigures, loadLessons } from './lib/load.mjs';

const ROOT = 'inputs_private';
const rows = [];
let missing = 0;
const detail = [];
let totalQ = 0, totalFig = 0, totalLessons = 0;

for (const ex of EXAMS) {
  const qf = `${ROOT}/archives/${ex}_Question_Archive.xlsx`;
  const df = `${ROOT}/diagrams/${ex}_Diagrams_JA.xlsx`;
  const qHas = existsSync(qf), dHas = existsSync(df);
  if (!qHas) missing++;
  if (!dHas) missing++;
  rows.push(`| 必須 | ${ex}_Question_Archive.xlsx | ${EXPECTED[ex]} | ${qHas ? `あり (${statSync(qf).size} bytes)` : '**未添付**'} |`);
  rows.push(`| 推奨 | ${ex}_Diagrams_JA.xlsx | 図表 | ${dHas ? `あり (${statSync(df).size} bytes)` : '**未添付**'} |`);
  if (qHas && dHas) {
    const { records, sheets } = loadExam(ROOT, ex);
    const figs = loadFigures(ROOT, ex);
    const lessons = ex === 'CCDV-F' ? loadLessons(sheets) : [];
    const by = (f) => records.filter((r) => r.source === f).length;
    const png = Object.values(figs).filter((f) => existsSync(`${ROOT}/diagrams/images/${f.file}`)).length;
    const used = new Set([...records.flatMap((r) => r.figureIds), ...lessons.flatMap((l) => l.figureIds)]);
    totalQ += records.length; totalFig += Object.keys(figs).length; totalLessons += lessons.length;
    detail.push(`| ${ex} | ${Object.keys(sheets).join(' / ')} | ${records.length} (期待 ${EXPECTED[ex]}) | ${by('matthew')} / ${by('minorun')} | ${Object.keys(figs).length} (PNG ${png}) | ${used.size} | ${lessons.length} |`);
  }
}
const pngs = existsSync(`${ROOT}/diagrams/images`) ? readdirSync(`${ROOT}/diagrams/images`).filter((n) => n.endsWith('.png')).length : 0;

const md = `# INPUT_AUDIT (元教材の棚卸し)

作成: ${new Date().toISOString()} / 対象: inputs_private/ (Git管理外。本文は記録しない)

## 受領ファイル

| 区分 | ファイル | 期待 | 状態 |
|---|---|---|---|
${rows.join('\n')}

原図PNG: ${pngs}枚 (diagrams/images/)

## 実件数の照合 (「問題一覧」シートのみを主入力とし、「問題カード」「原文データ」は別問題として数えない)

| 資格 | シート | 実件数 | Matthew(英語) / みのるん(日本語) | 図表 | 図表IDが使われている | 補足講義 |
|---|---|---|---|---|---|---|
${detail.join('\n')}

合計: 問題 ${totalQ} / 期待 472、図表 ${totalFig} / 期待 50、補足講義 ${totalLessons} / 期待 10。

## 判定
${missing === 0 && totalQ === 472 ? '期待どおり全ファイルが揃い、実件数が期待値と一致しました。' : `**不足があります。** 未添付 ${missing} 件 / 実件数 ${totalQ}。`}

※ 期待件数は保存時の記録であり、正解の正しさ・翻訳の正確さを保証しません。原文の別シート(問題カード・原文データ)は二重取り込みしていません。
`;
writeFileSync(new URL('../docs/INPUT_AUDIT.md', import.meta.url), md);
console.log(md);
