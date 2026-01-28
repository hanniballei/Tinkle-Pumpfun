import { PublicKey } from "@solana/web3.js";

import { decodeBase58 } from "../utils/base58";

export function parsePublicKey(input: string | undefined | null): PublicKey | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const decoded = decodeBase58(trimmed);
  if (!decoded || decoded.length !== 32) return null;
  try {
    return new PublicKey(trimmed);
  } catch {
    return null;
  }
}
