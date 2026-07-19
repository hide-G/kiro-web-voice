/**
 * Kiro Web Voice — DevTools diagnostic script.
 *
 * Usage:
 *   1. Open https://app.kiro.dev/ in Chrome with the extension loaded.
 *   2. Open DevTools (F12 / Cmd+Opt+I) and switch to the Console tab.
 *   3. Paste this entire file and press Enter.
 *   4. Copy the JSON that appears and share it back for troubleshooting.
 *
 * The script does not send data anywhere. It only inspects the current page's
 * DOM and prints a structured report to the console.
 *
 * Note: the "lastText" fields include up to 140 characters of assistant
 * message content. Avoid running this immediately after a sensitive prompt.
 */
(async () => {
  const report = {
    time: new Date().toISOString(),
    url: location.href,
    origin: location.origin,
  };

  // 1) Environment
  report.env = {
    userAgent: navigator.userAgent.slice(0, 140),
    isSecureContext: window.isSecureContext,
    speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    speechSynthesis: "speechSynthesis" in window,
  };

  // 2) Extension injection state
  const host = document.getElementById("kwv-host");
  report.extension = {
    kwvInstalled: !!window.__kwvInstalled,
    hostElement: !!host,
    shadowRoot: !!host?.shadowRoot,
    fabPresent: !!host?.shadowRoot?.querySelector(".kwv-fab"),
    sheetPresent: !!host?.shadowRoot?.querySelector(".kwv-sheet"),
  };

  // 3) Composer candidate detection
  const describe = (n) => ({
    tag: n.tagName.toLowerCase(),
    role: n.getAttribute("role"),
    ariaLabel: (n.getAttribute("aria-label") || "").slice(0, 60),
    placeholder: (n.getAttribute("placeholder") || "").slice(0, 60),
    dataTestId: n.getAttribute("data-testid"),
    dataSlot: n.getAttribute("data-slot"),
    id: n.id || null,
    className: (n.className || "").toString().slice(0, 100),
    isContentEditable: !!n.isContentEditable,
    disabled: !!n.disabled,
    readOnly: !!n.readOnly,
    yPos: Math.round(n.getBoundingClientRect().top),
    visible: n.offsetParent !== null,
  });

  report.composer = [
    {
      name: "A. contenteditable + role/label",
      sel: '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label]',
    },
    {
      name: "B. rich-text editor markers",
      sel: '[contenteditable="true"][data-lexical-editor], [contenteditable="true"][data-slate-editor], .ProseMirror[contenteditable="true"]',
    },
    { name: "C. all visible textareas", sel: "textarea" },
    {
      name: "D. input / role=textbox",
      sel: 'input[type="text"], input[type="search"], [role="textbox"]',
    },
    { name: "E. any contenteditable", sel: '[contenteditable="true"]' },
    {
      name: "F. semantic hints (data-testid, data-slot)",
      sel: '[data-testid*="composer" i], [data-testid*="prompt" i], [data-testid*="chat-input" i], [data-slot*="composer" i], [data-slot*="input" i]',
    },
  ].map((t) => {
    const nodes = Array.from(document.querySelectorAll(t.sel));
    const visible = nodes.filter((n) => n.offsetParent !== null);
    return {
      name: t.name,
      total: nodes.length,
      visible: visible.length,
      samples: visible.slice(-3).map(describe),
    };
  });

  // 4) Assistant message detection
  report.messages = [
    { name: "X. role=log article", sel: '[role="log"] [role="article"]' },
    {
      name: "Y. data-role=assistant",
      sel: '[data-message-role="assistant"], [data-role="assistant"]',
    },
    { name: "Z. main article", sel: "main article, main [role=\"article\"]" },
  ].map((t) => {
    const nodes = document.querySelectorAll(t.sel);
    const last = nodes[nodes.length - 1];
    return {
      name: t.name,
      count: nodes.length,
      lastText: last ? (last.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140) : null,
      lastAttrs: last
        ? {
            role: last.getAttribute("role"),
            dataRole: last.getAttribute("data-role"),
            dataMessageRole: last.getAttribute("data-message-role"),
            dataTestId: last.getAttribute("data-testid"),
            className: (last.className || "").toString().slice(0, 100),
          }
        : null,
    };
  });

  // 5) Summary
  const composerHit = report.composer.find((t) => t.visible > 0);
  const messagesHit = report.messages.find((t) => t.count > 0);
  report.summary = {
    composerFound: !!composerHit,
    composerVia: composerHit?.name ?? null,
    messagesFound: !!messagesHit,
    messagesVia: messagesHit?.name ?? null,
  };

  console.log(
    "%c[KWV Diagnostic]",
    "font:600 13px system-ui;color:#0a84ff;background:#eff6ff;padding:2px 6px;border-radius:4px",
    report
  );
  console.log(
    "%c▼ 以下の JSON を全選択してコピーし、hide-G さんとの相談窓口に貼り付けてください",
    "color:#5e5ce6;font-weight:600"
  );
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
