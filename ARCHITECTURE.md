# LaTeX Snip — Architecture Guide

This document explains how the extension works in plain English: what each file
does, how they talk to each other, and why key decisions were made the way they
were. It is meant to be read alongside the source files.

---

## What the extension does

LaTeX Snip lets you drag a box over any math on your screen, sends that image to
a vision AI (Claude, GPT-4o, or Gemini), and gets back a clean LaTeX string you
can copy into Overleaf, Notion, or anywhere else that renders math. The result
panel shows a live typeset math preview (via KaTeX) alongside the raw LaTeX and
a copy button.

---

## Why so many files?

A Chrome extension is not one program — it's several isolated programs that run
in different environments and can only communicate by passing messages. Each
environment has different capabilities and restrictions:

```
┌──────────────────────────────────────────────────────────────┐
│  WEBPAGE (e.g. a textbook site, a PDF, any page)            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  content.js (injected into the page on demand)        │  │
│  │  ✓ Can read and modify the page's DOM                 │  │
│  │  ✓ Can draw overlays and panels on top of the page    │  │
│  │  ✗ Cannot take a screenshot                           │  │
│  │  ✗ Cannot call AI APIs directly                       │  │
│  └───────────────────┬────────────────────────────────────┘  │
└─────────────────────│────────────────────────────────────────┘
                      │  messages (chrome.runtime.sendMessage)
┌─────────────────────▼────────────────────────────────────────┐
│  BACKGROUND SERVICE WORKER (background.js)                   │
│  ✓ Can take screenshots (captureVisibleTab)                  │
│  ✓ Can call AI APIs (fetch to external URLs)                 │
│  ✗ Has no DOM — cannot touch any webpage directly            │
│  Runs separately from any webpage; Chrome starts/stops it    │
│  on demand (event-driven, not always-on)                     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  OPTIONS PAGE (options.html / options.js)                    │
│  A regular HTML page shown when you open Settings            │
│  Lets the user pick a provider and enter their API key       │
│  Reads/writes settings via chrome.storage.local             │
└──────────────────────────────────────────────────────────────┘
```

Each of these contexts is sandboxed from the others. They can't call each
other's functions directly — the only bridge is message passing.

---

## File by file

### manifest.json

The extension's identity card. Chrome reads this before running any code.
It declares:
- The extension's name, version, and description
- Permissions (`activeTab`, `scripting`, `storage`)
- Which file runs in the background (`background.js`)
- Which page is the Settings page (`options.html`)
- The keyboard shortcut (`Ctrl+Shift+L` / `Cmd+Shift+L`)
- Which files content scripts are allowed to load via `chrome.runtime.getURL`
  (the KaTeX assets in `vendor/katex/`)

Nothing executes from this file — it is pure configuration.

---

### settings.js

A small shared utility. Both `background.js` and `options.js` need to read and
write the same user preferences, so this file defines the shared data shape and
two helper functions:

- `latexSnipGetSettings()` — reads from `chrome.storage.local`
- `latexSnipSetSettings(partial)` — writes a partial update back

The settings schema:
```js
{
  provider: "anthropic",   // which AI provider to use
  apiKeys: {               // one key per provider, stored separately
    anthropic: "sk-ant-...",
    openai: "sk-...",
    google: "AIza...",
  }
}
```

`chrome.storage.local` is like `localStorage` for extensions — persists across
browser restarts, scoped to this extension only, never synced to any server.

The file also includes a silent migration that runs on first load after an update:
if the user had the old single `apiKey` string, it promotes it into the new
`apiKeys.anthropic` field automatically.

---

### cloud-providers.js

Pure adapter functions for each supported AI provider — no `chrome.*` calls, no
`fetch`. This keeps them fully unit-testable without a real browser.

For each provider (Anthropic, OpenAI, Google) the file exports:
- `build(base64Data, mediaType, apiKey)` → `{ url, headers, body }` — builds
  the full request config ready for `fetch()`
- `parse(responseData)` → `string | null` — extracts the LaTeX text from
  whatever JSON shape that provider returns

