// options.js — settings page logic.

const providerSelect = document.getElementById("provider");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

const keyInputs = {
  anthropic: document.getElementById("key-anthropic"),
  openai: document.getElementById("key-openai"),
  google: document.getElementById("key-google"),
};

const keyRows = {
  anthropic: document.getElementById("key-row-anthropic"),
  openai: document.getElementById("key-row-openai"),
  google: document.getElementById("key-row-google"),
};

// Show only the key field for the selected provider.
function updateKeyVisibility(provider) {
  for (const [p, row] of Object.entries(keyRows)) {
    row.classList.toggle("visible", p === provider);
  }
}

providerSelect.addEventListener("change", () => {
  updateKeyVisibility(providerSelect.value);
});

async function init() {
  const settings = await latexSnipGetSettings();

  providerSelect.value = settings.provider || "anthropic";
  updateKeyVisibility(providerSelect.value);

  const keys = settings.apiKeys || {};
  for (const [provider, input] of Object.entries(keyInputs)) {
    input.value = keys[provider] || "";
  }
}

saveBtn.addEventListener("click", async () => {
  const provider = providerSelect.value;

  // Collect all key values into the map (preserving any previously saved
  // keys for providers the user didn't touch this session).
  const current = await latexSnipGetSettings();
  const apiKeys = { ...current.apiKeys };
  for (const [p, input] of Object.entries(keyInputs)) {
    const val = input.value.trim();
    if (val) {
      apiKeys[p] = val;
    } else {
      delete apiKeys[p]; // don't store empty strings
    }
  }

  await latexSnipSetSettings({ provider, apiKeys });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

init();
