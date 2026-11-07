// 正解の選択肢について、英語の原文と日本語訳を対で書き出す(訳が選択肢の間で入れ替わっていないかを人が確認する)。
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { EXAMS, loadExam } from './lib/load.mjs';
const ov = existsSync('translations/answer-overrides.json') ? JSON.parse(readFileSync('translations/answer-overrides.json', 'utf8')) : {};
const out = []; let n = 0;
for (const ex of EXAMS) {
  const { records } = loadExam('inputs_private', ex);
  const tr = {}; const dir = `translations/ja/${ex}`;
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) Object.assign(tr, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
  for (const r of records.filter((x) => x.lang === 'en' && x.format !== 'Scenario matching')) {
    const qid = `${ex}:matthew:${r.id}`;
    const letters = ov[qid] ? ov[qid].choiceIds.map((c) => c.toUpperCase()) : r.answerRaw.split(/[,、\s]+/).filter(Boolean);
    for (const L of letters) {
      const i = 'ABCDE'.indexOf(L); n++;
      out.push(`${n}. ${ex} ${r.id} 正解${L}\n  EN: ${r.choices[i].text.replace(/\s+/g, ' ')}\n  JA: ${tr[r.id].c[i].replace(/\s+/g, ' ')}`);
    }
  }
}
writeFileSync('translations/review/answers.txt', out.join('\n'));
console.log(n, '件');
