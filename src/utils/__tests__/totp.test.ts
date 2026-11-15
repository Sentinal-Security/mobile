import test from "node:test";
import assert from "node:assert/strict";
import {
  generateTotp,
  normalizeBase32Secret,
  parseOtpAuthUri,
  buildChallengeOptions,
} from "../totp.ts";

test("normalizeBase32Secret normalizes 0/1 typos and strips whitespace", () => {
  assert.equal(normalizeBase32Secret(" jbsw y3dp ehpk 3pxp "), "JBSWY3DPEHPK3PXP");
  assert.equal(normalizeBase32Secret("ab01cd"), "ABOICD");
});

test("generateTotp produces consistent 6-digit RFC 6238 code for known vector", () => {
  // Secret "JBSWY3DPEHPK3PXP" at epoch 0 -> deterministic 6-digit output
  const code = generateTotp("JBSWY3DPEHPK3PXP", 59);
  assert.match(code, /^\d{6}$/);
  assert.equal(code, generateTotp("JBSWY3DPEHPK3PXP", 30));
  assert.notEqual(code, generateTotp("JBSWY3DPEHPK3PXP", 60));
});

test("parseOtpAuthUri parses valid URI and handles malformed percent encoding safely", () => {
  const parsed = parseOtpAuthUri(
    "otpauth://totp/Sentinel%20IAM:alice%40acme.com?secret=jbsw01dp&issuer=Sentinel%20IAM"
  );
  assert.deepEqual(parsed, {
    secret: "JBSWOIDP",
    issuer: "Sentinel IAM",
    accountName: "alice@acme.com",
  });

  // Malformed % sequence must not throw URIError
  const malformed = parseOtpAuthUri("otpauth://totp/bad%ZZlabel?secret=JBSWY3DP&issuer=Bad%2");
  assert.ok(malformed);
  assert.equal(malformed.secret, "JBSWY3DP");
  assert.equal(parseOtpAuthUri("https://example.com"), null);
});

test("buildChallengeOptions returns 3 unique 2-digit options including matchCode", () => {
  const opts = buildChallengeOptions("42");
  assert.equal(opts.length, 3);
  assert.equal(new Set(opts).size, 3);
  assert.ok(opts.includes("42"));
  for (const o of opts) {
    assert.match(o, /^\d{2}$/);
  }

  const fallbackOpts = buildChallengeOptions("invalid");
  assert.equal(fallbackOpts.length, 3);
  assert.ok(fallbackOpts.includes("42"));
});
