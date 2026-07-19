// Small wrapper around chrome.storage.sync so callers do not have to think
// about defaults or missing keys.

import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants.js";

export async function getSettings() {
  const raw = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const stored = raw[STORAGE_KEYS.SETTINGS] ?? {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export function onSettingsChanged(handler) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const entry = changes[STORAGE_KEYS.SETTINGS];
    if (!entry) return;
    handler({ ...DEFAULT_SETTINGS, ...(entry.newValue ?? {}) });
  });
}
