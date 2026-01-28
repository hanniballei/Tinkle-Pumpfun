import { randomBytes, webcrypto } from "node:crypto";

import { decodeBase58 } from "../utils/base58";

const textEncoder = new TextEncoder();

export type SiwsChallenge = {
  wallet: string;
  nonce: string;
  message: string;
  issuedAt: Date;
  expiresAt: Date;
  domain: string;
};

export function normalizeWallet(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const decoded = decodeBase58(trimmed);
  if (!decoded || decoded.length !== 32) return null;
  return trimmed;
}

export function resolveAuthDomain(headers: Headers): string {
  const origin = headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host;
    } catch {
      // 忽略非法 origin，退回 host
    }
  }
  const host = headers.get("host");
  if (host) return host;
  return "localhost:3000";
}

export function createChallenge(params: {
  wallet: string;
  domain: string;
  now?: Date;
  ttlSeconds?: number;
}): SiwsChallenge {
  const now = params.now ?? new Date();
  const ttlSeconds = params.ttlSeconds ?? 300;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const nonce = randomBytes(16).toString("hex");
  const message = buildMessage({
    domain: params.domain,
    wallet: params.wallet,
    nonce,
    issuedAt: now,
    expiresAt,
  });
  return {
    wallet: params.wallet,
    nonce,
    message,
    issuedAt: now,
    expiresAt,
    domain: params.domain,
  };
}

export async function verifySignature(params: {
  wallet: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const publicKey = decodeBase58(params.wallet);
  if (!publicKey || publicKey.length !== 32) return false;

  const signatures = decodeSignatureCandidates(params.signature);
  if (signatures.length === 0) return false;

  const key = await webcrypto.subtle.importKey(
    "raw",
    publicKey,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const messageBytes = textEncoder.encode(params.message);
  for (const signature of signatures) {
    const ok = await webcrypto.subtle.verify("Ed25519", key, signature, messageBytes);
    if (ok) return true;
  }
  return false;
}

function buildMessage(params: {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  return [
    `${params.domain} 想让你使用 Solana 钱包登录:`,
    params.wallet,
    "",
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt.toISOString()}`,
    `Expiration Time: ${params.expiresAt.toISOString()}`,
  ].join("\n");
}

function decodeSignatureCandidates(input: string): Uint8Array[] {
  const candidates: Uint8Array[] = [];

  try {
    const asBase64 = Buffer.from(input, "base64");
    if (asBase64.length === 64) {
      candidates.push(new Uint8Array(asBase64));
    }
  } catch {
    // 忽略 base64 解码失败
  }

  const asBase58 = decodeBase58(input);
  if (asBase58 && asBase58.length === 64) {
    candidates.push(asBase58);
  }

  return candidates;
}
