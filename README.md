# LaTeX Snip

A Chrome extension that lets you drag-select any math on your screen and get clean LaTeX back in seconds.

Drag a box over an equation → a vision AI reads it → the result renders as typeset math in a panel → copy to clipboard.

**Bring your own API key.** LaTeX Snip calls the AI provider of your choice directly from the browser — no backend, no database, no account required. Your key is stored locally on your device and never leaves it.

---

## Features

- **Drag-select capture** — draw a box over any equation on any webpage, PDF, or image
- **Three AI provider options** — Claude (Anthropic), GPT-4o (OpenAI), or Gemini (Google)
- **Live math preview** — KaTeX renders the result before you copy it so you can verify it's correct
- **Raw LaTeX always visible** — see exactly what you're copying, no surprises
- **Draggable result panel** — move it out of the way if it's covering something
- **Keyboard shortcut** — `Ctrl+Shift+L` (Mac: `Cmd+Shift+L`) triggers a snip without clicking the icon
- **Fully client-side** — no backend, no telemetry, no data sent anywhere except your chosen AI provider

---

## Installation

### Load unpacked (developer mode)

1. Download and unzip this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `latex-snip` folder
5. Pin the extension from the toolbar puzzle-piece menu for easy access

### Chrome Web Store

Install directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/latex-snip/llphheajphjkomkmmkmbkhnihlpooomi?authuser=0&hl=en).

---

## Setup

1. Get an API key from your preferred provider:
   - **Anthropic (Claude):** [console.anthropic.com](https://console.anthropic.com) — keys start with `sk-ant-`
   - **OpenAI (GPT-4o):** [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — keys start with `sk-`
   - **Google (Gemini):** [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) — keys start with `AIza`

2. Right-click the LaTeX Snip icon → **Options**
3. Select your provider, paste your API key, click **Save**

---

## Usage

1. Navigate to any page containing math (a PDF, a textbook site, a paper, etc.)
2. Click the LaTeX Snip icon in your toolbar, or press `Ctrl+Shift+L` (`Cmd+Shift+L` on Mac)
3. Your screen dims and the cursor becomes a crosshair
4. Click and drag a box around the equation you want
5. A panel appears showing the cropped screenshot
6. Click **Use this snip** — the AI reads the image and returns LaTeX
7. The result renders as typeset math. Copy it with the **Copy LaTeX** button
8. Press `Esc` or click `×` at any point to cancel

---

## Providers

| Provider | Model | Notes |
|---|---|---|
| Anthropic | `claude-sonnet-4-6` | Best overall accuracy on complex/multi-line math |
| OpenAI | `gpt-4o` | Strong on clean printed equations |
| Google | `gemini-1.5-flash` | Fast; good on standard notation |

All three handle clean printed math well. Anthropic's Claude tends to handle messier inputs (handwriting, low contrast, unusual notation) most reliably.

---

## Privacy

- Your API key is stored in `chrome.storage.local` — on your device only, never transmitted anywhere except to your chosen provider's API endpoint
- Cropped screenshot data is sent directly to your chosen provider to generate LaTeX — no other copies are made
- LaTeX Snip has no backend server, no analytics, and no tracking of any kind

---

## File structure

```
manifest.json        Extension config — permissions, shortcuts, icons
background.js        Service worker — injects scripts, takes screenshots, calls the AI API
cloud-providers.js   Request/response adapters for Anthropic, OpenAI, and Google
content.js           Drag-select overlay, screen crop, result panel, KaTeX rendering
overlay.css          Styles for the overlay, selection rect, and result panel
settings.js          chrome.storage.local schema and helpers (provider, API keys)
options.html/js      Settings page — choose provider, enter API key
vendor/katex/        KaTeX JS/CSS/fonts, bundled locally (no CDN, works offline)
icons/               Extension icons at 16/48/128px
```

---

## Development

No build step required. The extension is plain JavaScript (Manifest V3), HTML, and CSS.

To make changes:
1. Edit the source files
2. Go to `chrome://extensions` and click the reload icon on the LaTeX Snip card
3. Try a snip — changes are live immediately

To run the unit tests for the provider adapters:
```bash
node test/cloud-providers.test.js
```
