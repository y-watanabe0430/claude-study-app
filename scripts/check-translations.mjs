import { readFileSync, readdirSync } from 'node:fs';
const ex = process.argv[2]; const d = `translations/ja/${ex}/`;
const all = {}; for (const f of readdirSync(d).filter((x) => /^\d+\.json$/.test(x))) Object.assign(all, JSON.parse(readFileSync(d + f, 'utf8')));
const src = JSON.parse(readFileSync(`translations/src/${ex}.json`, 'utf8'));
const miss = src.filter((q) => !all[q.id]).map((q) => q.id);
const extra = Object.keys(all).filter((id) => !src.find((q) => q.id === id));
const bad = src.filter((q) => all[q.id] && !all[q.id].p && all[q.id].c?.length !== q.choices.length).map((q) => q.id);
console.log(ex, '翻訳', Object.keys(all).length, '/', src.length, '| 欠落:', miss.join() || 'なし', '| 余分:', extra.join() || 'なし', '| 選択肢数不一致:', bad.join() || 'なし');
