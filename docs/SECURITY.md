# Security & Privacy

## 権限モデル

`manifest.json` で要求している権限は以下のとおりです。

| 権限 | 用途 | 妥当性 |
| --- | --- | --- |
| `storage` | 設定を `chrome.storage.sync` に保存 | 必須 |
| `tabs` | 拡張のキーボードショートカットを Kiro Web タブへ送るために `tabs.query` を使用 | 必要最小 |
| `host_permissions: https://app.kiro.dev/*` | 対象は Kiro Web のみ | 必須 |
| `commands` | `Alt+K` / `Alt+Shift+K` | 必須 |

**要求しない権限**：`<all_urls>`, `activeTab`, `clipboardRead`, `clipboardWrite`, `webRequest`, `cookies`, `identity`, `tabCapture`, `desktopCapture`, `nativeMessaging`。

## データの取扱い

- **音声**：ブラウザの `SpeechRecognition` API へ直接渡します。拡張機能側でバッファリングも保存もしません。
- **文字起こし**：DOM のテキストエリア／シート内にのみ存在します。挿入時に Kiro の入力欄へ書き込まれた後、拡張機能は保持しません。
- **Kiro の回答**：読み上げ用に一時的に `SpeechSynthesisUtterance` に渡すだけで、保存も外部送信もしません。
- **ネットワーク**：拡張機能自身は外部ホストへ通信しません。`fetch` は使用していません。

## ブラウザ側の音声処理について

Chrome の `SpeechRecognition` はブラウザベンダー側の音声認識サービスを利用する場合があります（[MDN の記載](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)）。この経路については拡張機能側で制御できません。次のいずれかを検討してください。

- 端末外送信を許容できる用途で使用する
- 将来的にオンデバイス認識（`processLocally: true` + 言語パック）へ切り替える
- クラウド STT を別 Provider として実装し、経路を明示する

## 攻撃面

| 攻撃 | 影響 | 緩和 |
| --- | --- | --- |
| 誤認識による誤送信 | Kiro が誤ったタスクを実行 | 自動送信は既定オフ。確認シートで編集後に手動挿入。 |
| 会議音声などのインジェクション | 意図しない指示が Kiro に渡る | 半二重方式、確認シート、ESC で即キャンセル。 |
| Autonomous モードでの重大操作 | 破壊的変更 | 送信操作を必ずユーザーに委ねる。 |
| 拡張のマルウェア化 | Kiro プロンプト・回答の窃取 | 依存ライブラリを追加しない、`fetch` を使わない、Chrome Web Store 審査で単一目的を明示。 |
| DOM 変更に伴う誤挙動 | 想定外の要素に書き込む | Composer adapter は複数条件をフォールバックで検証し、失敗時はクリップボードにコピーして通知。 |

## 情報漏洩の管理

- 音声・文字起こし・応答テキストを永続化しません。
- `chrome.storage.sync` に保存されるのは設定のみです（言語、モード、速度など）。
- 拡張の DevTools ログ (`console.debug`) は診断用途に限定しており、認識テキストは出力しません。

## ユーザー同意

- **マイク許可**：Chrome の標準ダイアログでユーザーが明示的に許可します。拡張はこれを迂回しません。
- **自動送信**：既定オフ。ユーザーが明示的にオンにする必要があります。
- **自動読み上げ**：既定オフ。ユーザーが明示的に選択する必要があります。
