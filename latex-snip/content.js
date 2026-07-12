// content.js — injected on demand into the active tab.
// Draws a full-page overlay, lets the user drag a selection rectangle,
// then asks background.js for a screenshot and crops it to that rectangle.
//
// Guard against double-injection (icon clicked twice fast, etc).
if (!window.__latexSnipLoaded) {
  window.__latexSnipLoaded = true;

  let overlay = null;
  let rectEl = null;
  let hintEl = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LATEX_SNIP_START") {
      startSnipSession();
    }
  });

  // --- Overlay / drag-select --------------------------------------------------

  function startSnipSession() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.id = "latex-snip-overlay";

    rectEl = document.createElement("div");
    rectEl.id = "latex-snip-rect";

    hintEl = document.createElement("div");
    hintEl.id = "latex-snip-hint";
    hintEl.textContent = "Drag a box around the math · Esc to cancel";

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(rectEl);
    document.documentElement.appendChild(hintEl);

    overlay.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
  }

  function onMouseDown(e) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    rectEl.style.display = "block";
    updateRect(startX, startY);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    updateRect(e.clientX, e.clientY);
  }

  function updateRect(curX, curY) {
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    rectEl.style.left = `${x}px`;
    rectEl.style.top = `${y}px`;
    rectEl.style.width = `${w}px`;
    rectEl.style.height = `${h}px`;
  }

  async function onMouseUp(e) {
    dragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    cleanupOverlay();
    if (w < 6 || h < 6) return; // ignore accidental clicks / tiny drags

    await captureAndCrop({ x, y, w, h });
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanupOverlay();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
  }

  function cleanupOverlay() {
    document.removeEventListener("keydown", onKeyDown);
    overlay?.remove();
    rectEl?.remove();
    hintEl?.remove();
    overlay = null;
    rectEl = null;
    hintEl = null;
  }

  // --- Screenshot + crop -----------------------------------------------------

  async function captureAndCrop(rect) {
    const response = await chrome.runtime.sendMessage({ type: "LATEX_SNIP_CAPTURE" });
    if (!response?.ok) {
      console.error("LaTeX Snip: capture failed", response?.error);
      return;
    }

    const fullImg = await loadImage(response.dataUrl);

    // captureVisibleTab returns a screenshot in *device* pixels;
    // our rect coords are in CSS pixels — scale by devicePixelRatio.
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = rect.w * dpr;
    canvas.height = rect.h * dpr;
    canvas.getContext("2d").drawImage(
      fullImg,
      rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr,
      0, 0, rect.w * dpr, rect.h * dpr
    );

    showPreviewPanel(canvas.toDataURL("image/png"), rect);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // --- KaTeX (lazy, isolated-world-safe) -------------------------------------
  // Uses dynamic import() rather than appending a <script> tag.
  // Content scripts run in an "isolated world" — a different JS context
  // from the page. A <script> tag would run in the page's main world,
  // making window.katex invisible here. dynamic import() loads the module
  // directly into this isolated world, so its exports are reachable.

  let katexLoadPromise = null;

  function ensureKatexLoaded() {
    if (!document.getElementById("latex-snip-katex-css")) {
      const link = document.createElement("link");
      link.id = "latex-snip-katex-css";
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("vendor/katex/katex.min.css");
      document.head.appendChild(link);
    }
    if (!katexLoadPromise) {
      katexLoadPromise = import(chrome.runtime.getURL("vendor/katex/katex.mjs"));
    }
    return katexLoadPromise;
  }

  // --- Panel -----------------------------------------------------------------

  function showPreviewPanel(dataUrl, rect) {
    const panel = document.createElement("div");
    panel.id = "latex-snip-panel";

    const top = Math.min(rect.y + rect.h + 10, window.innerHeight - 200);
    const left = Math.min(rect.x, window.innerWidth - 500);
    panel.style.top = `${Math.max(top, 10)}px`;
    panel.style.left = `${Math.max(left, 10)}px`;

    panel.innerHTML = `
      <button class="latex-snip-close" aria-label="Close" title="Close">&times;</button>
      <img src="${dataUrl}" alt="Captured snip" />
      <div class="latex-snip-row">
        <button class="secondary" id="latex-snip-cancel">Discard</button>
        <button class="primary" id="latex-snip-use">Use this snip</button>
      </div>
    `;

    document.documentElement.appendChild(panel);
    makeDraggable(panel);
    attachCloseHandlers(panel);

    panel.querySelector("#latex-snip-cancel").addEventListener("click", () => closePanel(panel));

    panel.querySelector("#latex-snip-use").addEventListener("click", async () => {
      const useBtn = panel.querySelector("#latex-snip-use");
      useBtn.disabled = true;
      useBtn.textContent = "Recognizing…";
      panel.classList.add("latex-snip-recognizing");

      const result = await chrome.runtime.sendMessage({
        type: "LATEX_SNIP_RECOGNIZE",
        dataUrl,
      });

      panel.classList.remove("latex-snip-recognizing");
      await renderResult(panel, result);
    });
  }

  // --- Draggable panel -------------------------------------------------------
  // mousedown on the panel itself starts a drag; mousedown on interactive
  // elements (buttons, pre, a) is ignored so those still work normally.

  function makeDraggable(panel) {
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isPanelDragging = false;

    panel.addEventListener("mousedown", (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (["button", "pre", "a", "input"].includes(tag)) return;

      isPanelDragging = true;
      dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
      dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isPanelDragging) return;
      const x = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - panel.offsetHeight));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    });

    document.addEventListener("mouseup", () => {
      isPanelDragging = false;
    });
  }

  // --- Close handlers --------------------------------------------------------

  function attachCloseHandlers(panel) {
    panel.querySelector(".latex-snip-close")?.addEventListener("click", () => closePanel(panel));

    // Remove any previous Escape listener before adding a new one, so we
    // don't stack duplicates when innerHTML is rebuilt for the result view.
    if (panel.__latexSnipKeyHandler) {
      document.removeEventListener("keydown", panel.__latexSnipKeyHandler);
    }
    const onKey = (e) => { if (e.key === "Escape") closePanel(panel); };
    document.addEventListener("keydown", onKey);
    panel.__latexSnipKeyHandler = onKey;
  }

  function closePanel(panel) {
    if (panel.__latexSnipKeyHandler) {
      document.removeEventListener("keydown", panel.__latexSnipKeyHandler);
    }
    panel.remove();
  }

  // --- Result rendering ------------------------------------------------------

  async function renderResult(panel, result) {
    if (!result?.ok) {
      // Use insertAdjacentHTML (append-only) rather than innerHTML +=.
      // innerHTML += silently rebuilds the whole panel, orphaning the close
      // button's listener and breaking Esc. insertAdjacentHTML preserves
      // existing DOM and listeners.
      panel.querySelector("#latex-snip-use").disabled = false;
      panel.querySelector("#latex-snip-use").textContent = "Use this snip";
      panel.insertAdjacentHTML(
        "beforeend",
        `<div class="latex-snip-error">${escapeHtml(result?.error || "Recognition failed.")}</div>`
      );
      return;
    }

    const providerLabel = providerName(result.provider);
    const latex = result.latex || "";

    panel.innerHTML = `
      <button class="latex-snip-close" aria-label="Close" title="Close">&times;</button>
      <div class="latex-snip-engine">${providerLabel}</div>
      <div class="latex-snip-label">Preview (rendered from LaTeX)</div>
      <div class="latex-snip-rendered" id="latex-snip-rendered">Rendering…</div>
      <pre class="latex-snip-latex">${escapeHtml(latex)}</pre>
      <div class="latex-snip-row">
        <button class="primary" id="latex-snip-copy">Copy LaTeX</button>
      </div>
    `;
    makeDraggable(panel);
    attachCloseHandlers(panel);

    const renderTarget = panel.querySelector("#latex-snip-rendered");

    try {
      const katexModule = await ensureKatexLoaded();
      katexModule.render(latex, renderTarget, {
        throwOnError: false,
        strict: false,
        displayMode: true,
      });
    } catch (err) {
      renderTarget.textContent = "Couldn't render preview — see raw LaTeX below.";
      console.error("LaTeX Snip: KaTeX render failed", err);
    }

    panel.querySelector("#latex-snip-copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(latex);
      panel.querySelector("#latex-snip-copy").textContent = "Copied!";
    });
  }

  // --- Utilities -------------------------------------------------------------

  function providerName(provider) {
    const names = {
      anthropic: "Claude (Anthropic)",
      openai: "GPT-4o (OpenAI)",
      google: "Gemini (Google)",
    };
    return names[provider] || provider || "Cloud";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}
