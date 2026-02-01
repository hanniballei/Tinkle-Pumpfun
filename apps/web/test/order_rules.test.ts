import assert from "node:assert/strict";
import test from "node:test";

import { computeOrderExpiresAt, computeReleaseAt } from "../src/orders/rules";

test("订单过期时间取 now+ttl 与 sale_end_at 的最小值", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");
  const saleEndAt = new Date("2026-02-01T00:05:00.000Z");
  const expiresAt = computeOrderExpiresAt({
    now,
    saleEndAt,
    ttlSeconds: 600,
  });
  assert.equal(expiresAt.toISOString(), "2026-02-01T00:05:00.000Z");
});

test("释放时间 = 过期时间 + grace", () => {
  const expiresAt = new Date("2026-02-01T00:05:00.000Z");
  const releaseAt = computeReleaseAt({ expiresAt, graceSeconds: 120 });
  assert.equal(releaseAt.toISOString(), "2026-02-01T00:07:00.000Z");
});
