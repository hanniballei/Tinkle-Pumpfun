import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDraftExpiresAt,
  computeDrawExecuteAt,
  computeSaleEndAt,
  isPumpFunMint,
} from "../src/raffles/rules";

test("pump.fun mint 后四位校验", () => {
  assert.equal(isPumpFunMint("abcdpump"), true);
  assert.equal(isPumpFunMint("abcdPUMP"), false);
  assert.equal(isPumpFunMint("abcd"), false);
});

test("派生时间计算符合约束", () => {
  const drawAt = new Date("2026-01-27T12:00:00.000Z");
  const saleEndAt = computeSaleEndAt(drawAt);
  const drawExecuteAt = computeDrawExecuteAt(drawAt);
  assert.equal(saleEndAt.toISOString(), "2026-01-27T11:58:00.000Z");
  assert.equal(drawExecuteAt.toISOString(), "2026-01-27T12:01:00.000Z");
});

test("DRAFT 过期时间取最小值", () => {
  const now = new Date("2026-01-27T00:00:00.000Z");
  const saleEndAt = new Date("2026-01-27T00:05:00.000Z");
  const expires = computeDraftExpiresAt({
    now,
    saleEndAt,
    ttlSeconds: 600,
  });
  assert.equal(expires.toISOString(), "2026-01-27T00:05:00.000Z");
});