Each provider's API has different:
- **Endpoint URL** (e.g. `api.anthropic.com` vs `api.openai.com`)
- **Auth header** (`x-api-key` for Anthropic vs `Authorization: Bearer` for OpenAI)
- **Request schema** (how the image and prompt are structured in the JSON body)
- **Response schema** (where the text lives in the returned JSON)

The adapter pattern isolates all of these differences into one place, so
`background.js` doesn't have any provider-specific logic.

Also defines `PROVIDERS` — a dispatch table keyed by provider string — so adding
a new provider in the future is just adding one entry to the table.

---

### background.js

The coordinator and API caller. This is the service worker — Chrome wakes it up
when something happens (icon clicked, keyboard shortcut pressed, message received)
and may put it back to sleep after.

**Starting a snip session:**
When the icon is clicked or the keyboard shortcut fires, `startSnip(tab)` runs:
- Injects `overlay.css` into the current tab
- Injects `content.js` into the current tab
- Sends a `LATEX_SNIP_START` message to the now-running `content.js`

**Taking the screenshot:**
When `content.js` asks for a screenshot (`LATEX_SNIP_CAPTURE`), `background.js`
calls `chrome.tabs.captureVisibleTab()` — which captures the entire visible tab
as a base64 PNG — and sends it back. Only extension background pages can call
this API, not content scripts.

**Recognition (`LATEX_SNIP_RECOGNIZE`):**
When `content.js` sends the cropped image for recognition, `background.js`:
1. Reads the saved `provider` and `apiKeys` from settings
2. Looks up the right adapter in `PROVIDERS`
3. Calls `adapter.build()` to construct the request
4. Calls `fetch()` with that request
5. Calls `adapter.parse()` on the response JSON to extract the LaTeX string
6. Returns `{ ok, provider, latex }` or `{ ok: false, error }` back to `content.js`

---

### content.js

The only script that directly touches the webpage. Injected into the page's DOM
on demand.

**Drag-select overlay:**
On receiving `LATEX_SNIP_START`:
- Creates a full-screen dimmed overlay (captures mouse events)
- Creates a blue selection rectangle that follows the drag
- Creates a "Drag a box…" hint at the top

**Cropping:**
On `mouseup`:
- Sends `LATEX_SNIP_CAPTURE` to `background.js`, gets back the full-tab PNG
- Multiplies CSS coordinates by `devicePixelRatio` to convert to physical pixels
  (on Retina/HiDPI screens, one CSS pixel = 2+ physical pixels, so the screenshot
  has more pixels than the mouse coords suggest — without this correction the crop
  lands in the wrong place and at the wrong size)
- Draws the selected region onto a Canvas and exports it as a smaller PNG

**Preview panel:**
Shows the cropped image with "Discard" / "Use this snip" buttons.
The panel is draggable (mousedown on the panel starts a drag, but clicks on
buttons/pre/links pass through normally). The `×` button and `Escape` key both
close it.

**Recognizing state:**
While waiting for the API response, a `latex-snip-recognizing` class is toggled
on the panel, which triggers a flowing shimmer animation in `overlay.css`.

