// 「正解の理由」「誤答の解説」のうち、強い否定・限定・断定を含むものを、英語と日本語の対で書き出す(人が見比べる用)。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const EXAMS = ['CCDV-F', 'CCAO-F', 'CCAR-P', 'CCAR-F'];
const STRICT = /\b(not|never|cannot|without|none|neither|nor|only|rather than|instead of|unless|except|always|at least|at most|no longer|fewer|false|wrong|impossible|exceed|regardless|even if|but not|not just)\b|n't\b|\bno\b(?!-go)/i;
const lines = []; let n = 0;
for (const exam of EXAMS) {
  const src = JSON.parse(readFileSync(`translations/src/${exam}.json`, 'utf8'));
  const tr = {}; const dir = `translations/ja/${exam}`;
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) Object.assign(tr, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  for (const q of src) {
    const t = tr[q.id];
    for (const [w, en, ja] of [['正解の理由', q.explanation, t.e], ['誤答の解説', q.wrong, t.w]]) {
      if (!en || !STRICT.test(en)) continue;
      n++; lines.push(`${n}. [${exam} ${q.id} ${w}]\n  EN: ${en.replace(/\s+/g, ' ')}\n  JA: ${String(ja).replace(/\s+/g, ' ')}`);
    }
  }
}
writeFileSync('translations/review/pairs2.txt', lines.join('\n'));
console.log(n, '対 /', lines.join('\n').length, '文字');
