// cloud-providers.js — request-building + response-parsing for each
// supported vision API provider.
//
// All functions are pure (no chrome.* calls, no fetch) so they're
// unit-testable without a browser context. background.js owns the
// actual fetch() call and passes the result in for parsing.

const LATEX_PROMPT = [
  "You will be shown a cropped screenshot containing a single math expression.",
  "Transcribe it as LaTeX. Output ONLY the LaTeX source, with no surrounding",
  "$ or $$ delimiters, no markdown code fences, and no explanation text.",
  "If nothing resembling math is visible, output exactly: NO_MATH_FOUND",
].join(" ");

// ---------------------------------------------------------------------------
// Anthropic — Claude vision
// ---------------------------------------------------------------------------

function buildAnthropicRequest(base64Data, mediaType, apiKey) {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for direct browser→API calls without a backend proxy.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            { type: "text", text: LATEX_PROMPT },
          ],
        },
      ],
    }),
  };
}

function parseAnthropicResponse(data) {
  const text = data?.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// OpenAI — GPT-4o vision
// ---------------------------------------------------------------------------

function buildOpenAIRequest(base64Data, mediaType, apiKey) {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mediaType};base64,${base64Data}` },
            },
            { type: "text", text: LATEX_PROMPT },
          ],
        },
      ],
    }),
  };
}

function parseOpenAIResponse(data) {
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// Google — Gemini vision
// ---------------------------------------------------------------------------

function buildGoogleRequest(base64Data, mediaType, apiKey) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Data } },
            { text: LATEX_PROMPT },
          ],
        },
      ],
    }),
  };
}

function parseGoogleResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.filter((p) => p.text)
    .map((p) => p.text)
    .join("")
    .trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// Dispatch table — index by provider string
// ---------------------------------------------------------------------------

const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyPlaceholder: "sk-ant-...",
    build: buildAnthropicRequest,
    parse: parseAnthropicResponse,
  },
  openai: {
    label: "GPT-4o (OpenAI)",
    keyPlaceholder: "sk-...",
    build: buildOpenAIRequest,
    parse: parseOpenAIResponse,
  },
  google: {
    label: "Gemini (Google)",
    keyPlaceholder: "AIza...",
    build: buildGoogleRequest,
    parse: parseGoogleResponse,
  },
};
