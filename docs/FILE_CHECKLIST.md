# 渡すべき元ファイル

このセットと元ファイルを両方渡してください。以下は既存の保存物を確認した添付対象一覧です。元の問題本文・教材はこのZIPに同梱していません。ファイル名だけでは別のコーディングエージェントは読めないため、利用者がダウンロードしてinputs_private/へ置くか添付してください。

| 必須 | ファイル名 | 内容・状態 |
|---|---|---|
| 必須 | CCDV-F_Question_Archive.xlsx | 106問。Matthew英語53問＋みのるん日本語53問。英語分は未翻訳 |
| 必須 | CCAO-F_Question_Archive.xlsx | 120問。Matthew英語60問＋みのるん日本語60問。英語分は未翻訳 |
| 必須 | CCAR-P_Question_Archive.xlsx | 126問。Matthew英語63問＋みのるん日本語63問。英語分は未翻訳 |
| 必須 | CCAR-F_Question_Archive.xlsx | 120問。Matthew英語60問＋みのるん日本語60問。英語分は未翻訳 |
| 推奨 | Claude_4_Exams_Diagrams_JA.zip | 原図PNG50枚＋資格別図表Excel4冊。旧Question Archiveの再描画より優先 |
| 代替 | 各資格_Diagrams_JA.xlsx（4冊） | 原図ZIPがない場合。埋め込み画像と図表一覧から抽出 |
| 任意 | 各資格_Matthew_Purcell_Practice_Exam_EN.pdf（4冊） | 翻訳照合・ページ確認用。Excelと重複して問題数へ加えない |
| 任意 | Claude認定資格の受験ガイド・公式Exam Guide | 出題範囲・用語の照合。追加の問題集として数えない |

既存のClaude_All_4_Question_Archives.zipを使う場合は、上の4冊のExcelを展開して渡せばよく、同じExcelを二重取り込みしないでください。

## 優先度
元問題Excel4冊 → 原図ZIP → 原本PDF → ガイドの順。元問題不足でもサンプルでアプリの実装・公開準備は進められます。

## 今回の完了範囲
引き継ぎ指示・データ仕様・教材棚卸し・動作確認用サンプルは用意済み。472問の日本語パック変換、236問の全文翻訳、アプリ実装、公開デプロイは次のエージェントで行う工程です。