// 旧Excel(Question Archive / Diagrams_JA)を読み、472問の中間レコードにする。外部通信なし。
import { readXlsx, table } from './xlsx.mjs';

export const EXAMS = ['CCDV-F', 'CCAO-F', 'CCAR-P', 'CCAR-F'];
export const EXAM_NAMES = { 'CCDV-F': '開発者・基礎', 'CCAO-F': 'アソシエイト・基礎', 'CCAR-P': 'アーキテクト・上級', 'CCAR-F': 'アーキテクト・基礎' };
export const EXPECTED = { 'CCDV-F': 106, 'CCAO-F': 120, 'CCAR-P': 126, 'CCAR-F': 120 };
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const str = (v) => (v == null ? '' : String(v));

export function loadExam(root, exam) {
  const sheets = readXlsx(`${root}/archives/${exam}_Question_Archive.xlsx`);
  const rows = table(sheets['問題一覧']);
  // 「問題一覧」だけを主入力にする。「問題カード」「原文データ」の同内容は別問題として数えない
  const raw = {};
  for (const r of table(sheets['原文データ'])) {
    if (r['教材'] === 'みのるん' && r['原文形式'] === 'q') {
      try { const j = JSON.parse(r['原文内容']); raw[j.id] = j; } catch { /* 破損は無視し、一覧側の値を使う */ }
    }
  }
  const records = rows.map((r, i) => {
    const matthew = r['教材'] === 'Matthew Purcell';
    const id = str(r['管理ID']);
    const choices = LETTERS.map((L) => ({ label: L, text: str(r['選択肢' + L]) })).filter((c) => c.text !== '');
    return {
      exam, id, sheetRow: i + 2,
      source: matthew ? 'matthew' : 'minorun',
      lang: matthew ? 'en' : 'ja',
      originalNumber: str(r['原問題番号']),
      domain: str(r['分野']),
      format: str(r['設問形式']),
      required: r['指定選択数'],
      scenario: str(r['シナリオ']), background: str(r['共通背景']),
      stem: str(r['問題文']),
      choices,
      matchingCandidates: str(r['対応付け候補']),
      answerRaw: str(r['原文の正解']),
      answerText: str(r['正解内容']),
      explanation: str(r['正解の解説']),
      wrong: str(r['誤答の解説']),
      supplement: str(r['補足解説']),
      runnerUp: str(r['次点の選択肢']),
      runnerUpWhy: str(r['次点が誤りの理由']),
      figureIds: str(r['図表ID']).split(/[,、\s]+/).filter(Boolean),
      pdfPages: { question: r['問題PDFページ'] ?? null, answer: r['解答PDFページ'] ?? null },
      url: str(r['出典URL']),
      savedAt: str(r['保存日']),
      displayOrderRaw: str(r['原文選択肢の表示順']),
      note: str(r['保存時の注記']),
      raw: raw[str(r['原問題番号'])] ?? null,
    };
  });
  return { records, sheets };
}

/** 補足講義 (CCDV-F) */
export function loadLessons(sheets) {
  const rows = sheets['補足講義'] ?? [];
  const lessons = [];
  let cur = null;
  for (let i = 3; i < rows.length; i++) {
    const [a, b] = rows[i] ?? [];
    if (a == null && b == null) { cur = null; continue; }
    if (!cur) {
      if (!/^L-/.test(str(a))) continue;
      cur = { id: str(a), titleJa: str(b), domainRaw: '', leadJa: '', points: [], figureIds: [], sheetRow: i + 1 };
      lessons.push(cur);
      continue;
    }
    const k = str(a).replace(/\n/g, '');
    if (k === '分野・配点') cur.domainRaw = str(b);
    else if (k === '導入') cur.leadJa = str(b);
    else if (k === '図表ID') cur.figureIds = str(b).split(/[,、\s]+/).filter(Boolean);
    else cur.points.push({ headingJa: str(a).replace(/\n/g, ''), textJa: str(b) });
  }
  return lessons;
}

/** 図表: 図表一覧 + 英語の対訳 */
export function loadFigures(root, exam) {
  const s = readXlsx(`${root}/diagrams/${exam}_Diagrams_JA.xlsx`);
  const list = table(s['図表一覧']);
  const terms = table(s['英語の対訳']);
  const figs = {};
  for (const f of list) {
    const id = str(f['図表ID']);
    figs[id] = {
      id, cardId: str(f['元カードID']), caption: str(f['図表の見出し']), position: f['元画面の位置'],
      file: str(f['画像ファイル']), terms: terms.filter((t) => str(t['該当する図表ID']) === id).map((t) => [str(t['英語の表記']), str(t['日本語訳'])]),
    };
  }
  return figs;
}

/** みのるん版の誤答解説を「A. 選択肢文\n説明」ブロックに分解。選択肢文が一致したものだけ採用 */
export function splitWrong(rec) {
  const out = {};
  const blocks = rec.wrong.split(/\n\s*\n(?=[A-E]\. )/);
  for (const b of blocks) {
    const m = b.match(/^([A-E])\. ([^\n]*)\n([\s\S]*)$/);
    if (!m) continue;
    const c = rec.choices.find((x) => x.label === m[1]);
    if (c && c.text.trim() === m[2].trim()) out[m[1]] = m[3].trim();
  }
  return out;
}
