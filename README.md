# Claude資格 個人用問題集アプリ (claude-study-app)

CCDV-F / CCAO-F / CCAR-P / CCAR-F の日本語問題を解き、解説・誤答復習・履歴・メモを端末内に残す静的Webアプリです。サーバー・有料DB・外部AI APIは使いません。

- 状態: アプリ本体は実装・検証済み。元教材472問の変換・日本語化も完了し、ローカルの非公開パックを作成済み([docs/IMPORT_REPORT.md](docs/IMPORT_REPORT.md)、[docs/INPUT_AUDIT.md](docs/INPUT_AUDIT.md))。
- **公開リポジトリと公開サイトに入るのはアプリ本体とオリジナルのサンプル4問 (`public/sample-pack.ja.json`) だけです。** 元教材(`inputs_private/`)・翻訳(`translations/`)・変換後の問題パック(`dist-private/`)は `.gitignore` 済みで、公開ビルドにも入りません(`npm run verify:dist` が検査)。

## 起動と検証

```bash
npm ci
npm run dev          # 開発サーバー http://localhost:5173
npm run typecheck    # 型検査
npm test             # コアロジックのテスト (採点・検証・取り込み・復元・期限 ほか)
npm run build        # 型検査 + 本番ビルド → dist/
npm run verify:dist  # dist に原本・私的パック・秘密情報が無いか検査
npm run serve:subpath   # dist を /claude-study-app/ で配信 (別ターミナル)
npm run smoke:pwa        # 上記に対し Chrome/Edge でオフライン動作・外部通信なしを検査 (任意)
npm run inventory    # inputs_private/ の元教材を棚卸し → docs/INPUT_AUDIT.md
```

## 教材パックの作成 (手元だけで行う。出力は Git 管理外)

元教材を `inputs_private/archives/` (Question Archive の Excel 4冊) と `inputs_private/diagrams/` (Diagrams_JA の Excel 4冊と `images/`) に置く。

```bash
npm run inventory         # 受領ファイルと実件数を確認
npm run extract:sources   # 英語(Matthew版)の翻訳元を translations/src/ に抽出
# 翻訳を translations/ja/<資格>/NN.json に作成 (問題・全選択肢・正解の理由・誤答の解説・シナリオ)
npm run check:translations
npm run build:packs       # dist-private/ に資格別と全資格の問題パック(ZIP/JSON)と変換報告を出力
npm test                  # dist-private があれば、実パックをアプリ本体のコードで検証 (取り込み・採点・復元)
```

出力 (`dist-private/`): `CCDV-F|CCAO-F|CCAR-P|CCAR-F.pack.zip`、`ALL.pack.zip` (全資格・図表50枚込み)、`*.pack.json` (画像なし)、`conversion-report.json`、`IMPORT_REPORT.md` (隔離理由などの詳細)、`id-map.json` (問題ID・Excelの行・図表IDの対応表)。
アプリの「設定 → 問題パックの取り込み」で読み込む。資格別と全資格を両方読み込んでも、同じ内容は重複しない。
翻訳の進捗は `translations/checkpoint.json` に記録される。Excel の読み取りは、名前空間接頭辞付きの xlsx に対応する自前の最小リーダー (`scripts/lib/xlsx.mjs`、依存は fflate のみ)。

## 使い方

1. ホーム/設定の「動作確認用サンプルを読み込む」、または自分の問題パック(JSON/ZIP)を選び、プレビューを確認して「取り込む」。
2. 「学習」で資格・モード(練習/模擬)・出題対象・問題数などを選んで開始。
   - 練習: 確定後に直下へ正解と解説。再挑戦は新しい attempt として履歴に追加(過去は書き換えません)。
   - 模擬: 提出まで正解を出しません。期限は絶対時刻で管理し、閉じていても進みます。期限切れは1度だけ自動提出。未回答は不正解で、全出題数が分母です。
3. 「復習」: 誤答 / あやふや(正解でも対象) / ブックマーク / 期限到来。再出題は 1→3→7→14日の簡易規則です。
4. 「履歴」: 初回正答率と直近正答率を別表示。問題が改訂されても、当時の問題(revision)で振り返れます。

正答率は学習用の目安で、本番のスケールスコアには換算しません。科目・問題数・時間・合格基準は最新の公式ガイドで確認してください。

## 問題パックの形式

