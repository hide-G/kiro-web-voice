// Popup script — reads and writes settings via the service worker.

import { OUTPUT_MODES, DEFAULT_SETTINGS, MSG } from "../shared/constants.js";

const els = {
  segButtons: document.querySelectorAll(".kwv-seg__btn"),
  lang: document.getElementById("lang"),
  interim: document.getElementById("interim"),
  autoSubmit: document.getElementById("autoSubmit"),
  voice: document.getElementById("voice"),
  rate: document.getElementById("rate"),
  rateValue: document.getElementById("rateValue"),
  skipCode: document.getElementById("skipCode"),
  testTts: document.getElementById("testTts"),
};

async function getSettings() {
  return chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
}

async function setSettings(patch) {
  return chrome.runtime.sendMessage({ type: MSG.SET_SETTINGS, patch });
}

function renderMode(mode) {
  els.segButtons.forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function populateVoices() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const current = els.voice.value;
  els.voice.innerHTML = '<option value="">システム標準</option>' +
    voices.map((v) => {
      const label = `${v.name}${v.default ? " ★" : ""} (${v.lang})`;
      return `<option value="${v.voiceURI}">${label}</option>`;
    }).join("");
  if (current) els.voice.value = current;
}

function init() {
  getSettings().then((settings) => {
    const s = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    renderMode(s.outputMode);
    els.lang.value = s.lang;
    els.interim.checked = !!s.interim;
    els.autoSubmit.checked = !!s.autoSubmit;
    els.rate.value = String(s.ttsRate ?? 1.0);
    els.rateValue.textContent = Number(els.rate.value).toFixed(2);
    els.skipCode.checked = !!s.skipCodeBlocks;
    populateVoices();
    if (s.ttsVoiceURI) els.voice.value = s.ttsVoiceURI;
  });

  els.segButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.mode;
      renderMode(mode);
      await setSettings({ outputMode: mode });
    });
  });

  els.lang.addEventListener("change", () => setSettings({ lang: els.lang.value }));
  els.interim.addEventListener("change", () => setSettings({ interim: els.interim.checked }));
  els.autoSubmit.addEventListener("change", () => setSettings({ autoSubmit: els.autoSubmit.checked }));
  els.skipCode.addEventListener("change", () => setSettings({ skipCodeBlocks: els.skipCode.checked }));

  els.rate.addEventListener("input", () => {
    els.rateValue.textContent = Number(els.rate.value).toFixed(2);
  });
  els.rate.addEventListener("change", () => setSettings({ ttsRate: Number(els.rate.value) }));

  els.voice.addEventListener("change", () => setSettings({ ttsVoiceURI: els.voice.value || null }));

  els.testTts.addEventListener("click", () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("こんにちは。Kiro Web Voice の読み上げテストです。");
    u.lang = els.lang.value || "ja-JP";
    u.rate = Number(els.rate.value) || 1.0;
    const voices = window.speechSynthesis.getVoices();
    if (els.voice.value) {
      const match = voices.find((v) => v.voiceURI === els.voice.value);
      if (match) u.voice = match;
    }
    window.speechSynthesis.speak(u);
  });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }
}

init();
