// test/cloud-providers.test.js
// Unit tests for cloud-providers.js — no network, no real API keys needed.
// Run with: node test/cloud-providers.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// cloud-providers.js uses no browser APIs, so we can load it in Node.
const src = fs.readFileSync(path.join(__dirname, "../cloud-providers.js"), "utf8");
vm.runInThisContext(src);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// PROVIDERS table
// ---------------------------------------------------------------------------
console.log("\nPROVIDERS table");

test("has exactly three providers", () => {
  assert.deepStrictEqual(Object.keys(PROVIDERS).sort(), ["anthropic", "google", "openai"]);
});

test("every provider has build and parse functions", () => {
  for (const [key, p] of Object.entries(PROVIDERS)) {
    assert.strictEqual(typeof p.build, "function", `${key}.build`);
    assert.strictEqual(typeof p.parse, "function", `${key}.parse`);
    assert.ok(p.label, `${key}.label`);
    assert.ok(p.keyPlaceholder, `${key}.keyPlaceholder`);
  }
});

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------
console.log("\nAnthropic adapter");

test("build returns correct URL", () => {
  const { url } = PROVIDERS.anthropic.build("b64data", "image/png", "sk-ant-test");
  assert.strictEqual(url, "https://api.anthropic.com/v1/messages");
});

test("build sets x-api-key header", () => {
  const { headers } = PROVIDERS.anthropic.build("b64data", "image/png", "sk-ant-test");
  assert.strictEqual(headers["x-api-key"], "sk-ant-test");
});

test("build includes anthropic-dangerous-direct-browser-access header", () => {
  const { headers } = PROVIDERS.anthropic.build("b64data", "image/png", "key");
  assert.strictEqual(headers["anthropic-dangerous-direct-browser-access"], "true");
});

test("parse extracts text from content array", () => {
  const data = { content: [{ type: "text", text: "\\frac{a}{b}" }] };
  assert.strictEqual(PROVIDERS.anthropic.parse(data), "\\frac{a}{b}");
});

test("parse returns null for empty content", () => {
  assert.strictEqual(PROVIDERS.anthropic.parse({ content: [] }), null);
});

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------
console.log("\nOpenAI adapter");

test("build returns correct URL", () => {
  const { url } = PROVIDERS.openai.build("b64data", "image/png", "sk-test");
  assert.strictEqual(url, "https://api.openai.com/v1/chat/completions");
});

test("build uses Bearer auth", () => {
  const { headers } = PROVIDERS.openai.build("b64data", "image/png", "sk-test");
  assert.strictEqual(headers["authorization"], "Bearer sk-test");
});

test("parse extracts text from choices", () => {
  const data = { choices: [{ message: { content: "x^2 + y^2" } }] };
  assert.strictEqual(PROVIDERS.openai.parse(data), "x^2 + y^2");
});

// ---------------------------------------------------------------------------
// Google adapter
// ---------------------------------------------------------------------------
console.log("\nGoogle adapter");

test("build URL includes API key as query param", () => {
  const { url } = PROVIDERS.google.build("b64data", "image/png", "AIzaTestKey");
  assert.ok(url.includes("key=AIzaTestKey"), `URL missing key param: ${url}`);
});

test("parse extracts text from candidates", () => {
  const data = {
    candidates: [{ content: { parts: [{ text: "\\int_0^1 x\\,dx" }] } }],
  };
  assert.strictEqual(PROVIDERS.google.parse(data), "\\int_0^1 x\\,dx");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
