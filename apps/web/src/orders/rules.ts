export function computeOrderExpiresAt(params: {
  now: Date;
  saleEndAt: Date;
  ttlSeconds: number;
}): Date {
  const ttlMs = params.ttlSeconds * 1000;
  const expiresAt = new Date(params.now.getTime() + ttlMs);
  return expiresAt.getTime() <= params.saleEndAt.getTime() ? expiresAt : params.saleEndAt;
}

export function computeReleaseAt(params: {
  expiresAt: Date;
  graceSeconds: number;
}): Date {
  return new Date(params.expiresAt.getTime() + params.graceSeconds * 1000);
}
