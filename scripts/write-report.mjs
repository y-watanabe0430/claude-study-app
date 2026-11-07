// dist-private/conversion-report.json から IMPORT_REPORT.md を作る。
//  - dist-private/IMPORT_REPORT.md : 詳細(隔離理由など)。非公開。
//  - docs/IMPORT_REPORT.md         : 件数のみ。問題本文・翻訳文は含まない(公開リポジトリ用)。
import { readFileSync, writeFileSync } from 'node:fs';

const r = JSON.parse(readFileSync('dist-private/conversion-report.json', 'utf8'));
const t = r.totals;
const exams = Object.entries(r.exams);

const table = (detail) => `| 資格 | 期待 | 実数 | Matthew(英) | みのるん(日) | 準備完了 | 隔離 | 日本語化済 | 図→問題 | 図→講義 | 講義 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${exams.map(([e, x]) => `| ${e} | ${x.expected} | ${x.actual} | ${x.bySource.matthew ?? 0} | ${x.bySource.minorun ?? 0} | ${x.ready} | ${x.needsReview} | ${x.translationStatus.translated_ja ?? 0} | ${x.figuresLinkedToQuestions} | ${x.figuresLinkedToLessons} | ${x.lessons} |`).join('\n')}
| **計** | **${t.expected}** | **${t.actual}** | **${t.matthew}** | **${t.minorun}** | **${t.ready}** | **${t.needsReview}** | **${t.translated_ja}** | **${t.figuresLinkedToQuestions}** | **${t.figuresLinkedToLessons}** | **${t.lessons}** |
`;

const head = `# IMPORT_REPORT (教材変換の結果)

生成: ${r.createdAt}

## 件数

${table()}
- 英語原文(Matthew)236問 → 日本語化済み ${t.translated_ja}問 / 未翻訳 ${t.pending}問
- 日本語原文(みのるん)236問 → そのまま取り込み ${t.original_ja}問
- 図表 ${t.figuresInCatalog}/${t.figuresExpected}枚が図表IDで関連付け済み (問題 ${t.figuresLinkedToQuestions}・講義 ${t.figuresLinkedToLessons})、画像ファイル欠落 ${t.figuresMissingFile}件
- 補足講義 ${t.lessons}/10件
- 数値・コード語の保全点検の警告 ${t.tokenWarnings}件

## 隔離 (needs_review: 通常の出題・採点に含めない)

${t.needsReview}問。理由は非公開の詳細版を参照 (CCDV-F:matthew:MP-5.9 = 設問は1個選択だが解答欄が「A,D」)。

## 欠落・未実施

- 不足ファイル: なし (期待したExcel4冊・図表Excel4冊・原図PNG50枚を受領済み)。
- **翻訳レビューと、解答の技術的検証は別**。日本語化の完了は、全問の正解が正しいことを意味しない。正解の技術的検証は未実施。
- Matthew版の「誤答の解説」は、選択肢ごとの対応が一意でないため分解せず、原文のまとまりのまま(日本語訳して)保存している。みのるん版は選択肢ごとに分解済み。
- 受験時点の公式Exam Guideとの照合は未実施 (保存は2026-10-31)。
`;

const detail = `${head}
## 詳細 (非公開)

${exams.map(([e, x]) => `### ${e}
- 誤答解説: 選択肢ごと ${x.wrongSplit.perChoice} / 原文のまとまり ${x.wrongSplit.block} / なし(対応付け等) ${x.wrongSplit.none}
- 隔離: ${x.quarantine.length ? x.quarantine.map((q) => `\n  - ${q.id}: ${q.reasons.join(' / ')}`).join('') : 'なし'}
- 数値・コード語の警告: ${x.tokenWarnings.length ? x.tokenWarnings.map((w) => `\n  - ${w.id}: ${w.missing.join(', ')}`).join('') : 'なし'}
- 図表の未使用: ${x.figuresUnlinked.length ? x.figuresUnlinked.join(', ') : 'なし'}
`).join('\n')}`;

writeFileSync('dist-private/IMPORT_REPORT.md', detail);
writeFileSync('docs/IMPORT_REPORT.md', head);
console.log(head);
