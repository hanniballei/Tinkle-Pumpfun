export const MAX_TOTAL_TICKETS = 10_000;
export const DRAW_AT_MIN_HOURS = 1;
export const SALE_END_OFFSET_MS = 2 * 60 * 1000;
export const DRAW_EXECUTE_OFFSET_MS = 60 * 1000;

export function isPumpFunMint(mint: string): boolean {
  return mint.endsWith("pump");
}

export function computeSaleEndAt(drawAt: Date): Date {
  return new Date(drawAt.getTime() - SALE_END_OFFSET_MS);
}

export function computeDrawExecuteAt(drawAt: Date): Date {
  return new Date(drawAt.getTime() + DRAW_EXECUTE_OFFSET_MS);
}

export function computeDraftExpiresAt(params: {
  now: Date;
  saleEndAt: Date;
  ttlSeconds: number;
}): Date {
  const ttlMs = params.ttlSeconds * 1000;
  const expiresAt = new Date(params.now.getTime() + ttlMs);
  return expiresAt.getTime() <= params.saleEndAt.getTime() ? expiresAt : params.saleEndAt;
}
