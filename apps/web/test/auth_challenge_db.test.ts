import assert from "node:assert/strict";
import test from "node:test";

import { withClient } from "../src/db/tx";

const hasDatabase = Boolean(process.env.DATABASE_URL);

if (!hasDatabase) {
  test("auth_challenges 数据库测试（缺少 DATABASE_URL，跳过）", { skip: true }, () => {});
} else {
  test("auth_challenges 可写入并标记消费", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const nonce = `test_${Date.now()}`;
        const wallet = "test_wallet";
        const message = "test_message";
        const expiresAt = new Date(Date.now() + 60_000);

        await client.query(
          `
            INSERT INTO auth_challenges (nonce, wallet, message, expires_at)
            VALUES ($1, $2, $3, $4);
          `,
          [nonce, wallet, message, expiresAt],
        );

        const found = await client.query(
          `
            SELECT nonce, wallet, consumed_at
            FROM auth_challenges
            WHERE nonce = $1;
          `,
          [nonce],
        );
        assert.equal(found.rowCount, 1);
        assert.equal(found.rows[0].wallet, wallet);
        assert.equal(found.rows[0].consumed_at, null);

        const firstUpdate = await client.query(
          `
            UPDATE auth_challenges
            SET consumed_at = NOW()
            WHERE nonce = $1 AND consumed_at IS NULL;
          `,
          [nonce],
        );
        assert.equal(firstUpdate.rowCount, 1);

        const secondUpdate = await client.query(
          `
            UPDATE auth_challenges
            SET consumed_at = NOW()
            WHERE nonce = $1 AND consumed_at IS NULL;
          `,
          [nonce],
        );
        assert.equal(secondUpdate.rowCount, 0);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
}
