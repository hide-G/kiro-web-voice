// MV3 service worker.
// Responsibilities:
//   - Persist and expose settings to the content script + popup.
//   - Route keyboard command shortcuts to the active Kiro Web tab.
//
// This worker keeps no long-lived state; every request re-reads storage.

import { DEFAULT_SETTINGS, MSG } from "../shared/constants.js";
import { getSettings, setSettings } from "../shared/storage.js";

const KIRO_URL_FILTER = { url: [{ hostEquals: "app.kiro.dev" }] };

chrome.runtime.onInstalled.addListener(async () => {
  // Seed defaults on first install so the popup has something to render.
  const existing = await chrome.storage.sync.get("kwv.settings.v1");
  if (!existing["kwv.settings.v1"]) {
    await chrome.storage.sync.set({ "kwv.settings.v1": DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === MSG.GET_SETTINGS) {
    getSettings().then(sendResponse);
    return true; // async
  }

  if (message.type === MSG.SET_SETTINGS) {
    setSettings(message.patch ?? {}).then(sendResponse);
    return true;
  }

  return false;
});

// Global keyboard shortcuts declared in manifest.commands.
// We forward them to the Kiro Web tab so the content script can act.
chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({ url: "https://app.kiro.dev/*", active: true, currentWindow: true });
  const target = tabs[0] ?? (await chrome.tabs.query({ url: "https://app.kiro.dev/*" }))[0];
  if (!target?.id) return;

  const type =
    command === "toggle-listening" ? MSG.COMMAND_TOGGLE :
    command === "read-latest" ? MSG.COMMAND_READ :
    null;

  if (!type) return;
  try {
    await chrome.tabs.sendMessage(target.id, { type });
  } catch {
    // Content script may not be ready yet; safe to ignore for a PoC.
  }
});
