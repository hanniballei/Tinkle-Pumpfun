import { decodeBase58 } from "../utils/base58";

export function parsePositiveBigint(input: unknown): bigint | null {
  if (typeof input !== "string") return null;
  if (!/^\d+$/.test(input)) return null;
  try {
    const value = BigInt(input);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function parsePositiveInt(input: unknown): number | null {
  if (typeof input !== "number" || !Number.isInteger(input)) return null;
  return input > 0 ? input : null;
}

export function parseOptionalInt(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;
  return parsePositiveInt(input);
}

export function parseIsoDate(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function normalizeSignature(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const decoded = decodeBase58(trimmed);
  if (!decoded || decoded.length !== 64) return null;
  return trimmed;
}