**Error handling:**
On failure, uses `insertAdjacentHTML` (append-only) rather than `innerHTML +=`
to add the error message. This matters because `innerHTML +=` silently rebuilds
the entire DOM subtree, orphaning any previously-attached event listeners (the
close button's click handler, the Escape key listener). `insertAdjacentHTML`
appends without touching existing nodes, so listeners stay intact. The "Use this
snip" button is also re-enabled so the user can try again.

**KaTeX rendering:**
Uses a dynamic `import()` of `vendor/katex/katex.mjs` rather than appending a
`<script>` tag. Content scripts run in an "isolated world" — a separate JS
context from the actual page, even though they share the same DOM. A `<script>`
tag runs in the page's main world, so `window.katex` set that way is invisible
to the content script. Dynamic `import()` loads the module into the isolated
world directly, making its exports reachable.

---

### overlay.css

Pure styling injected alongside `content.js`. Covers:
- The full-screen dimmed overlay and crosshair cursor
- The blue selection rectangle
- The hint label
- The panel: `cursor: move` on the panel body, `cursor: pointer` override on
  buttons, the `×` close button, the KaTeX rendered preview box, the raw LaTeX
  code block, the action buttons, the provider label, error state, and the
  shimmer animation for the recognizing state

---

### options.html + options.js

The settings page — shown when you right-click the icon → Options.

`options.js`:
- On load: reads settings, populates the provider dropdown and shows the
  matching key field for the active provider
- Provider dropdown onChange: toggles which key field is visible
- Save: reads the current provider + all key field values, merges into the
  stored `apiKeys` map (preserving keys for providers the user didn't touch),
  writes back to `chrome.storage.local`

---

### vendor/katex/

KaTeX's built files copied directly into the extension, not loaded from a CDN.
This means:
- Works fully offline
- Not subject to any host page's Content-Security-Policy blocking external scripts
- No dependency on a CDN staying up or not changing URLs

Contents: `katex.min.js` (UMD), `katex.mjs` (ES module, used by the extension
via dynamic import), `katex.min.css` (styles), `fonts/` (KaTeX's math fonts in
woff2 format).

---

## The complete message flow for one snip

```
[0] User saved their provider + API key in Options → chrome.storage.local

[1] User clicks the toolbar icon (or presses Ctrl+Shift+L)
    → Chrome fires chrome.action.onClicked
    → background.js: startSnip(tab)

[2] background.js injects overlay.css and content.js into the tab
    → sends LATEX_SNIP_START to content.js

[3] content.js draws the overlay
    → user drags a selection rectangle
    → user releases mouse

[4] content.js → background.js: LATEX_SNIP_CAPTURE
    background.js: captureVisibleTab() → full-tab PNG
    background.js → content.js: { ok: true, dataUrl }

[5] content.js crops the PNG to the selection using Canvas
    → shows preview panel with the cropped image

[6] User clicks "Use this snip"
    content.js → background.js: LATEX_SNIP_RECOGNIZE { dataUrl }

[7] background.js reads settings (provider, apiKeys)
    → calls adapter.build() to construct the request
    → fetch() → AI provider API
    → adapter.parse() → LaTeX string
    background.js → content.js: { ok: true, provider, latex }

[8] content.js dynamically imports KaTeX
    → renders the LaTeX as typeset math in the panel
    → shows raw LaTeX text below
    → shows "Copy LaTeX" button
```

---

## Key concepts

**Manifest V3 (MV3)**
The current Chrome extension architecture. Background scripts must be
"service workers" — event-driven, may be killed and restarted by Chrome at any
time. No persistent in-memory state; everything that needs to survive a restart
goes in `chrome.storage.local`.

**Isolated worlds**
Content scripts run in a separate JavaScript context from the webpage, even
though they share the same DOM. `window` is different in each context. This is
why appending a `<script>` tag to load KaTeX doesn't work — the script sets
`window.katex` in the page's context, but the content script looks at its own
context's `window`. The fix: dynamic `import()` loads the module into the
content script's own context.

**devicePixelRatio**
On HiDPI/Retina displays, one CSS pixel maps to 2+ physical pixels.
`captureVisibleTab` returns a screenshot in physical pixels. Mouse coordinates
are in CSS pixels. Without multiplying by `devicePixelRatio`, the canvas crop
would be in the wrong position and at the wrong scale on high-density screens.

**CORS and anthropic-dangerous-direct-browser-access**
Browsers enforce CORS by default — a script on one origin can't call a different
origin's API unless that server allows it. Anthropic supports direct browser
calls only when the request includes the header
`anthropic-dangerous-direct-browser-access: true`. Without it the browser blocks
the request before it leaves the machine. OpenAI and Google's APIs don't require
this special header.

**Adapter / dispatch pattern (cloud-providers.js)**
Rather than if/else chains in `background.js`, each provider's differences
(URL, auth header, request body, response parsing) are encapsulated in a small
object with `build()` and `parse()` methods. `background.js` just picks the
right adapter from a table and calls the same two functions regardless of which
provider is active. New providers are added by adding one entry to the table.

**insertAdjacentHTML vs innerHTML +=**
`innerHTML +=` is a common pattern but has a subtle bug: it serializes the
current DOM to an HTML string, concatenates the new content, then re-parses the
whole thing — destroying any existing event listeners in the process. In the
error case, this broke the close button. `insertAdjacentHTML("beforeend", html)`
appends new HTML nodes without touching the existing ones, preserving all
attached listeners.
