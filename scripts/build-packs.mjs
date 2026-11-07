// 旧Excel + 日本語化済みの翻訳(translations/ja)から、資格別・全資格の問題パックを作る。
// 入力 inputs_private/ と translations/、出力 dist-private/ はすべて Git 管理外。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { EXAMS, EXAM_NAMES, EXPECTED, loadExam, loadFigures, loadLessons, splitWrong } from './lib/load.mjs';

const ROOT = 'inputs_private';
const OUT = 'dist-private';
const now = new Date().toISOString();
mkdirSync(OUT, { recursive: true });
mkdirSync('translations', { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const domains = readJson('translations/ja/domains.json');
// 正解の訂正(根拠つき)。原本の解答欄が原本自身の他の記述と矛盾する問題だけに適用する
const overrides = existsSync('translations/answer-overrides.json') ? readJson('translations/answer-overrides.json') : {};
const hasJa = (s) => /[぀-ヿ一-鿿]/.test(s ?? '');

function loadTranslations(exam) {
  const dir = `translations/ja/${exam}`;
  const all = {};
  if (!existsSync(dir)) return { all, scenarios: {} };
  for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) Object.assign(all, readJson(`${dir}/${f}`));
  const sp = `${dir}/_scenarios.json`;
  return { all, scenarios: existsSync(sp) ? readJson(sp) : {} };
}

/** 英語に含まれる数値・コード風トークンが日本語訳にも残っているかの点検 (意味の保全の目安。誤り検出の保証ではない) */
function tokenWarnings(src, ja) {
  const en = [src.stem, ...src.choices.map((c) => c.text), src.explanation, src.wrong].join('\n');
  const jaText = [ja.s, ...(ja.c ?? []), ...(ja.p ?? []), ...(ja.k ?? []), ja.e, ja.w].filter(Boolean).join('\n');
  const compact = jaText.replace(/,/g, '').replace(/\s/g, '');
  const miss = new Set();
  // コード風の識別子 (アンダースコア・camelCase・数字を含む)
  for (const m of en.matchAll(/[A-Za-z][A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
    const t = m[0];
    if (t.length >= 4 && /_|[a-z][A-Z]|\d/.test(t) && !jaText.includes(t)) miss.add(t);
  }
  // 数値 (桁区切り・k 表記・万 への言い換えを許容)
  for (const m of en.matchAll(/\d[\d,]*(?:\.\d+)?k?/g)) {
    const raw = m[0].replace(/,/g, '');
    const n = raw.endsWith('k') ? Number(raw.slice(0, -1)) * 1000 : Number(raw);
    if (!Number.isFinite(n) || String(n).length < 2) continue;
    const forms = [String(n), raw, n >= 10000 && n % 10000 === 0 ? n / 10000 + '万' : null, n >= 1000 && n % 1000 === 0 ? n / 1000 + 'k' : null].filter(Boolean);
    if (!forms.some((f) => compact.includes(f))) miss.add(m[0]);
  }
  return [...miss];
}

const report = { createdAt: now, expected: EXPECTED, exams: {}, totals: {} };
const idMap = [];
const checkpoint = {};
const allQuestions = [];
const allLessons = [];
const allAssetFiles = new Map(); // assets/xxx.png -> Uint8Array

for (const exam of EXAMS) {
  const { records, sheets } = loadExam(ROOT, exam);
  const figs = loadFigures(ROOT, exam);
  const { all: tr, scenarios } = loadTranslations(exam);
  const lessons = exam === 'CCDV-F' ? loadLessons(sheets) : [];
  const questions = [];
  const R = {
    expected: EXPECTED[exam], actual: records.length,
    bySource: {}, ready: 0, needsReview: 0, translationStatus: {}, quarantine: [], tokenWarnings: [],
    figuresInCatalog: Object.keys(figs).length, figuresLinkedToQuestions: 0, figuresLinkedToLessons: 0, figuresMissingFile: [],
    lessons: lessons.length, wrongSplit: { perChoice: 0, block: 0, none: 0 },
  };

  const figAsset = (figId, placement) => {
    const f = figs[figId];
    if (!f) return { missing: `図表ID ${figId} が図表一覧にない` };
    const p = `${ROOT}/diagrams/images/${f.file}`;
    if (!existsSync(p)) { R.figuresMissingFile.push(f.file); return { missing: `画像ファイル ${f.file} がない` }; }
    const path = `assets/${f.file}`;
    allAssetFiles.set(path, new Uint8Array(readFileSync(p)));
    const terms = f.terms.length ? ` 図中の英語の対訳：${f.terms.map(([e, j]) => `${e}＝${j}`).join('、')}。` : '';
    return { asset: { path, altJa: `${f.caption}。${terms}`.trim(), placement, sourceFigureId: f.id, sourceCardId: f.cardId } };
  };

  for (const rec of records) {
    const qid = `${exam}:${rec.source}:${rec.id}`;
    R.bySource[rec.source] = (R.bySource[rec.source] ?? 0) + 1;
    const reasons = [];
    const notes = [];
    const src = { stem: rec.stem, choices: rec.choices, explanation: rec.explanation, wrong: rec.wrong };
    let ja, domainJa, translationStatus;
    const supplemental = {};
    let originalText;

    if (rec.lang === 'en') {
      const t = tr[rec.id];
      domainJa = domains[rec.domain] ?? rec.domain;
      if (!t) { reasons.push('日本語訳が未作成'); translationStatus = 'pending'; ja = { s: rec.stem, e: rec.explanation, c: rec.choices.map((c) => c.text) }; }
      else { translationStatus = 'translated_ja'; ja = t; }
      originalText = { stem: rec.stem, choices: rec.choices.map((c) => c.text), explanation: rec.explanation, ...(rec.wrong ? { wrongExplanation: rec.wrong } : {}), ...(rec.scenario ? { scenario: rec.scenario } : {}), ...(rec.background ? { background: rec.background } : {}) };
      if (t) {
        const miss = tokenWarnings(rec, t);
        if (miss.length) R.tokenWarnings.push({ id: qid, missing: miss });
        const needJa = (en, j) => /[A-Za-z]{3,}/.test(en) && !hasJa(j); // 数字や記号だけの選択肢(例: 2 → 3 → 1)は日本語を含まなくてよい
        const bad = [needJa(rec.stem, t.s), needJa(rec.explanation, t.e), ...rec.choices.map((c, i) => rec.format === 'Scenario matching' ? false : needJa(c.text, (t.c ?? [])[i]))];
        if (bad.some(Boolean)) reasons.push('日本語訳に日本語を含まない項目がある');
      }
    } else {
      domainJa = rec.domain; translationStatus = 'original_ja';
      ja = { s: rec.stem, e: rec.explanation, c: rec.choices.map((c) => c.text) };
    }
    R.translationStatus[translationStatus] = (R.translationStatus[translationStatus] ?? 0) + 1;

    const q = {
      id: qid, revision: overrides[qid]?.revision ?? 1, exam, type: 'single', domainJa, status: 'ready', translationStatus,
      ja: { stem: ja.s, explanation: ja.e },
      source: { sourceId: rec.source, originalId: rec.id, originalNumber: rec.originalNumber, url: rec.url || undefined, savedAt: rec.savedAt || undefined, sheetRow: rec.sheetRow, pdfPages: rec.source === 'matthew' ? rec.pdfPages : undefined },
      correctAnswer: {}, assets: [], reviewNotes: notes, duplicateGroupId: null,
    };
    if (originalText) q.originalText = originalText;

    // 背景・シナリオ
    if (rec.lang === 'en') {
      if (rec.scenario) q.ja.scenario = scenarios[rec.scenario] ?? undefined;
      if (rec.background) {
        const b = scenarios[rec.background];
        q.ja.background = b ? b.replace(/^シナリオ[^\n]*\n\n/, '') : undefined;
        if (!b || !q.ja.scenario) reasons.push('シナリオ／共通背景の日本語訳が未作成');
      }
    } else {
      if (rec.scenario) q.ja.scenario = rec.scenario;
      if (rec.background) q.ja.background = rec.background;
    }
    for (const k of ['scenario', 'background']) if (q.ja[k] === undefined) delete q.ja[k];

    if (rec.format === 'Scenario matching') {
      q.type = 'matching';
      const cands = rec.matchingCandidates.split(' · ').map((s) => s.trim());
      const prompts = ja.p ?? [];
      const ck = ja.k ?? [];
      if (cands.length !== ck.length || !prompts.length) reasons.push('対応付けの小設問・候補の訳が不足');
      q.matching = { prompts: prompts.map((t, i) => ({ id: `p${i + 1}`, textJa: t })), candidates: ck.map((t, i) => ({ id: `k${i + 1}`, textJa: t })), allowReuse: true };
      const matches = {};
      for (const part of rec.answerText.split(';')) {
        const m = part.trim().match(/^(\d+)\s*→\s*(.+)$/);
        if (!m) { reasons.push(`対応付けの正解を解析できない: ${part}`); continue; }
        const ci = cands.indexOf(m[2].trim());
        if (ci < 0) reasons.push(`正解の候補が候補一覧にない: ${m[2]}`); else matches[`p${m[1]}`] = `k${ci + 1}`;
      }
      q.correctAnswer = { matches };
      q.matching.allowReuse = new Set(Object.values(matches)).size < Object.values(matches).length;
      if (Object.keys(matches).length !== prompts.length) reasons.push('小設問の数と正解の数が一致しない');
      supplemental.sourceNote = 'この問題は旧Excelでは、問題文の中に小設問 1〜5 が番号付きで含まれていた。小設問5つと候補をすべて保持している。';
    } else {
      const letters = rec.choices.map((c) => c.label);
      const order = rec.raw?.order;
      q.choices = rec.choices.map((c, i) => ({
        id: c.label.toLowerCase(), textJa: ja.c[i] ?? c.text,
        originalLabel: rec.source === 'minorun' && Array.isArray(order) && order.length === letters.length ? 'ABCDE'[order[i]] : c.label,
      }));
      const ovr = overrides[qid];
      const correct = ovr ? ovr.choiceIds.map((c) => c.toUpperCase()) : rec.answerRaw.split(/[,、\s]+/).filter(Boolean);
      q.correctAnswer = { choiceIds: correct.map((l) => l.toLowerCase()) };
      const req = Number(rec.required);
      const multi = /Multiple response/i.test(rec.format) || req > 1;
      q.type = multi ? 'multiple' : 'single';
      q.requiredSelections = Number.isFinite(req) && req > 0 ? req : correct.length;
      // 整合性の検査 (隔離判定)
      const ids = new Set(q.choices.map((c) => c.id));
      if (q.choices.length < 2) reasons.push('選択肢が2つ未満');
      if (correct.length === 0) reasons.push('正解が空');
      for (const c of q.correctAnswer.choiceIds) if (!ids.has(c)) reasons.push(`正解 ${c.toUpperCase()} が選択肢にない`);
      if (q.type === 'single' && correct.length !== 1 && !rec.note) reasons.push(`原文の不整合：設問は${q.requiredSelections}個選択だが、解答欄は${rec.answerRaw}`);
      if (q.type === 'multiple' && correct.length !== q.requiredSelections) reasons.push(`指定選択数(${q.requiredSelections})と正解数(${correct.length})が不一致`);
    }

    // 誤答解説・補足
    if (rec.lang === 'en') {
      if (rec.wrong) { supplemental.wrongExplanation = ja.w ?? ''; if (!ja.w) reasons.push('誤答の解説の訳が未作成'); R.wrongSplit.block++; }
      else R.wrongSplit.none++;
    } else if (q.choices && rec.wrong) {
      const parts = splitWrong(rec);
      const need = q.choices.length - q.correctAnswer.choiceIds.length;
      if (Object.keys(parts).length === need && need > 0) {
        for (const c of q.choices) if (parts[c.originalLabel === undefined ? '' : rec.choices.find((x) => x.label.toLowerCase() === c.id)?.label]) {
          c.explanationJa = parts[rec.choices.find((x) => x.label.toLowerCase() === c.id).label];
        }
        R.wrongSplit.perChoice++;
      } else { supplemental.wrongExplanation = rec.wrong; R.wrongSplit.block++; notes.push('誤答の解説を選択肢ごとに分解できなかったため、原文のまとまりのまま保存'); }
    } else R.wrongSplit.none++;
    if (rec.supplement) supplemental.note = rec.supplement;
    if (rec.runnerUp) {
      const c = rec.choices.find((x) => x.label === rec.runnerUp);
      supplemental.runnerUp = `${rec.runnerUp}. ${c?.text ?? ''}${rec.runnerUpWhy ? `\n${rec.runnerUpWhy}` : ''}`;
    }
    if (Object.keys(supplemental).length) q.supplemental = supplemental;

    // 図表 (みのるん版のみ。問題文側に置く)
    for (const fid of rec.figureIds) {
      const r = figAsset(fid, 'stem');
      if (r.asset) { q.assets.push(r.asset); R.figuresLinkedToQuestions++; } else reasons.push(r.missing);
    }

    const ov = overrides[qid];
    if (ov) {
      notes.push(`正解を訂正 (revision ${ov.revision}, ${ov.decidedAt})。原本の解答欄: 「${ov.originalAnswerKey}」。${ov.reason}`);
      (q.supplemental ??= {}).originalAnswerKey = ov.originalAnswerKey;
      (R.overrides ??= []).push({ id: qid, revision: ov.revision, originalAnswerKey: ov.originalAnswerKey, corrected: ov.choiceIds });
    } else if (rec.note) notes.push(rec.note);
    if (reasons.length || (rec.note && !ov)) {
      q.status = 'needs_review';
      for (const r of reasons) if (!notes.includes(r)) notes.push(r);
      R.quarantine.push({ id: qid, reasons: [...(rec.note && !ov ? [rec.note] : []), ...reasons] });
    }
    if (q.status === 'ready') R.ready++; else R.needsReview++;
    if (!q.assets.length) delete q.assets;
    questions.push(q);
    checkpoint[qid] = { translationStatus, status: q.status, warnings: R.tokenWarnings.filter((w) => w.id === qid).flatMap((w) => w.missing) };
    idMap.push({ questionId: qid, exam, originalId: rec.id, source: rec.source, sheetRow: rec.sheetRow, figureIds: rec.figureIds });
  }

  // 補足講義
  const outLessons = lessons.map((l) => {
    const assets = [];
    for (const fid of l.figureIds) { const r = figAsset(fid, 'explanation'); if (r.asset) { assets.push({ ...r.asset, placement: 'lesson' }); R.figuresLinkedToLessons++; } }
    return {
      id: l.id, titleJa: l.titleJa, domainRaw: l.domainRaw, leadJa: l.leadJa, points: l.points, assets,
      source: { sourceId: 'minorun', sheetRow: l.sheetRow }, reviewStatus: 'original_ja',
    };
  });
  R.lessonList = outLessons.map((l) => ({ id: l.id, points: l.points.length, figures: l.assets.length }));
  R.figuresUnlinked = Object.keys(figs).filter((id) => !records.some((r) => r.figureIds.includes(id)) && !lessons.some((l) => l.figureIds.includes(id)));
  report.exams[exam] = R;
  allQuestions.push(...questions);
  allLessons.push(...outLessons);
  // この資格のパック
  const pack = {
    schemaVersion: '1.0', packId: `claude-${exam.toLowerCase()}-ja`, version: '1.0.0',
    titleJa: `${exam} ${EXAM_NAMES[exam]} 日本語問題集`, language: 'ja', createdAt: now,
    questions, lessons: outLessons,
  };
  writePack(`${OUT}/${exam}`, pack, new Set([...questions.flatMap((q) => (q.assets ?? []).map((a) => a.path)), ...outLessons.flatMap((l) => l.assets.map((a) => a.path))]));
}

function writePack(base, pack, assetPaths) {
  const files = { 'pack.json': strToU8(JSON.stringify(pack)) };
  for (const p of assetPaths) files[p] = allAssetFiles.get(p);
  writeFileSync(`${base}.pack.zip`, zipSync(files, { level: 6 }));
  writeFileSync(`${base}.pack.json`, JSON.stringify(pack, null, 1));
}

// 全資格まとめ
const allPack = {
  schemaVersion: '1.0', packId: 'claude-all-ja', version: '1.0.0', titleJa: 'Claude認定4資格 日本語問題集（全資格）', language: 'ja', createdAt: now,
  questions: allQuestions, lessons: allLessons,
};
writePack(`${OUT}/ALL`, allPack, new Set(allAssetFiles.keys()));

const sum = (f) => EXAMS.reduce((n, e) => n + f(report.exams[e]), 0);
report.totals = {
  expected: 472, actual: sum((r) => r.actual), matthew: sum((r) => r.bySource.matthew ?? 0), minorun: sum((r) => r.bySource.minorun ?? 0),
  ready: sum((r) => r.ready), needsReview: sum((r) => r.needsReview),
  translated_ja: sum((r) => r.translationStatus.translated_ja ?? 0), original_ja: sum((r) => r.translationStatus.original_ja ?? 0), pending: sum((r) => r.translationStatus.pending ?? 0),
  figuresExpected: 50, figuresInCatalog: sum((r) => r.figuresInCatalog), figuresLinkedToQuestions: sum((r) => r.figuresLinkedToQuestions), figuresLinkedToLessons: sum((r) => r.figuresLinkedToLessons),
  figuresMissingFile: sum((r) => r.figuresMissingFile.length), lessons: sum((r) => r.lessons), tokenWarnings: sum((r) => r.tokenWarnings.length),
};
writeFileSync(`${OUT}/conversion-report.json`, JSON.stringify(report, null, 1));
writeFileSync(`${OUT}/id-map.json`, JSON.stringify(idMap, null, 1));
writeFileSync('translations/checkpoint.json', JSON.stringify({ updatedAt: now, questions: checkpoint }, null, 1));
console.log(JSON.stringify(report.totals, null, 1));
for (const e of EXAMS) {
  const r = report.exams[e];
  console.log(e, `期待${r.expected}/実${r.actual}`, JSON.stringify(r.bySource), `ready ${r.ready} 隔離 ${r.needsReview}`, `図→問題${r.figuresLinkedToQuestions} 図→講義${r.figuresLinkedToLessons}/${r.figuresInCatalog}`, `誤答解説 ${JSON.stringify(r.wrongSplit)}`);
  for (const q of r.quarantine) console.log('   隔離', q.id, '|', q.reasons.join(' / '));
}
void copyFileSync;
