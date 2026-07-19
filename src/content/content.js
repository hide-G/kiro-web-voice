/*
 * Kiro Web Voice — content script (PoC).
 *
 * What this does:
 *   - Injects a floating push-to-talk button on app.kiro.dev.
 *   - Uses Web Speech API (webkitSpeechRecognition) directly in the tab context.
 *   - Shows a confirmation sheet with the transcript; user commits by pressing
 *     "Insert" (never auto-send). "Insert & Send" is a separate, opt-in action.
 *   - Adds a "Read aloud" chip to agent messages (manual by default).
 *
 * Design notes:
 *   - All UI lives inside a Shadow DOM so Kiro's CSS cannot bleed in.
 *   - Interruptibility: pressing the FAB again immediately stops recognition;
 *     ESC always cancels the sheet.
 *   - Composer adapter uses semantic hints (textarea, contenteditable,
 *     placeholder/aria-label containing "Kiro"/"Ask"), not fragile class names.
 *   - We never store audio, never persist transcripts, and we do not send data
 *     to any third-party endpoint. Recognition backend is the browser's own.
 */

(() => {
  "use strict";

  if (window.__kwvInstalled) return;
  window.__kwvInstalled = true;

  // ------------------------------------------------------------------
  // Constants (kept in sync with src/shared/constants.js).
  // Duplicated intentionally because MV3 content scripts cannot ESM-import.
  // ------------------------------------------------------------------
  const OUTPUT_MODES = {
    DISPLAY_ONLY: "display_only",
    MANUAL_READ: "manual_read",
    AUTO_READ: "auto_read",
  };
  const DEFAULT_SETTINGS = {
    lang: "ja-JP",
    outputMode: OUTPUT_MODES.MANUAL_READ,
    autoSubmit: false,
    interim: true,
    ttsRate: 1.0,
    ttsPitch: 1.0,
    ttsVoiceURI: null,
    skipCodeBlocks: true,
    respectReducedMotion: true,
  };
  const MSG = {
    GET_SETTINGS: "kwv:get-settings",
    COMMAND_TOGGLE: "kwv:cmd:toggle",
    COMMAND_READ: "kwv:cmd:read",
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    recognition: null,
    listening: false,
    // recognizingSession is the *user's* intent to keep listening.
    // It stays true across the browser's automatic onend events so we can
    // transparently restart the recognizer (Chrome ends the session after
    // ~60s regardless of `continuous`).
    recognizingSession: false,
    finalTranscript: "",
    interimTranscript: "",
    // Most-recently-focused input-like element in the light DOM.
    // Used as the primary target for insertion because our own UI steals
    // focus by the time the user clicks "Insert".
    lastFocusedInput: null,
    lastReadMessageId: null,
    speakingChip: null,
  };

  // ------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "style") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== undefined && v !== null) {
        node.setAttribute(k, v);
      }
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function log(...args) {
    // eslint-disable-next-line no-console
    console.debug("[kwv]", ...args);
  }

  // ------------------------------------------------------------------
  // Settings — pull from service worker on load and on change
  // ------------------------------------------------------------------

  async function loadSettings() {
    try {
      const s = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
      if (s && typeof s === "object") state.settings = { ...DEFAULT_SETTINGS, ...s };
    } catch (err) {
      log("settings load failed, using defaults", err);
    }
  }

  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const entry = changes["kwv.settings.v1"];
    if (entry?.newValue) {
      state.settings = { ...DEFAULT_SETTINGS, ...entry.newValue };
      log("settings updated", state.settings);
    }
  });

  // ------------------------------------------------------------------
  // Composer adapter — locate Kiro's message input in a resilient way.
  // We deliberately avoid depending on class names.
  // ------------------------------------------------------------------

  // Predicates -------------------------------------------------------

  function isInputLike(node) {
    if (!node || node.nodeType !== 1 || !node.tagName) return false;
    const tag = node.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = (node.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email", ""].includes(type);
    }
    return node.isContentEditable === true;
  }

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    if (node.offsetParent === null && node.tagName !== "HTML" && !node.isContentEditable) return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 10 && rect.height >= 10;
  }

  function isPartOfOurShadow(node) {
    // The extension's UI lives inside a Shadow DOM whose host has id="kwv-host".
    // In "open" mode, focusin events retarget across the boundary — but if we
    // walk up the ancestor chain we may still cross into our own tree.
    let n = node;
    while (n) {
      if (n.id === "kwv-host") return true;
      const root = n.getRootNode?.();
      if (root instanceof ShadowRoot) {
        if (root.host && root.host.id === "kwv-host") return true;
        n = root.host;
      } else {
        n = n.parentNode;
      }
    }
    return false;
  }

  // Focus tracking ---------------------------------------------------
  // Record the last light-DOM input the user interacted with. This becomes
  // the primary insertion target because the FAB/sheet steal focus by the
  // time the user commits.

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!target || target === document.body) return;
      if (isPartOfOurShadow(target)) return;
      if (!isInputLike(target)) return;
      state.lastFocusedInput = target;
      log("tracked composer candidate", target);
    },
    true
  );

  // Composer adapter -------------------------------------------------

  function findComposer() {
    // 1. Most reliable: the last input-like element that received focus.
    const remembered = state.lastFocusedInput;
    if (
      remembered &&
      document.body.contains(remembered) &&
      isInputLike(remembered) &&
      isVisible(remembered) &&
      !remembered.disabled &&
      !remembered.readOnly
    ) {
      return remembered;
    }

    // 2. Semantic hints via data-testid / data-slot / aria (framework-agnostic).
    const hintSelectors = [
      '[data-testid*="composer" i]',
      '[data-testid*="prompt" i]',
      '[data-testid*="chat-input" i]',
      '[data-testid*="message-input" i]',
      '[data-slot*="composer" i]',
      '[data-slot*="input" i]',
      '[aria-label*="message" i][contenteditable="true"]',
      '[aria-label*="prompt" i][contenteditable="true"]',
      '[aria-label*="ask" i][contenteditable="true"]',
      '[aria-label*="kiro" i][contenteditable="true"]',
    ];
    for (const sel of hintSelectors) {
      const hits = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      const usable = hits.find(isInputLike);
      if (usable) return usable;
    }

    // 3. Known rich-text editor markers used by popular frameworks.
    const editorSelectors = [
      '[contenteditable="true"][data-lexical-editor]',
      '[contenteditable="true"][data-slate-editor]',
      '.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-label]',
    ];
    for (const sel of editorSelectors) {
      const hits = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      if (hits.length) return hits[hits.length - 1];
    }

    // 4. Any usable textarea, preferring one positioned near the bottom.
    const textareas = Array.from(document.querySelectorAll("textarea"))
      .filter((t) => !t.disabled && !t.readOnly)
      .filter(isVisible)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    if (textareas.length) return textareas[0];

    // 5. Any visible contenteditable, again preferring the bottom-most.
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(isVisible)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    if (editables.length) return editables[0];

    // 6. Input[type=text] with a helpful label.
    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input[type="search"], [role="textbox"]')
    ).filter(isVisible);
    const labelled = inputs.find((n) => {
      const label = (
        n.getAttribute("aria-label") ||
        n.getAttribute("placeholder") ||
        n.getAttribute("title") ||
        ""
      ).toLowerCase();
      return /kiro|ask|message|prompt|chat|type here/.test(label);
    });
    if (labelled) return labelled;

    return null;
  }

  // Insertion --------------------------------------------------------

  function insertIntoComposer(text, { submit = false } = {}) {
    const composer = findComposer();
    if (!composer) {
      log("no composer found; falling back to clipboard");
      copyToClipboardWithToast(text);
      return false;
    }
    log("inserting into composer", composer);
    const ok = insertText(composer, text);
    if (!ok) {
      log("insertion failed on target; falling back to clipboard");
      copyToClipboardWithToast(text);
      return false;
    }
    if (submit) {
      composer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
    }
    return true;
  }

  function insertText(target, text) {
    try {
      target.focus({ preventScroll: false });
    } catch {
      /* focus() may throw on some contenteditable elements; ignore */
    }
    if (target.isContentEditable) {
      return insertIntoContentEditable(target, text);
    }
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return insertIntoTextInput(target, text);
    }
    return false;
  }

  function insertIntoContentEditable(target, text) {
    const sel = window.getSelection();
    if (!sel) return false;

    // Place the caret at the end of the editor if the selection is not
    // already inside the target.
    const inTarget = sel.rangeCount > 0 && target.contains(sel.anchorNode);
    if (!inTarget) {
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      sel.addRange(range);
    }
    const before = target.textContent || "";

    // Strategy A: beforeinput event, which Lexical / Slate / ProseMirror
    // handle natively as a text-insertion request.
    try {
      const beforeInput = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: text,
      });
      target.dispatchEvent(beforeInput);
      if ((target.textContent || "").length > before.length) return true;
    } catch {
      /* fall through */
    }

    // Strategy B: legacy execCommand — widely honoured across editors.
    try {
      if (document.execCommand && document.execCommand("insertText", false, text)) {
        if ((target.textContent || "").length > before.length) return true;
      }
    } catch {
      /* fall through */
    }

    // Strategy C: manual DOM insertion + input event.
    try {
      const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : (() => {
        const r = document.createRange();
        r.selectNodeContents(target);
        r.collapse(false);
        return r;
      })();
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
          inputType: "insertText",
          data: text,
        })
      );
      return (target.textContent || "").length > before.length;
    } catch (e) {
      log("contenteditable strategies exhausted", e);
      return false;
    }
  }

  function insertIntoTextInput(target, text) {
    try {
      const proto =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) return false;

      const existing = target.value || "";
      const separator = existing && !/\s$/.test(existing) ? " " : "";
      const next = existing + separator + text;

      // React tracks _valueTracker on the DOM node; using the native setter
      // bypasses its "same value, don't re-fire" optimisation.
      setter.call(target, next);
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
          inputType: "insertText",
          data: text,
        })
      );
      // Some libraries also listen for 'change'.
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return target.value === next;
    } catch (e) {
      log("text input insertion failed", e);
      return false;
    }
  }

  async function copyToClipboardWithToast(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(
        "入力欄が特定できませんでした。文字起こしをコピーしましたので、貼り付けてください（Ctrl+V / ⌘V）。",
        5500
      );
    } catch (e) {
      log("clipboard write failed", e);
      showToast(
        `貼り付けに失敗しました。書き起こし: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`,
        6000
      );
    }
  }

  // ------------------------------------------------------------------
  // Message extractor — pull the latest agent message text for TTS.
  // ------------------------------------------------------------------

  function extractLatestAgentMessage() {
    // Prefer semantic roles.
    const groups = document.querySelectorAll('[role="log"] [role="article"], [data-message-role="assistant"], [data-role="assistant"]');
    if (groups.length) return sanitiseText(groups[groups.length - 1]);

    // Fallback: last article-like container in main.
    const main = document.querySelector("main") || document.body;
    const articles = main.querySelectorAll("article, [role='article']");
    if (articles.length) return sanitiseText(articles[articles.length - 1]);

    return null;
  }

  function sanitiseText(root) {
    if (!root) return null;
    const clone = root.cloneNode(true);
    if (state.settings.skipCodeBlocks) {
      clone.querySelectorAll("pre, code, kbd, samp").forEach((n) => n.remove());
    }
    // Strip our own chips if they were included.
    clone.querySelectorAll(".kwv-read, .kwv-fab, .kwv-sheet, .kwv-toast").forEach((n) => n.remove());
    const text = clone.textContent?.replace(/\s+/g, " ").trim() || "";
    return text.length ? text : null;
  }

  // ------------------------------------------------------------------
  // Speech recognition
  // ------------------------------------------------------------------

  // Recognition sessions in Chrome end automatically after ~60s regardless
  // of `continuous`. We treat "the user wants to keep listening" as its own
  // state and transparently restart the recognizer as many times as needed.
  const PERMANENT_ERRORS = new Set([
    "not-allowed",
    "service-not-allowed",
    "audio-capture",
    "language-not-supported",
  ]);

  function ensureRecognition() {
    if (state.recognition) return state.recognition;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      showToast("このブラウザは Web Speech API に対応していません。Chrome または Edge をご利用ください。");
      return null;
    }
    const rec = new Ctor();
    rec.lang = state.settings.lang || "ja-JP";
    rec.interimResults = !!state.settings.interim;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      state.listening = true;
      setFabListening(true);
      openSheet();
      updateSheetStatus("聞き取り中…");
    };

    rec.onresult = (event) => {
      let interim = "";
      let finalText = state.finalTranscript;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const trimmed = chunk.trim();
          if (trimmed) {
            finalText = finalText ? `${finalText} ${trimmed}` : trimmed;
          }
        } else {
          interim += chunk;
        }
      }
      state.finalTranscript = finalText;
      state.interimTranscript = interim.trim();
      renderTranscript();
    };

    rec.onerror = (event) => {
      log("recognition error", event.error);
      if (PERMANENT_ERRORS.has(event.error)) {
        const messages = {
          "not-allowed": "マイクの利用が許可されていません。アドレスバーから許可してください。",
          "service-not-allowed": "音声認識サービスが利用できません。",
          "audio-capture": "マイクが見つかりませんでした。",
          "language-not-supported": "この言語は音声認識に対応していません。",
        };
        showToast(messages[event.error] || `音声認識に失敗しました: ${event.error}`);
        stopListening();
        return;
      }
      // Transient errors (no-speech, aborted, network) — let onend restart.
      if (event.error === "network") {
        showToast("ネットワークエラーで一時的に失敗しました。再試行します。");
      }
    };

    rec.onend = () => {
      // If the user still wants to be recording, transparently restart the
      // recognizer. We keep a small delay so a fresh session can be created.
      if (state.recognizingSession) {
        setTimeout(() => {
          if (!state.recognizingSession) return;
          try {
            rec.start();
          } catch (err) {
            log("auto-restart failed, ending session", err);
            state.recognizingSession = false;
            state.listening = false;
            setFabListening(false);
            updateSheetStatus(
              state.finalTranscript ? "確認して挿入してください" : "音声が検出されませんでした"
            );
          }
        }, 120);
        return;
      }
      state.listening = false;
      setFabListening(false);
      updateSheetStatus(
        state.finalTranscript ? "確認して挿入してください" : "音声が検出されませんでした"
      );
    };

    state.recognition = rec;
    return rec;
  }

  function startListening() {
    if (state.listening) return;
    const rec = ensureRecognition();
    if (!rec) return;
    // Snapshot the currently focused input as a strong composer hint before
    // the FAB steals focus.
    if (
      document.activeElement &&
      isInputLike(document.activeElement) &&
      !isPartOfOurShadow(document.activeElement)
    ) {
      state.lastFocusedInput = document.activeElement;
    }
    state.finalTranscript = "";
    state.interimTranscript = "";
    state.recognizingSession = true;
    try {
      rec.lang = state.settings.lang || "ja-JP";
      rec.interimResults = !!state.settings.interim;
      rec.continuous = true;
      rec.start();
    } catch (err) {
      log("start failed", err);
      state.recognizingSession = false;
      showToast("音声認識を開始できませんでした。");
    }
  }

  function stopListening() {
    // Signal onend NOT to restart before we call stop().
    state.recognizingSession = false;
    if (state.recognition && state.listening) {
      try {
        state.recognition.stop();
      } catch {
        /* no-op */
      }
    }
    state.listening = false;
    setFabListening(false);
  }

  function toggleListening() {
    if (state.listening) stopListening();
    else startListening();
  }

  // ------------------------------------------------------------------
  // Text-to-speech
  // ------------------------------------------------------------------

  function speak(text, chipEl = null) {
    if (!("speechSynthesis" in window)) {
      showToast("このブラウザは読み上げに対応していません。");
      return;
    }
    if (!text) return;

    // Half-duplex: stop listening while we speak so mic does not pick us up.
    if (state.listening) stopListening();
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = state.settings.lang || "ja-JP";
    utter.rate = state.settings.ttsRate || 1.0;
    utter.pitch = state.settings.ttsPitch || 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (state.settings.ttsVoiceURI) {
      const match = voices.find((v) => v.voiceURI === state.settings.ttsVoiceURI);
      if (match) utter.voice = match;
    } else {
      const match = voices.find((v) => v.lang?.toLowerCase().startsWith((utter.lang || "").toLowerCase().slice(0, 2)));
      if (match) utter.voice = match;
    }

    if (chipEl) {
      chipEl.dataset.speaking = "true";
      chipEl.textContent = "停止";
      state.speakingChip = chipEl;
    }
    utter.onend = utter.onerror = () => {
      if (chipEl) {
        delete chipEl.dataset.speaking;
        chipEl.textContent = "読み上げ";
      }
      state.speakingChip = null;
    };

    window.speechSynthesis.speak(utter);
  }

  function toggleSpeak(text, chipEl) {
    if (state.speakingChip === chipEl && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (chipEl) {
        delete chipEl.dataset.speaking;
        chipEl.textContent = "読み上げ";
      }
      state.speakingChip = null;
      return;
    }
    speak(text, chipEl);
  }

  // ------------------------------------------------------------------
  // UI — Shadow DOM host + components
  // ------------------------------------------------------------------

  let shadowHost = null;
  let shadowRoot = null;
  let fab = null;
  let sheet = null;
  let transcriptField = null;
  let sheetStatus = null;
  let toastNode = null;
  let toastTimer = null;

  function mountUi() {
    shadowHost = el("div", { id: "kwv-host", style: { all: "initial" } });
    document.documentElement.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: "open" });

    // Load the extension's stylesheet inside the shadow root.
    const link = el("link", {
      rel: "stylesheet",
      href: chrome.runtime.getURL("src/content/content.css"),
    });
    shadowRoot.appendChild(link);

    const root = el("div", { class: "kwv-root" });
    shadowRoot.appendChild(root);

    fab = buildFab();
    root.appendChild(fab);
    root.appendChild(buildSheet());
  }

  function buildFab() {
    const dot = el("span", { class: "kwv-fab__dot" });
    const label = el("span", { class: "kwv-fab__label" }, "話す");
    const btn = el(
      "button",
      {
        class: "kwv-fab",
        type: "button",
        "aria-label": "音声入力を開始（Alt+K）",
        title: "音声入力を開始（Alt+K）",
      },
      [dot, label]
    );
    // Pointer-down feedback and click to toggle.
    btn.addEventListener("pointerdown", () => { btn.dataset.pressed = "true"; });
    btn.addEventListener("pointerup", () => { delete btn.dataset.pressed; });
    btn.addEventListener("pointercancel", () => { delete btn.dataset.pressed; });
    btn.addEventListener("pointerleave", () => { delete btn.dataset.pressed; });
    btn.addEventListener("click", () => toggleListening());
    return btn;
  }

  function buildSheet() {
    sheet = el("section", {
      class: "kwv-sheet",
      role: "dialog",
      "aria-label": "音声入力の確認",
      style: { display: "none" },
    });

    const header = el("div", { class: "kwv-sheet__header" }, [
      el("span", { class: "kwv-sheet__title" }, "Voice input"),
      (sheetStatus = el("span", { class: "kwv-sheet__status" }, "")),
    ]);

    transcriptField = el("textarea", {
      class: "kwv-sheet__transcript",
      "aria-label": "文字起こし結果",
      spellcheck: "false",
      placeholder: "話した内容がここに表示されます…",
    });
    transcriptField.addEventListener("input", () => {
      delete transcriptField.dataset.interim;
      state.finalTranscript = transcriptField.value.trim();
      state.interimTranscript = "";
    });

    const cancel = el("button", { class: "kwv-btn kwv-btn--ghost", type: "button" }, "キャンセル");
    cancel.addEventListener("click", () => closeSheet());

    const insert = el("button", { class: "kwv-btn kwv-btn--primary", type: "button" }, "入力欄へ挿入");
    insert.addEventListener("click", () => {
      const text = (transcriptField.value || "").trim();
      if (!text) { closeSheet(); return; }
      // Auto-submit is opt-in via settings, never default.
      const submit = !!state.settings.autoSubmit;
      insertIntoComposer(text, { submit });
      closeSheet();
    });

    const actions = el("div", { class: "kwv-sheet__actions" }, [cancel, insert]);

    sheet.append(header, transcriptField, actions);
    return sheet;
  }

  function openSheet() {
    if (!sheet) return;
    sheet.style.display = "";
    transcriptField.value = "";
    delete transcriptField.dataset.interim;
    springIn(sheet);
  }

  function closeSheet() {
    if (!sheet) return;
    stopListening();
    springOut(sheet, () => { sheet.style.display = "none"; });
  }

  function updateSheetStatus(text) {
    if (sheetStatus) sheetStatus.textContent = text;
  }

  function renderTranscript() {
    if (!transcriptField) return;
    if (state.finalTranscript) {
      transcriptField.value = state.finalTranscript + (state.interimTranscript ? " " + state.interimTranscript : "");
      transcriptField.dataset.interim = state.interimTranscript ? "true" : "false";
    } else {
      transcriptField.value = state.interimTranscript;
      transcriptField.dataset.interim = "true";
    }
  }

  function setFabListening(on) {
    if (!fab) return;
    if (on) {
      fab.dataset.listening = "true";
      fab.querySelector(".kwv-fab__label").textContent = "停止";
      fab.setAttribute("aria-label", "音声入力を停止（Alt+K）");
    } else {
      delete fab.dataset.listening;
      fab.querySelector(".kwv-fab__label").textContent = "話す";
      fab.setAttribute("aria-label", "音声入力を開始（Alt+K）");
    }
  }

  function showToast(text, ms = 2600) {
    if (!shadowRoot) return;
    if (!toastNode) {
      toastNode = el("div", { class: "kwv-toast", role: "status" });
      shadowRoot.querySelector(".kwv-root").appendChild(toastNode);
    }
    toastNode.textContent = text;
    toastNode.style.opacity = "1";
    springIn(toastNode);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => springOut(toastNode, () => { toastNode.style.opacity = "0"; }), ms);
  }

  // ------------------------------------------------------------------
  // Spring animation (tiny, interruptible, velocity-aware).
  // Apple: damping 1.0 / response 0.3 default; springs > CSS transitions.
  // ------------------------------------------------------------------

  function shouldReduceMotion() {
    return state.settings.respectReducedMotion &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  function springIn(node) {
    if (!node) return;
    if (shouldReduceMotion()) {
      node.style.opacity = "1";
      node.style.transform = "none";
      return;
    }
    animateSpring(node, {
      from: { s: 0.94, o: 0, b: 8 },
      to:   { s: 1.0,  o: 1, b: 24 },
      damping: 1.0,
      response: 0.32,
      apply: (v) => {
        node.style.transform = `scale(${v.s})`;
        node.style.opacity = `${v.o}`;
        node.style.filter = `blur(${Math.max(0, (1 - v.o) * 8)}px)`;
      },
    });
  }

  function springOut(node, done) {
    if (!node) return;
    if (shouldReduceMotion()) {
      node.style.opacity = "0";
      done?.();
      return;
    }
    animateSpring(node, {
      from: { s: 1.0,  o: 1 },
      to:   { s: 0.96, o: 0 },
      damping: 1.0,
      response: 0.22,
      apply: (v) => {
        node.style.transform = `scale(${v.s})`;
        node.style.opacity = `${v.o}`;
      },
      onDone: done,
    });
  }

  // A minimal, interruptible spring: we cancel any prior loop before starting.
  const _springs = new WeakMap();
  function animateSpring(node, { from, to, damping, response, apply, onDone }) {
    const prev = _springs.get(node);
    if (prev) cancelAnimationFrame(prev.raf);

    const stiffness = Math.pow((2 * Math.PI) / response, 2);
    const dampingCoef = 2 * damping * Math.sqrt(stiffness);
    const state2 = {};
    for (const k of Object.keys(to)) {
      state2[k] = { value: from[k] ?? 0, velocity: 0, target: to[k] };
    }
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      let settled = true;
      const view = {};
      for (const k of Object.keys(state2)) {
        const s = state2[k];
        const a = -stiffness * (s.value - s.target) - dampingCoef * s.velocity;
        s.velocity += a * dt;
        s.value += s.velocity * dt;
        view[k] = s.value;
        if (Math.abs(s.value - s.target) > 0.002 || Math.abs(s.velocity) > 0.02) settled = false;
      }
      apply(view);
      if (!settled) {
        const raf = requestAnimationFrame(step);
        _springs.set(node, { raf });
      } else {
        for (const k of Object.keys(state2)) view[k] = state2[k].target;
        apply(view);
        _springs.delete(node);
        onDone?.();
      }
    };
    const raf = requestAnimationFrame(step);
    _springs.set(node, { raf });
  }

  // ------------------------------------------------------------------
  // Read-aloud chips on agent messages.
  // We attach a small chip to the last agent article whenever it changes.
  // ------------------------------------------------------------------

  function ensureReadChips() {
    const candidates = document.querySelectorAll('[role="log"] [role="article"], [data-message-role="assistant"], [data-role="assistant"], main article');
    if (!candidates.length) return;
    const latest = candidates[candidates.length - 1];
    if (!latest || latest.dataset.kwvChip === "1") return;
    latest.dataset.kwvChip = "1";
    // Hide previous visible chips so only the latest is visible.
    document.querySelectorAll(".kwv-read").forEach((n) => { n.dataset.visible = "false"; });

    const chip = el("button", {
      class: "kwv-read",
      type: "button",
      "aria-label": "この回答を読み上げる",
      dataset: { visible: "true" },
    }, "読み上げ");
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = sanitiseText(latest);
      if (text) toggleSpeak(text, chip);
    });
    latest.appendChild(chip);

    if (state.settings.outputMode === OUTPUT_MODES.AUTO_READ) {
      // Debounce: wait a moment for streaming to finish.
      const messageId = latest.getAttribute("data-kwv-id") || `${latest.getBoundingClientRect().top}-${Date.now()}`;
      latest.setAttribute("data-kwv-id", messageId);
      if (state.lastReadMessageId !== messageId) {
        state.lastReadMessageId = messageId;
        setTimeout(() => {
          const text = sanitiseText(latest);
          if (text) speak(text, chip);
        }, 800);
      }
    }
  }

  // ------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type) return;
    if (message.type === MSG.COMMAND_TOGGLE) toggleListening();
    if (message.type === MSG.COMMAND_READ) {
      const text = extractLatestAgentMessage();
      if (text) speak(text);
      else showToast("読み上げ対象のメッセージが見つかりませんでした。");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.listening) {
      stopListening();
      closeSheet();
    }
  });

  const observer = new MutationObserver(() => {
    ensureReadChips();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  (async function boot() {
    await loadSettings();
    mountUi();
    ensureReadChips();
    log("Kiro Web Voice ready", { lang: state.settings.lang, mode: state.settings.outputMode });
  })();
})();
