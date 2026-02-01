import assert from "node:assert/strict";
import test from "node:test";

import { extractMemo } from "../src/solana/txParse";
import { encodeBase58 } from "../src/utils/base58";

test("解析 Memo 指令内容", () => {
  const memo = "order_123";
  const accountKeys = ["payer", "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"];
  const data = encodeBase58(new TextEncoder().encode(memo));

  const result = extractMemo({
    accountKeys,
    instructions: [{ programIdIndex: 1, data }],
  });

  assert.equal(result, memo);
});
