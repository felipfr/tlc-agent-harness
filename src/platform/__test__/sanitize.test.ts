import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeSeparators, sanitizeSegment } from "../sanitize.ts";

describe("sanitizeSegment", () => {
  test("escapes colon", () => {
    assert.equal(sanitizeSegment(":"), "%3A");
  });

  test("escapes forward slash", () => {
    assert.equal(sanitizeSegment("/"), "%2F");
  });

  test("escapes backslash", () => {
    assert.equal(sanitizeSegment("\\"), "%5C");
  });

  test("escapes remaining disallowed punctuation", () => {
    for (const ch of ["*", "?", '"', "<", ">", "|"]) {
      const result = sanitizeSegment(ch);
      assert.equal(result.includes(ch), false);
      assert.match(result, /^%[0-9A-F]{2}$/);
    }
  });

  test("leaves allowed characters untouched", () => {
    assert.equal(sanitizeSegment("abc-DEF_123.ts"), "abc-DEF_123.ts");
  });

  test("ISO-8601 timestamp produces no colon in output", () => {
    const result = sanitizeSegment("2026-07-29T12:34:56.789Z");
    assert.equal(result.includes(":"), false);
    assert.equal(result, "2026-07-29T12%3A34%3A56.789Z");
  });

  test("empty input returns a non-empty placeholder", () => {
    const result = sanitizeSegment("");
    assert.equal(result.length > 0, true);
    assert.equal(result, "_empty_");
  });

  test("sanitized output contains only the allowed set or percent-escapes", () => {
    const result = sanitizeSegment('weird:name*with?bad<chars>|and"quotes\\here');
    assert.match(result, /^(?:[A-Za-z0-9._-]|%[0-9A-F]{2})+$/);
  });
});

describe("normalizeSeparators", () => {
  test("converts backslash to forward slash", () => {
    assert.equal(normalizeSeparators("state\\loops\\claude-abc.json"), "state/loops/claude-abc.json");
  });

  test("is idempotent", () => {
    const once = normalizeSeparators("a\\b\\c");
    const twice = normalizeSeparators(once);
    assert.equal(twice, once);
  });
});