- スキーマ: [data/schema/question-pack.schema.json](data/schema/question-pack.schema.json)、補足は [docs/SCHEMA_NOTES.md](docs/SCHEMA_NOTES.md)。取り込み時に、それに加えて意味検証(正解IDの参照、指定選択数、matching/orderingの整合、readyに翻訳pendingなし 等)をします。
- `status: "needs_review"` の問題は通常の出題・採点に混ぜず、問題管理画面で隔離として表示します(正解不整合の問題はここへ)。
- JSON単体、または ZIP (`pack.json` と `assets/*.png|jpg|webp` のみ)。ZIPは `..`・絶対パス・SVG・重複・偽装画像・過大サイズを拒否し、全検証後に1トランザクションで保存します。失敗や衝突(同じ revision で内容が違う)では既存データを変更しません。
- 同じ id・revision・内容の再取り込みは重複しません。内容を変えるときは `revision` を上げてください。

## 保存とバックアップ・端末移行

問題・画像・メモ・回答はこの端末のブラウザの IndexedDB にだけ保存されます。自動同期はありません。

- 設定画面の「完全バックアップ」(履歴・メモ込み)または「教材のみ」でZIPを書き出し。
- 別端末では同じ設定画面から「追加・統合」で復元すると、同じ answerId/sessionId は重複せず、同じIDで内容が違うものは既存を残して警告します。「置き換え」は現在のデータを消します。
- バックアップは問題の本文ハッシュと画像のチェックサムを検証し、破損・改変していれば拒否します。
- ブラウザのデータ削除、容量整理、公開URLの変更で保存領域が変わる/消えることがあります。定期的にバックアップしてください。iPhoneのSafariとホーム画面アプリは保存領域が別の場合があります。

## GitHub Pages で公開する

GitHub Free の GitHub Pages は**公開リポジトリ**が前提で、サイト利用者の認証はありません。公開するのはアプリ本体とオリジナルサンプルだけで、実教材・履歴は各端末の中にしか置かれません。クライアント側のパスワードやURL非公開をアクセス制御として扱わないでください。

1. 公開用の独立リポジトリ(例: `claude-study-app`)を作り、このフォルダの内容を `main` に push。`inputs_private/` `dist-private/` `translations/` は `.gitignore` 済みですが、追跡前に `git ls-files` で確認してください。
2. GitHub の Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。
3. `main` への push で [.github/workflows/pages.yml](.github/workflows/pages.yml) が 型検査 → テスト → ビルド → 公開物検査 → 公開 を実行します (権限は `contents: read / pages: write / id-token: write` のみ)。
4. 公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/`。Viteの `base: './'`、hashルーティング、相対アセットなので、サブパスでも直接URL・再読み込みが動きます。

PWA: 初回読み込み後は静的アプリがキャッシュされ、取り込み済みの問題でオフライン学習できます。新版があると画面上部に通知が出て、利用者の操作で適用します(履歴は消えません)。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/core/` | 型・検証・採点・出題・復習規則・IndexedDB・ZIP・バックアップ (UIなしでテスト可能) |
| `src/ui/` | 画面 (React) |
| `public/` | マニフェスト・Service Worker・サンプルパック |
| `tests/` | コアのテスト |
| `docs/` | 引き継ぎ仕様 (`docs/spec/`)、棚卸し、スクリーンショット |
| `inputs_private/` | 利用者が元教材を置く場所 (Git管理外) |

## 未実装・今後の作業

- 日本語化は完了したが、**翻訳の人手によるレビューと、解答の技術的検証は未実施**(別の作業)。英語236問の日本語訳は、全件を1人(AIエージェント)が訳したもの。翻訳した本人による自己点検(否定・限定・数値・正解の対応・記号の照合)は行い、誤り2件を直したが、第二の目での点検は受けていない。点検の範囲は [docs/IMPORT_REPORT.md](docs/IMPORT_REPORT.md) を参照。
- Matthew版CCDV-F 5.9は、原本の解答欄(A,D)が原本自身の他の記述と矛盾していたため、根拠つきで正解を C に訂正し(revision 2)、隔離を解除した。出典側への確認はしていない。`translations/answer-overrides.json` に根拠を記録している。
- 受験時点の公式Exam Guideとの照合、iPhone実機での確認、Service Worker の更新通知の実機確認は未実施。
