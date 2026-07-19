# Architecture

このドキュメントは、Kiro Web Voice の内部構成と設計判断の背景をまとめます。実装を読むときの地図として使ってください。

## 全体像

```text
                    ┌───────────────────────────────┐
                    │ chrome.storage.sync (settings)│
                    └───────────────┬───────────────┘
                                    │
                        GET / SET   │   commands
                                    │
   ┌──────────────────┐  messages   │   ┌────────────────────────────┐
   │  Popup (module)  │◀────────────┼──▶│    Service Worker (SW)     │
   │  settings UI     │             │   │  MV3 background, module ESM │
   └──────────────────┘             │   └────────────────────────────┘
                                    ▼                     ▲
                        ┌────────────────────────┐        │
                        │  Content Script (IIFE) │────────┘
                        │  app.kiro.dev only     │
                        │                        │
                        │  • Shadow DOM UI       │
                        │  • Composer adapter    │
                        │  • Message extractor   │
                        │  • Web Speech API      │
                        │  • Speech Synthesis    │
                        │  • Tiny spring engine  │
                        └────────────────────────┘
```

- **Service Worker** は設定の GET/SET とキーボードショートカットの中継のみを担い、状態を保持しません。
- **Content Script** は単一ファイルの IIFE です。MV3 の content script は ESM の top-level import に対応しないため、ここではモジュール分割せず 1 ファイルに閉じています。共有定数は `src/shared/constants.js` と重複していますが、意図的な重複です。
- **Popup** は ESM を使い、`src/shared/constants.js` と `storage.js` を直接 import します。

## Content Script の内部構造

すべて `src/content/content.js` に含まれます。責務ごとにセクションで区切っています。

| セクション | 役割 |
| --- | --- |
| Constants | `OUTPUT_MODES` / `DEFAULT_SETTINGS` / `MSG` を再宣言。 |
| Settings I/O | 起動時に SW から設定を取得。`chrome.storage.onChanged` で更新を反映。 |
| Composer adapter | Kiro の入力欄を検出 (`contenteditable[role=textbox]` → 最後の `<textarea>` → `aria-label`／`placeholder` の意味的マッチ) して文字挿入。React 互換のため `HTMLTextAreaElement.prototype.value` の native setter + `input` イベントを発火。 |
| Message extractor | `[role="log"] [role="article"]` を優先、次点で `data-role="assistant"`、最後に `<main>` 直下の `<article>`。読み上げ時にコードブロック等を除去。 |
| Speech recognition | `webkitSpeechRecognition` / `SpeechRecognition` をラップ。エラーは日本語で通知。 |
| Speech synthesis | 選択された voice / rate / lang で読み上げ。半二重（読み上げ中は録音停止）。 |
| UI (Shadow DOM) | ホスト DOM とスタイルが混ざらないよう Shadow Root に閉じる。CSS は `web_accessible_resources` 経由でリンク。 |
| Spring engine | Apple Design を参考にした最小スプリング。`damping 1.0 / response 0.32` を既定。`prefers-reduced-motion` を尊重し、opacity フェードにフォールバック。 |
| Read chips | `MutationObserver` で新しい agent メッセージを検出し、直近だけにチップを表示。auto-read は 800ms デバウンス。 |

## 設計判断の理由

### なぜ Shadow DOM か

Kiro Web のスタイルと拡張の UI が干渉すると、両方のバグが再現困難になります。`attachShadow({ mode: "open" })` で完全に隔離し、CSS 変数と `.kwv-` 名前空間で内部を安定させています。

### なぜ Web Speech API か（第三者クラウドではなく）

- **開発コスト**：バックエンド不要で PoC が即動く。
- **プライバシー境界**：拡張自身は音声を送らない。ブラウザ実装が外部認識サービスを使う可能性は明記した上で許容。
- **将来の差し替え**：`ensureRecognition()` の内側を Provider インタフェースに置き換えるだけで、Amazon Transcribe やオンデバイスモデルへ切り替え可能な構造にしてある。

### なぜ自動送信を既定オフか

Kiro は Autonomous モードでコード変更・PR 作成まで到達します。誤認識で `"delete this file"` が実行される事故を避けるため、確認 → 挿入 → 手動送信 を既定にしました。

### なぜ Content Script でスピーチ処理をするのか

`SpeechRecognition` はセキュア文脈のドキュメントを要求します。Kiro Web は HTTPS 上で動くので、content script がそのまま `new webkitSpeechRecognition()` を呼べます。SW には DOM がないため、SW でこの API は動きません。将来 `getUserMedia` ベースの録音に切り替える場合は、Offscreen Documents API を利用します。

### なぜスプリングを自作したか

- CSS transition はジェスチャで中断できない。
- Framer Motion などの依存を持ち込むと、`manifest v3` の remote-code 禁止と衝突するリスクや、審査時の追加確認を招く。
- 40 行程度で必要十分なので、`content.js` 内に薄い実装を置くのが最も安全。

## 拡張ポイント

### STT Provider

```js
// content.js 内 ensureRecognition() を以下のインタフェースに沿って差し替え可能。
// Provider は以下のイベントを emit すればよい:
//   onstart, onresult({ interim, final, isFinal }), onerror, onend
```

### TTS Provider

```js
// speak(text, chipEl) の中身を差し替え。
// window.speechSynthesis の代わりに fetch → Blob → HTMLAudioElement の実装に置換可能。
```

### Composer Adapter

`findComposer()` を Kiro 側の安定した属性（例: `data-testid="composer-input"` など）に切り替えると、DOM の脆さを回避できます。Kiro 側にそのような属性を公式に追加してもらえるかは、リポジトリの [Issue #3919](https://github.com/kirodotdev/Kiro/issues/3919) にコメントする際の重要な要望項目です。

## テスト戦略（未実装）

- **手動チェックリスト**：`docs/MANUAL_TEST.md`（未作成）に、ブラウザ／モード／言語の組み合わせを列挙する。
- **E2E**：Playwright で `app.kiro.dev` にログインしたセッションを再現。ただし Kiro の認証仕様上、CI 実行は難しい。
- **単体**：composer adapter / message extractor / sanitiseText / spring を Vitest でユニット化。DOM は JSDOM で足りる。
