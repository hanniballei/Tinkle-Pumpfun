import assert from "node:assert/strict";
import test from "node:test";

import { computeTokenNetAmount } from "../src/solana/txParse";

test("根据 pre/post 余额计算净入账", () => {
  const accountKeys = ["vaultA", "other"];
  const preTokenBalances = [
    {
      accountIndex: 0,
      mint: "mintA",
      uiTokenAmount: { amount: "100" },
    },
  ];
  const postTokenBalances = [
    {
      accountIndex: 0,
      mint: "mintA",
      uiTokenAmount: { amount: "150" },
    },
  ];

  const delta = computeTokenNetAmount({
    accountKeys,
    preTokenBalances,
    postTokenBalances,
    vault: "vaultA",
    mint: "mintA",
  });
  assert.equal(delta, 50n);
});

test("新建账户仅有 post 余额", () => {
  const accountKeys = ["vaultA"];
  const postTokenBalances = [
    {
      accountIndex: 0,
      mint: "mintA",
      uiTokenAmount: { amount: "42" },
    },
  ];

  const delta = computeTokenNetAmount({
    accountKeys,
    preTokenBalances: [],
    postTokenBalances,
    vault: "vaultA",
    mint: "mintA",
  });
  assert.equal(delta, 42n);
});
