# Manual Test Guide

このドキュメントは、Kiro Web Voice の PoC が実ブラウザ上で期待通りに動くかを、再現可能な形で確認するための手順です。DOM 変更で壊れた際の一次切り分けにも使えます。

---

## Step 0 · 事前準備

- Chrome 116 以降 または Chromium ベースの Edge
- app.kiro.dev のアカウント（サインイン済み）
- マイク（内蔵 / 外付けどちらでも）
- macOS の場合: **システム設定 → プライバシーとセキュリティ → マイク** で Chrome を許可

**ソースを取得**

```bash
git clone https://github.com/hide-G/kiro-web-voice.git
```

または [ZIP ダウンロード](https://github.com/hide-G/kiro-web-voice/archive/refs/heads/main.zip)。

---

## Step 1 · Chrome に拡張を読み込む

1. `chrome://extensions/` を開く
2. 右上の **デベロッパーモード** をオン
3. **パッケージ化されていない拡張機能を読み込む** をクリック
4. `kiro-web-voice/`（`manifest.json` があるフォルダ）を選択

**成功時のカード表示:**

- 名前: `Kiro Web Voice (PoC)`
- バージョン: `0.1.1` 以上
- エラー欄が空

**キーボードショートカット確認:** `chrome://extensions/shortcuts` で `Alt+K` / `Alt+Shift+K` が割り当てられていることを確認。競合する場合はここで変更してください。

---

## Step 2 · FAB の表示確認

1. https://app.kiro.dev/agent を開く
2. 右下に半透明の **「話す」** ボタンが出るはず
3. ホバーで影が強まり、押下で 3% 縮むこと

出ない場合は Step 4 の診断スクリプトを先に走らせてください。

---

## Step 3 · マイク許可

1. FAB を押す（または `Alt+K`）
2. アドレスバー付近に「マイクを使用しますか?」のダイアログ
3. **許可** を選択

一度許可すれば以降は自動です。誤って拒否した場合は `chrome://settings/content/microphone` から `https://app.kiro.dev` をブロックリストから除外してください。

---

## Step 4 · DevTools 診断スクリプト

Kiro Web の実 DOM を検査して、拡張のセレクタが機能しているかを自動判定します。

### 手順

1. Kiro Web を開いた状態で **F12** で DevTools を開き **Console** タブへ
2. [`scripts/diagnose.js`](../scripts/diagnose.js) の内容を丸ごとコピー
3. コンソールに貼り付けて Enter
4. 表示された JSON を全コピーし、フィードバック時に添付

### 判定内容

- **環境**: SpeechRecognition / SpeechSynthesis の利用可否
- **拡張のインジェクション**: Shadow DOM の存在確認
- **入力欄検出**: 6 種類のセレクタごとの命中数と主要属性（`aria-label`, `placeholder`, `data-testid`, `contenteditable` など）
- **メッセージ検出**: 3 種類のセレクタごとの命中数と直近テキスト先頭 140 字
- **総合サマリー**: どのセレクタで検出できたか

---

## Step 5 · エンドツーエンド動作テスト

診断が済んだら、以下の順で実際の動きを確認します。

### 音声入力フロー

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 先に Kiro の入力欄をクリックして focus | フォーカス履歴に記録される（内部処理） |
| 2 | FAB クリックまたは `Alt+K` | ラベルが「話す」→「停止」に変わる |
| 3 | 「TypeScript のジェネリクスについて教えて」など長めに発話 | 途中で無音があっても止まらず、シートに文字が追加され続ける |
| 4 | 再度 FAB クリックで停止 | 「聞き取り中…」→「確認して挿入してください」に変わる |
| 5 | シート内でテキストを編集 | 直接編集可能 |
| 6 | **入力欄へ挿入** を押す | Kiro の入力欄にテキストが反映される |
| 7 | 通常どおり送信 | Kiro が回答を返す |

### 読み上げフロー

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 8 | 回答直下の **読み上げ** チップを押す | 音声で読み上げが始まる |
| 9 | もう一度チップを押す | 停止 |
| 10 | `Alt+Shift+K` | 最新回答が読み上げられる |
| 11 | ポップアップで出力モードを「表示のみ」 | 読み上げチップが非表示になる |

### フォールバック確認

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 12 | Kiro の DOM が想定と違う場合（`findComposer()` が失敗する場合） | クリップボードにコピー + トーストが表示される |

---

## 報告テンプレート

```markdown
## 環境
- OS:              (例: macOS 14.5 / Windows 11)
- ブラウザ:        (例: Chrome 128)
- 拡張バージョン:  (例: 0.1.1)

## Step 1〜3
- 拡張ロード:      成功 / 失敗（エラー: ___ ）
- FAB 表示:        あり / なし
- マイク許可:      完了 / 拒否 / ダイアログ出ず

## Step 4 診断 JSON
(貼り付け)

## Step 5 動作チェック
- 音声認識が最後まで続く:      ○ / ×
- 入力欄への挿入が成功する:    ○ / ×
- クリップボードフォールバック: ○ / ×（発動しなかった場合は空白）
- 読み上げチップ表示:          ○ / ×
- 読み上げ実行:                ○ / ×

## 気づいたこと / スクリーンショット
(自由記述)
```

---

## トラブルシューティング早見表

| 症状 | 一次対処 |
| --- | --- |
| FAB が出ない | 診断スクリプトの `extension.kwvInstalled` を確認 |
| コンソールに `[kwv]` エラー | ログをそのままフィードバックへ |
| マイクダイアログが出ない | `chrome://settings/content/microphone` を確認 |
| `Alt+K` が効かない | `chrome://extensions/shortcuts` で確認・変更 |
| 認識がすぐ止まる | v0.1.0 以下の可能性。0.1.1 以降で `continuous=true` + 自動再開 |
| 入力欄に反映されない | 診断スクリプトの `composer` セクションを共有 |
| クリップボードにコピーされたが貼り付け不要 | それが v0.1.1 のフォールバック動作。想定内 |
| Firefox で動かない | 想定内（Firefox は `SpeechRecognition` 未対応） |

---

## 参考

- [Web Speech API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [SpeechRecognition (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [Manifest V3 offscreen documents (Chrome)](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
