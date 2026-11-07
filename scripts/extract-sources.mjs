// Matthew版(英語)の翻訳対象を抽出する。出力は Git 管理外の translations/src/
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadExam, EXAMS } from './lib/load.mjs';

const root = process.argv[2] ?? 'inputs_private';
mkdirSync('translations/src', { recursive: true });
let total = 0, chars = 0;
const domains = {};
for (const ex of EXAMS) {
  const { records } = loadExam(root, ex);
  const en = records.filter((r) => r.lang === 'en').map((r) => {
    domains[r.domain] = ex;
    const o = { id: r.id, stem: r.stem, choices: r.choices.map((c) => c.text), explanation: r.explanation };
    if (r.scenario) o.scenario = r.scenario;
    if (r.background) o.background = r.background;
    if (r.wrong) o.wrong = r.wrong;
    if (r.supplement) o.supplement = r.supplement;
    if (r.runnerUp) o.runnerUp = r.runnerUp;
    if (r.runnerUpWhy) o.runnerUpWhy = r.runnerUpWhy;
    if (r.format === 'Scenario matching') { o.matchingCandidates = r.matchingCandidates; o.answerText = r.answerText; }
    return o;
  });
  writeFileSync(`translations/src/${ex}.json`, JSON.stringify(en, null, 1));
  total += en.length; chars += JSON.stringify(en).length;
  console.log(ex, en.length, '問');
}
writeFileSync('translations/src/_domains.json', JSON.stringify(domains, null, 1));
console.log('合計', total, '問 /', chars, '文字(JSON)');
console.log(Object.keys(domains).length, '分野名');
