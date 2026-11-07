import { EXAMS, type Question, type QuestionPack } from './types';

export interface ValidationResult {
  pack: QuestionPack | null;
  errors: string[];
  warnings: string[];
}

const QTYPES = ['single', 'multiple', 'matching', 'ordering'];
const ASSET_RE = /^assets\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i;

export function isSafeAssetPath(p: string): boolean {
  return ASSET_RE.test(p) && !p.includes('..');
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * パックの構造検証 + 意味検証。errors が1件でもあれば取り込めない。
 * needs_review の問題は「矛盾があること自体」が隔離理由なので、整合性の問題は警告に下げる。
 * assetPaths を渡すと画像の実在も確認する (JSON単体のときは undefined で、画像不足を警告にする)
 */
export function validatePack(input: unknown, assetPaths?: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (m: string) => errors.push(m);

  if (!isObj(input)) return { pack: null, errors: ['パックがJSONオブジェクトではありません'], warnings };
  const p = input;
  if (p.schemaVersion !== '1.0') fail('schemaVersion は "1.0" である必要があります');
  for (const k of ['packId', 'version', 'titleJa'] as const) if (!isStr(p[k])) fail(`${k} が必要です`);
  if (p.language !== 'ja') fail('language は "ja" である必要があります');
  if (!Array.isArray(p.questions)) {
    fail('questions が配列ではありません');
    return { pack: null, errors, warnings };
  }
  if (p.questions.length === 0) warnings.push('このパックには問題が0件です');

  const seen = new Set<string>();
  p.questions.forEach((raw, idx) => {
    const where = `questions[${idx}]`;
    if (!isObj(raw)) return fail(`${where} がオブジェクトではありません`);
    const q = raw as unknown as Question;
    const label = isStr(q.id) ? q.id : where;
    const structural = (m: string) => fail(`${label}: ${m}`);
    if (!isStr(q.id)) return structural('id が必要です');
    if (seen.has(q.id)) return structural('パック内で id が重複しています');
    seen.add(q.id);
    if (!Number.isInteger(q.revision) || q.revision < 1) structural('revision は1以上の整数です');
    if (!EXAMS.includes(q.exam)) structural(`exam が不正です: ${String(q.exam)}`);
    if (!QTYPES.includes(q.type)) return structural(`type が不正です: ${String(q.type)}`);
    if (typeof q.domainJa !== 'string') structural('domainJa が必要です');
    if (q.status !== 'ready' && q.status !== 'needs_review') structural('status が不正です');
    if (!['original_ja', 'translated_ja', 'pending'].includes(q.translationStatus)) structural('translationStatus が不正です');
    if (!isObj(q.ja) || !isStr(q.ja.stem) || !isStr(q.ja.explanation)) return structural('ja.stem と ja.explanation が必要です');
    if (!isObj(q.source) || !isStr(q.source.sourceId) || !isStr(q.source.originalId)) structural('source.sourceId と source.originalId が必要です');
    if (!isObj(q.correctAnswer)) return structural('correctAnswer が必要です');

    // 意味検証。needs_review では警告に下げる
    const soft = q.status === 'needs_review';
    const sem = (m: string) => (soft ? warnings.push(`${label}: ${m} (要確認のため隔離)`) : fail(`${label}: ${m}`));
    if (q.status === 'ready' && q.translationStatus === 'pending') sem('翻訳が未完了のため ready にできません');

    const uniqIds = (items: { id: string }[] | undefined, what: string) => {
      const ids = (items ?? []).map((i) => i?.id);
      if (ids.some((i) => !isStr(i))) sem(`${what} の id が不正です`);
      if (new Set(ids).size !== ids.length) sem(`${what} の id が重複しています`);
      return new Set(ids);
    };

    if (q.type === 'single' || q.type === 'multiple') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) return sem('選択肢は2つ以上必要です');
      const ids = uniqIds(q.choices, '選択肢');
      if (q.choices.some((c) => !isStr(c.textJa))) sem('選択肢の textJa が空です');
      const correct = q.correctAnswer.choiceIds;
      if (!Array.isArray(correct) || correct.length === 0) return sem('correctAnswer.choiceIds が必要です');
      if (new Set(correct).size !== correct.length) sem('正解IDが重複しています');
      for (const c of correct) if (!ids.has(c)) sem(`正解ID "${c}" が選択肢に存在しません`);
      if (!Number.isInteger(q.requiredSelections)) sem('requiredSelections が必要です');
      else if (q.requiredSelections !== correct.length) sem(`指定選択数(${q.requiredSelections})と正解数(${correct.length})が一致しません`);
      if (q.type === 'single' && correct.length !== 1) sem('single の正解は1つです');
      if (q.requiredSelections! > q.choices.length) sem('指定選択数が選択肢数を超えています');
    } else if (q.type === 'matching') {
      const m = q.matching;
      if (!isObj(m) || !Array.isArray(m.prompts) || !Array.isArray(m.candidates) || typeof m.allowReuse !== 'boolean') {
        return sem('matching.prompts / candidates / allowReuse が必要です');
      }
      const pIds = uniqIds(m.prompts, '小設問');
      const cIds = uniqIds(m.candidates, '候補');
      const map = q.correctAnswer.matches;
      if (!isObj(map)) return sem('correctAnswer.matches が必要です');
      for (const pid of pIds) if (!isStr(map[pid])) sem(`小設問 "${pid}" の正解がありません`);
      for (const k of Object.keys(map)) if (!pIds.has(k)) sem(`正解に未知の小設問 "${k}" があります`);
      for (const v of Object.values(map)) if (!cIds.has(v as string)) sem(`正解の候補 "${String(v)}" が存在しません`);
      if (!m.allowReuse && new Set(Object.values(map)).size !== Object.values(map).length) sem('候補の再利用不可なのに正解で同じ候補が重複しています');
    } else {
      if (!Array.isArray(q.items) || q.items.length < 2) return sem('items は2つ以上必要です');
      const ids = uniqIds(q.items, '項目');
      const order = q.correctAnswer.order;
      if (!Array.isArray(order)) return sem('correctAnswer.order が必要です');
      if (order.length !== ids.size || new Set(order).size !== order.length || order.some((o) => !ids.has(o))) {
        sem('正解の順序が項目の集合と一致しません');
      }
    }

    for (const a of q.assets ?? []) {
      if (!isObj(a) || !isStr(a.path) || !isSafeAssetPath(a.path)) {
        structural(`画像パスが不正です (assets/ 配下の PNG/JPEG/WebP のみ): ${String((a as { path?: unknown })?.path)}`);
        continue;
      }
      if (!isStr(a.altJa)) warnings.push(`${label}: 画像 ${a.path} の altJa がありません`);
      if (a.placement !== 'stem' && a.placement !== 'explanation') structural(`画像 ${a.path} の placement が不正です`);
      if (assetPaths && !assetPaths.has(a.path)) {
        warnings.push(`${label}: 画像 ${a.path} がパックに含まれていません (画像不足)`);
      } else if (!assetPaths) {
        warnings.push(`${label}: 画像 ${a.path} を含むには ZIP パックが必要です (JSON単体のため画像不足)`);
      }
    }
  });

  if (errors.length) return { pack: null, errors, warnings };
  return { pack: input as unknown as QuestionPack, errors, warnings };
}
