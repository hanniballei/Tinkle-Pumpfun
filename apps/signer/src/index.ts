import { serve } from "@hono/node-server";
import { Hono } from "hono";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量：${name}`);
  return value;
}

const signerSecret = requireEnv("SIGNER_SECRET");

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.use("/internal/*", async (c, next) => {
  const provided = c.req.header("x-signer-secret");
  if (!provided || provided !== signerSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.post("/internal/payouts/:id/sign-tx", async (c) => {
  // v0：签发服务只接收 payout_id（可选 action），所有出金参数必须从 DB 读取并二次校验。
  // M0 仅搭骨架：后续里程碑再实现真实签名逻辑。
  const payoutId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const action = body?.action === "RESIGN" ? "RESIGN" : "SIGN";
  return c.json({ error: "not_implemented", payout_id: payoutId, action }, 501);
});

const port = Number(process.env.PORT ?? "8787");
serve({ fetch: app.fetch, port });
console.log(`[signer] listening on :${port}`);
