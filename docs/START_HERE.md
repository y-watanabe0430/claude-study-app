# Claude資格・個人用問題集アプリ 引き継ぎセット

目的：4資格の日本語問題を解き、回答履歴・解説・間違いを振り返る、無料運用のWebアプリをコーディングエージェントに作ってもらう。

## 渡し方
1. このフォルダ全体を作業用の新規リポジトリへ渡す。既存のknowledge-publishing内なら apps/claude-study/ などを使い、既存教材の公開設定を変更しない。
2. `FILE_CHECKLIST.md`の元教材を利用者自身が用意し、Git管理外の `inputs_private/` に置くか、エージェントへ直接添付する。
3. `AGENT_PROMPT.md`の全文を最初の指示に貼る。
4. 全問の日本語化・点検が終わった非公開の問題パックを、完成したアプリの「問題を取り込む」から読み込む。
5. GitHub Pagesの公開設定・デプロイを利用者が許可した後、エージェントが公開し、実URLを確認する。

このセットは実装指示とデータ仕様です。完成アプリでも、472問の翻訳済み問題集でもありません。第三者教材の全文は同梱していません。元ファイルは別途添付が必要です。`data/sample-pack.ja.json`は今回作成したオリジナルの動作確認用4問で、既存問題の代わりにはなりません。

## 構成
- AGENT_PROMPT.md：最初に渡す実装指示
- FILE_CHECKLIST.md：元教材の添付順・既存ファイルの状態
- SOURCE_CATALOG.md / data/source-catalog.json：教材候補と期待件数
- spec/DATA_AND_IMPORT.md：旧Excelからの変換・翻訳・問題パック仕様
- spec/APP_REQUIREMENTS.md：回答・復習・保存・移行の要件
- spec/ACCEPTANCE.md：完了判定と確認項目
- data/question-pack.schema.json：JSON Schema
- data/sample-pack.ja.json：日本語の形式別サンプル4問
- inputs_private/README.md：元教材の置き場の説明
- .gitignore：元教材・変換後の私的データの公開防止

## 無料運用の前提
GitHub FreeのGitHub Pagesは公開リポジトリが前提。サイトの利用者認証は提供しない構成。アプリ本体とサンプルのみ公開し、実教材・個人メモ・履歴は端末内IndexedDBに保存する。クライアント内のパスワードやURL非公開はアクセス制御として扱わない。
PC・iPhoneから同じアプリを開けるが、問題・履歴の自動同期はない。各端末へ最初にパックを取り込み、履歴移行はバックアップ書き出し・読み込みで行う。Safariとホーム画面アプリでも同一保存領域と決めつけない。ブラウザ削除や容量整理に備えてバックアップする。
サーバー・有料DB・外部AI API・独自ドメインは必須にしない。公開デプロイ用の独立repo案：claude-study-app。教材販売用のknowledge-publishingを安易に公開しない。

## 公式根拠（2026-11-07確認）
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

科目や本番問題数・時間・合格基準は最新公式ガイドで確認し、模試の正答率を本番スケールスコアへ換算しない。
