import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createChallenge, normalizeWallet, verifySignature } from "../src/auth/siws";
import { encodeBase58 } from "../src/utils/base58";

test("SIWS 签名可验证且不可篡改", async () => {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const rawPublicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", publicKey));
  const wallet = encodeBase58(rawPublicKey);

  const normalized = normalizeWallet(wallet);
  assert.equal(normalized, wallet);

  const now = new Date("2026-01-27T00:00:00.000Z");
  const challenge = createChallenge({
    wallet,
    domain: "example.com",
    now,
    ttlSeconds: 300,
  });

  const signatureBytes = new Uint8Array(
    await webcrypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(challenge.message),
    ),
  );
  const signatureBase64 = Buffer.from(signatureBytes).toString("base64");

  const ok = await verifySignature({
    wallet,
    message: challenge.message,
    signature: signatureBase64,
  });
  assert.equal(ok, true);

  const tampered = await verifySignature({
    wallet,
    message: `${challenge.message}\n`,
    signature: signatureBase64,
  });
  assert.equal(tampered, false);
});
