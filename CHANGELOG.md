# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
