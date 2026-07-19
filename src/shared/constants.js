// Shared constants for the Kiro Web Voice extension.
// Keep all magic strings and defaults here so the rest of the codebase reads cleanly.

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: "kwv.settings.v1",
});

export const OUTPUT_MODES = Object.freeze({
  DISPLAY_ONLY: "display_only",
  MANUAL_READ: "manual_read",
  AUTO_READ: "auto_read",
});

export const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  lang: "ja-JP",
  outputMode: OUTPUT_MODES.MANUAL_READ,
  autoSubmit: false,
  interim: true,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsVoiceURI: null,
  skipCodeBlocks: true,
  // A11y: honour system reduce-motion by default.
  respectReducedMotion: true,
  // Privacy mask (v0.2.0) — off by default. Individual sub-toggles apply
  // only when the master `privacyMaskEnabled` is true.
  privacyMaskEnabled: false,
  privacyMaskEmails: true,
  privacyMaskRecent: true,
});

export const MSG = Object.freeze({
  GET_SETTINGS: "kwv:get-settings",
  SET_SETTINGS: "kwv:set-settings",
  COMMAND_TOGGLE: "kwv:cmd:toggle",
  COMMAND_READ: "kwv:cmd:read",
});
