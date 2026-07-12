// settings.js — shared storage schema + helpers.
// Loaded as a classic script via importScripts() in background.js and
// as a <script> tag in options.html.

const LATEX_SNIP_DEFAULTS = {
  provider: "anthropic",        // "anthropic" | "openai" | "google"
  apiKeys: {},                  // { anthropic: "sk-ant-...", openai: "sk-...", google: "..." }
};

function latexSnipGetSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(LATEX_SNIP_DEFAULTS, (stored) => {
      const settings = { ...LATEX_SNIP_DEFAULTS, ...stored };

      // Migrate from the old single-key schema (apiKey string) to the new
      // per-provider apiKeys map. Runs silently on first load after update.
      if (stored.apiKey && typeof stored.apiKey === "string" && stored.apiKey.trim()) {
        if (!settings.apiKeys.anthropic) {
          settings.apiKeys.anthropic = stored.apiKey.trim();
          // Write the migrated value back and clean up the old key.
          chrome.storage.local.set({ apiKeys: settings.apiKeys });
          chrome.storage.local.remove("apiKey");
        }
      }

      resolve(settings);
    });
  });
}

function latexSnipSetSettings(partial) {
  return new Promise((resolve) => {
    chrome.storage.local.set(partial, () => resolve());
  });
}
