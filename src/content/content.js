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
    finalTranscript: "",
    interimTranscript: "",
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

  function findComposer() {
    // Priority 1: an obvious contenteditable prompt area.
    const editable = document.querySelector(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label]'
    );
    if (editable) return editable;

    // Priority 2: the last visible textarea on the page (chat composer is
    // conventionally at the bottom).
    const textareas = Array.from(document.querySelectorAll("textarea"))
      .filter((t) => t.offsetParent !== null && !t.disabled && !t.readOnly);
    if (textareas.length) return textareas[textareas.length - 1];

    // Priority 3: any text input that mentions Kiro / Ask in its label.
    const candidates = Array.from(
      document.querySelectorAll('input[type="text"], [role="textbox"]')
    );
    return (
      candidates.find((n) => {
        const label = (n.getAttribute("aria-label") || n.getAttribute("placeholder") || "").toLowerCase();
        return /kiro|ask|message|prompt|chat/.test(label);
      }) || null
    );
  }

  function nativeSetValue(input, value) {
    const proto =
      input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      input instanceof HTMLInputElement ? HTMLInputElement.prototype :
      null;
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(input, value);
    } else if (input.isContentEditable) {
      input.textContent = value;
    }
  }

  function insertIntoComposer(text, { submit = false } = {}) {
    const composer = findComposer();
    if (!composer) {
      showToast("Kiroの入力欄が見つかりませんでした。テキストをコピーしました。");
      navigator.clipboard?.writeText(text).catch(() => {});
      return false;
    }
    composer.focus();

    if (composer.isContentEditable) {
      // Insert as plain text; preserves the app's own paste handling.
      const sel = window.getSelection();
      sel?.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(false);
      sel?.addRange(range);
      document.execCommand("insertText", false, text);
    } else {
      const existing = composer.value ?? "";
      const next = existing ? `${existing}${existing.endsWith("\n") ? "" : " "}${text}` : text;
      nativeSetValue(composer, next);
      // React and similar frameworks listen on 'input'.
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (submit) {
      // Only fired when user explicitly opts in — see UI below.
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
    rec.continuous = false;
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
          finalText = (finalText ? `${finalText} ` : "") + chunk.trim();
        } else {
          interim += chunk;
        }
      }
      state.finalTranscript = finalText.trim();
      state.interimTranscript = interim.trim();
      renderTranscript();
    };

    rec.onerror = (event) => {
      log("recognition error", event.error);
      const messages = {
        "not-allowed": "マイクの利用が許可されていません。アドレスバーから許可してください。",
        "service-not-allowed": "音声認識サービスが利用できません。",
        "no-speech": "音声が検出できませんでした。もう一度お試しください。",
        "audio-capture": "マイクが見つかりませんでした。",
        "network": "ネットワークエラーで認識できませんでした。",
      };
      showToast(messages[event.error] || `音声認識に失敗しました: ${event.error}`);
      stopListening();
    };

    rec.onend = () => {
      state.listening = false;
      setFabListening(false);
      updateSheetStatus(state.finalTranscript ? "確認して挿入してください" : "音声が検出されませんでした");
    };

    state.recognition = rec;
    return rec;
  }

  function startListening() {
    if (state.listening) return;
    const rec = ensureRecognition();
    if (!rec) return;
    state.finalTranscript = "";
    state.interimTranscript = "";
    try {
      rec.lang = state.settings.lang || "ja-JP";
      rec.interimResults = !!state.settings.interim;
      rec.start();
    } catch (err) {
      log("start failed", err);
      showToast("音声認識を開始できませんでした。");
    }
  }

  function stopListening() {
    if (state.recognition && state.listening) {
      try { state.recognition.stop(); } catch { /* no-op */ }
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
