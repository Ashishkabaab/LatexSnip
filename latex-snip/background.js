// background.js — MV3 service worker
// Responsibilities:
//  - React to the toolbar icon / keyboard shortcut and inject content script
//  - Handle captureVisibleTab (only available to extension pages)
//  - Call the appropriate cloud vision API and return LaTeX to content.js

importScripts("settings.js", "cloud-providers.js");

// --- Snip session startup --------------------------------------------------

async function startSnip(tab) {
  if (!tab || !tab.id) return;

  if (!tab.url || /^chrome(-extension)?:\/\//.test(tab.url)) {
    console.warn("LaTeX Snip: can't run on this page.", tab.url);
    return;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["overlay.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    chrome.tabs.sendMessage(tab.id, { type: "LATEX_SNIP_START" });
  } catch (err) {
    console.error("LaTeX Snip: failed to start snip", err);
  }
}

chrome.action.onClicked.addListener((tab) => startSnip(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "trigger-snip") startSnip(tab);
});

// --- Message routing -------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Screenshot request from content.js
  if (message?.type === "LATEX_SNIP_CAPTURE") {
    const windowId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true; // keep channel open for async sendResponse
  }

  // Recognition request from content.js
  if (message?.type === "LATEX_SNIP_RECOGNIZE") {
    (async () => {
      try {
        const settings = await latexSnipGetSettings();
        const result = await recognizeCloud(message.dataUrl, settings);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
});

// --- Cloud recognition -----------------------------------------------------

async function recognizeCloud(dataUrl, settings) {
  const { provider, apiKeys } = settings;
  const apiKey = apiKeys?.[provider] || "";

  if (!apiKey) {
    const providerLabel = PROVIDERS[provider]?.label || provider;
    return {
      ok: false,
      provider,
      error: `No API key set for ${providerLabel}. Add one in Settings (right-click the extension icon → Options).`,
    };
  }

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!match) {
    return { ok: false, provider, error: "Unexpected image format from capture." };
  }
  const [, mediaType, base64Data] = match;

  const adapter = PROVIDERS[provider];
  if (!adapter) {
    return { ok: false, provider, error: `Unknown provider: ${provider}` };
  }

  const { url, headers, body } = adapter.build(base64Data, mediaType, apiKey);

  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    return { ok: false, provider, error: `Network error: ${err.message}` };
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errBody = await response.json();
      // Each provider puts the error message in a slightly different place.
      detail =
        errBody?.error?.message ||   // Anthropic + OpenAI
        errBody?.error?.status ||    // Google sometimes
        detail;
    } catch { /* body wasn't JSON */ }
    return { ok: false, provider, error: `API error (${response.status}): ${detail}` };
  }

  const data = await response.json();
  const text = adapter.parse(data);

  if (!text || text === "NO_MATH_FOUND") {
    return { ok: false, provider, error: "No math was recognized in that selection." };
  }

  return { ok: true, provider, latex: text };
}
