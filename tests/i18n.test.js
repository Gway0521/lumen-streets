import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { locales, t, placeName } from "../src/i18n.js";

test("supported locales cover every UI key and preserve interpolation parameters", () => {
  const keys = Object.keys(locales.en).sort();
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const messages of Object.values(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), keys);
    for (const key of keys) {
      assert.ok(messages[key].trim(), key);
      assert.deepEqual(parameters(messages[key]), parameters(locales.en[key]), key);
    }
  }
  const html = ["index.html", "player.html"].map(file => readFileSync(new URL("../" + file, import.meta.url), "utf8")).join("\n");
  for (const [, key] of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) {
    assert.ok(keys.includes(key), `HTML references missing message: ${key}`);
  }
});

test("default messages are English and interpolate visible place names", () => {
  assert.equal(t("imageAlt", { name: "Sapporo" }), "Sapporo nightscape, current view");
  assert.equal(placeName({ id: "tokyo", name: "東京・新宿" }), "Shinjuku, Tokyo");
  assert.throws(() => t("unknown-message"), /Missing translation/);
});
