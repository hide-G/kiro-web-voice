# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-19

Visual redesign and dedicated read-aloud action based on live feedback:
the previous look read as an Apple product, and Kiro's replies were not
reliably read out.

### Changed
- **Icon.** Replaced the iOS-style blue/indigo gradient rounded-square
  with a neutral dark-charcoal circle and a plain white microphone.
  No gradient, no highlight, no drop shadow. A muted green dot at the
  top-right indicates recording capability (dropped at 16 px). Aim: reads
  as a utility, not a system app.
- **FAB dimensions.** Reduced height from 52 px to 34 px, tightened
  padding, dropped the label from 15 px to 12 px. The pill still has the
  same shape language but no longer dominates the corner.
- **Sheet dimensions.** Width `420 → 340`, padding `16 → 12`, radius
  `22 → 16`, transcript min-height `84 → 60` and font `15 → 13.5`.

### Added
- **Second FAB "読む" (Read).** Sits next to "話す" in a shared dock.
  Clicking it (or `Alt+Shift+K`) speaks whatever is currently readable,
  and clicking again stops. Green pulse indicator while speaking, matched
  in style to the red pulse used for listening.
- **Cascading read-target resolution.**
  1. **Text selection.** If the user has selected any text on the page,
     that is what gets read. Selection inside the extension's own Shadow
     DOM is ignored.
  2. **Known semantic patterns.** `[role="log"] [role="article"]`,
     `[data-role="assistant"]`, `[data-message-role="assistant"]`,
     `[data-message-author-role="assistant"]` (ChatGPT-style),
     `main article`, `main [role="article"]`.
  3. **Class-name hints** — `[class*="assistant"]`, `[class*="response"]`,
     `[class*="message"]`, each with exclusions to avoid matching the
     composer / user messages / buttons.
  4. **Layout heuristic.** The biggest visible text block above the
     composer, closest to it, is treated as the newest reply. Wrapper
     containers whose descendants cover most of their own text are
     rejected to avoid reading the whole chat log at once.
- Read-aloud state is now reflected on the FAB itself (label becomes
  "停止", pulse animation active), not just on inline chips.

## [0.2.0] - 2026-07-19

Adds an opt-in **Privacy Mask** for demo and screen-sharing scenarios.

### Added
- **Privacy Mask.** A new toggle group in the popup that visually hides
  sensitive text on `app.kiro.dev` behind a soft blur. Hover reveals the
  masked content, so the UI remains usable.
  - **Emails.** Any string matching an email pattern is wrapped in a
    `<span data-kwv-mask="email">` and blurred inline. Uses a `TreeWalker`
    that skips scripts, styles, inputs, contenteditable, and the
    extension's own Shadow DOM.
  - **Recent (sidebar).** Text nodes whose whole content matches
    `Recent` / `Recents` / `Recently` / `最近` / `履歴` become anchors.
    The nearest following list container (`ul` / `ol` / `[role=list]`)
    is masked as a block via `[data-kwv-mask="section"]`.
  - Master toggle plus per-category sub-toggles. Sub-toggles are dimmed
    and inert while the master is off.
  - Dynamic content is handled by the existing `MutationObserver` via a
    debounced re-scan (300 ms), so newly loaded messages and sidebar
    items are picked up automatically.
- **Reduced-transparency and high-contrast fallbacks.** Instead of blur
  (which can be fatiguing at low vision), the mask renders as a diagonal
  hatch redaction with fully transparent text. Reveal-on-hover still
  works.

### Notes
- The mask is a **visual affordance, not a security feature.** The masked
  text is still present in the DOM and is visible to screen readers, view-
  source, extensions, and copy operations. This is intentional so the UI
  stays accessible, but it means the feature is unsuitable for hiding
  data from an adversary.

## [0.1.1] - 2026-07-19

Reliability fixes based on the first live-browser trial on `app.kiro.dev`.

### Fixed
- **Speech recognition cut off mid-sentence.** `SpeechRecognition.continuous`
  is now `true`, and the recognizer is transparently restarted when Chrome
  auto-ends the session (~60 s), so the transcript accumulates across
  natural pauses. Permanent errors (`not-allowed`, `service-not-allowed`,
  `audio-capture`, `language-not-supported`) still stop the session with a
  clear message.
- **"Insert into input" did nothing.** The composer detector now:
  - Tracks the most recently focused light-DOM input via `focusin`, so the
    element the user was typing into is the primary insertion target.
  - Recognises Lexical, Slate, and ProseMirror editors, plus common
    `data-testid` / `data-slot` hints.
  - Prefers the bottom-most visible textarea / contenteditable when nothing
    else matches (chat composers are conventionally at the bottom).
- **Insertion into rich-text editors is now robust.** Three strategies run
  in order: `beforeinput` event (Lexical / Slate / ProseMirror friendly),
  `document.execCommand("insertText")`, and a manual DOM insertion +
  `InputEvent`. Textareas and inputs bypass React's value tracker via the
  native setter and dispatch both `input` and `change`.
- **Clipboard fallback.** If every insertion strategy fails, the transcript
  is copied to the clipboard and a toast prompts the user to paste it
  manually.

### Added
- `docs/MANUAL_TEST.md` — reproducible manual test procedure with a
  reporting template.
- `scripts/diagnose.js` — DevTools console script that reports environment,
  extension injection state, composer detection, and message extraction
  results as structured JSON.

## [0.1.0] - 2026-07-19

Initial proof-of-concept release.

### Added
- Push-to-talk floating button on `app.kiro.dev` (Alt+K shortcut).
- Web Speech API–based transcription with confirm-before-insert UX.
- Read-aloud chip on the latest agent message.
- Three output modes: display-only, manual read, auto read.
- Popup settings page: language, interim, auto-submit, voice, rate, skip code blocks.
- Apple-inspired UI: translucent surfaces, spring-based enter/exit, reduced-motion / transparency / contrast support.
- Manifest V3, module service worker, minimum host permissions.
