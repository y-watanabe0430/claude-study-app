// 誤答の解説が指している選択肢の記号(A〜E)が、英語と日本語訳で一致しているかを照合する。
import { readFileSync, readdirSync } from 'node:fs';
const EXAMS = ['CCDV-F', 'CCAO-F', 'CCAR-P', 'CCAR-F'];
const tok = (s) => [...String(s).matchAll(/(?<![A-Za-z0-9_])([A-E])(?![A-Za-z0-9_])/g)].map((m) => m[1]).join(''); // 順序まで照合する
let bad = 0, checked = 0;
for (const ex of EXAMS) {
  const src = JSON.parse(readFileSync(`translations/src/${ex}.json`, 'utf8'));
  const tr = {}; const dir = `translations/ja/${ex}`;
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) Object.assign(tr, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  for (const q of src) {
    if (!q.wrong || !tr[q.id].w) continue;
    checked++;
    const a = tok(q.wrong), b = tok(tr[q.id].w);
    if (a !== b) { bad++; console.log(`${ex} ${q.id}: 英 ${a} / 訳 ${b}\n   EN: ${q.wrong.replace(/\s+/g, ' ').slice(0, 170)}\n   JA: ${tr[q.id].w.replace(/\s+/g, ' ').slice(0, 170)}`); }
  }
}
console.log(`\n照合 ${checked}問 / 不一致 ${bad}問`);
