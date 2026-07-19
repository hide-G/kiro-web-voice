# Design Notes

UI の意思決定を、参考にした [Apple Design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md) の各条項と紐づけて記録します。

## 1. 応答性 (Response)

- FAB は `pointerdown` で `data-pressed="true"` を付与し、即座に `transform: scale(0.97)` を適用。CSS transition は `100ms cubic-bezier(0.2, 0.8, 0.2, 1)`。
- `:active` セレクタでもフォールバックし、キーボード起動時も反応する。
- 音声認識の可視フィードバックは `onstart` で即座にシートを開き、赤いパルスドットで進行を示す。

## 2. 直接操作 (Direct manipulation)

- FAB は移動しないが、シート内のテキストエリアはユーザーが直接編集できる。認識中の間違いを 1 タップで直せる。
- 読み上げチップは押下と同時にトグル。押下中は `scale(0.97)`。

## 3. 中断可能性 (Interruptibility)

- スプリング (`animateSpring`) は開始前に前のフレームをキャンセルし、常に現在値から新しい目標へ向けて再計算する。
- ESC キーは録音・シート・読み上げすべてを即停止する。
- 読み上げ中に別チップを押すと `speechSynthesis.cancel()` で即断。

## 4. スプリング (Behavior over animation)

- 既定は `damping: 1.0, response: 0.32`（Apple の「Move / reposition」プリセット相当）。オーバーシュートなし。
- シート／トーストの登場は `blur` + `scale` + `opacity` を同時に変化させ、「素材が現れる」感覚を強める（Materials 参考）。
- リリース時のみ `damping ≈ 0.8` を検討可能な API 構造にしているが、PoC では未使用。

## 5. 空間の一貫性 (Spatial consistency)

- シートは FAB のすぐ上（右下）に出現する。`transform-origin: bottom right;` で FAB を起点にスケール。
- 消える方向も同じ経路。往路と復路のイージングを対称にしている。

## 7. 素材 (Materials & depth)

- FAB／シート／トースト／読み上げチップは `backdrop-filter: blur() saturate()` の半透明素材。
- サイズが大きい面（シート）は blur が強く shadow が深い。小さい面（読み上げチップ）は blur を軽くする。
- **半透明の重ね掛けを避けるため**、シート内部のテキストエリアは `--kwv-bg-solid`（不透明）に切り替える。可読性優先。

## 9. ラバーバンド

- 現バージョンでは境界の跳ね返りが必要な要素がない（ドラッグ操作なし）。将来 FAB のドラッグ対応をする際に導入予定。

## 11. フレームレベルの滑らかさ

- 動かすのは `transform` と `opacity` と `filter: blur()` に限定。レイアウトを再計算しない。
- `will-change: transform, opacity, filter;` を該当要素に付与。

## 12. Materials（詳細）

- 明色テーマではガラス層は 62% 白 + `blur(24px) saturate(180%)`。
- 暗色テーマでは 62% グレー + 同じぼかしで、下地の色を透かす。
- **文字にヴィブランシー**：ラベルは `letter-spacing: 0.02em` の微正トラッキングと 500〜600 の中太で可読性を確保。
- **境界は 1px でなく blur グラデーション**：シートの上端は `border-top: 1px solid rgba(255,255,255,0.4)` で光の縁を出す。

## 14. Reduced motion / transparency / contrast

- `prefers-reduced-motion: reduce`：スプリングを opacity フェードに置換、`scale(0.97)` を無効化、赤いパルスを停止。
- `prefers-reduced-transparency: reduce`：全ての半透明面を不透明化、`backdrop-filter` を撤去。
- `prefers-contrast: more`：ボーダーを `currentColor` に強調、背景を不透明化。

## 15. タイポグラフィ

- ボディは `system-ui` の 15px、`line-height: 1.5`、`letter-spacing: 0`。
- Popup のタイトルは 15px 表示サイズで `letter-spacing: -0.01em`（軽い負のトラッキング）。
- カード見出しの UPPERCASE ラベルは 12px + `letter-spacing: 0.04em`（小さい文字は正のトラッキング）。
- ボタン内の数字は `font-variant-numeric: tabular-nums;` で幅を安定。

## 16. 基礎原則との対応

| 原則 | 反映 |
| --- | --- |
| Purpose | 音声入力とオプションの読み上げに機能を絞り、それ以外を作らない。 |
| Agency | 送信は必ずユーザーの手動操作。ESC で即キャンセル。 |
| Responsibility | 権限最小化、音声・応答を保存しない、DOM 変更時はクリップボードにフォールバック。 |
| Familiarity | iOS 風のセグメント／トグル／ピル型ボタンで、初見でも操作を予測できる。 |
| Flexibility | 3 種の出力モードで用途別に切替。ショートカット `Alt+K` / `Alt+Shift+K` を提供。 |
| Simplicity | ポップアップ 1 画面に完結。上級設定は将来別画面に隔離。 |
| Craft | すべてのマージン・角丸・イージングを Apple の値を参考に統一。系統的なスペーシング。 |
| Delight | 素材の登場、色のグラデーション、赤の呼吸ドットで「反応してくれる」感触を作る。 |
