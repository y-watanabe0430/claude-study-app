// 明示的な否定・限定・全称・条件・比較の語を含む「選択肢・問題文」を、英語と日本語の対で書き出す(人が見比べる用)。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
const EXAMS = ['CCDV-F', 'CCAO-F', 'CCAR-P', 'CCAR-F'];
const STRICT = /\b(not|never|cannot|can't|won't|without|none|neither|nor|only|solely|rather than|instead of|unless|except|always|every|at least|at most|no more|exactly|regardless|fewer|less than|more than|either|both|whether|until|no)\b|n't\b/i;
const NOGO = /go\/no-go|no-go/i;
const out = [];
for (const exam of EXAMS) {
  const src = JSON.parse(readFileSync(`translations/src/${exam}.json`, 'utf8'));
  const tr = {}; const dir = `translations/ja/${exam}`;
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) Object.assign(tr, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  for (const q of src) {
    const t = tr[q.id]; if (Array.isArray(t.p)) continue;
    const items = [];
    if (STRICT.test(q.stem.replace(NOGO, ''))) items.push(['問題文', q.stem, t.s]);
    q.choices.forEach((c, i) => { if (STRICT.test(c.replace(NOGO, ''))) items.push([`選択肢${'ABCDE'[i]}`, c, t.c[i]]); });
    if (items.length) out.push({ exam, id: q.id, items });
  }
}
mkdirSync('translations/review', { recursive: true });
writeFileSync('translations/review/pairs.json', JSON.stringify(out, null, 1));
console.log('問題', out.length, '/ 対', out.reduce((n, x) => n + x.items.length, 0));
