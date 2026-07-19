# Roadmap

このドキュメントは、本 PoC がどこまでを目標とし、どこからをスコープ外にするかを明確にします。

## Phase 0 — 現状（PoC）

- Chromium 系ブラウザで動作
- 単一 host (`app.kiro.dev`) 限定
- Web Speech API / Speech Synthesis
- Shadow DOM UI、Apple 風意匠

## Phase 1 — 実務検証

- 対象 3〜5 名の実業務で 2 週間試用
- 日本語・英語混在の技術用語における認識精度計測
- 誤動作（誤挿入、誤送信、誤読み上げ）ゼロを維持
- KiroDOM 変化に伴う破損頻度を計測

## Phase 2 — 堅牢化

- 自動読み上げの完了検知を改善
  - `MutationObserver` の debounce を可変化
  - Kiro 側 UI の `aria-busy` や停止ボタンを利用
- 言語自動切替
- ユーザ辞書（技術用語置換）
- Playwright による軽量 E2E スイート

## Phase 3 — プロバイダ差し替え

- STT Provider に Amazon Transcribe 実装を追加
  - 短期トークン発行用の軽量バックエンドを別リポジトリで整備
  - リージョン、データ保管期間の設定を明示
- TTS Provider にクラウド TTS 実装を追加

## Phase 4 — 配布

- Chrome Web Store 審査対応
- プライバシーポリシー、単一目的の明文化
- 監査ログ、バージョニング、テレメトリのオプトイン設計

## スコープ外

- Firefox / Safari 対応（Web Speech API の可用性を再評価してから判断）
- モバイルブラウザ対応
- Kiro Web 以外への汎用化（Cursor 等）
- Autonomous モードの一括音声操作
- Kiro が公式に音声対応した時点で、本 PoC は撤退する
