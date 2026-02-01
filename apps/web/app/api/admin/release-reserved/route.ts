import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withClient } from "@/src/db/tx";
import { requireEnv } from "@/src/env";
import { releaseExpiredOrders } from "@/src/orders/service";

export const runtime = "nodejs";

function parseLimit(input: unknown, fallback: number): number {
  if (typeof input !== "number" || !Number.isInteger(input)) return fallback;
  if (input <= 0) return fallback;
  return Math.min(input, 500);
}

function authorize(req: NextRequest): boolean {
  const provided = req.headers.get("x-cron-secret");
  const expected = requireEnv("CRON_SECRET");
  return provided === expected;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const limit = parseLimit(body?.limit, 100);

  try {
    const released = await withClient((client) =>
      releaseExpiredOrders({ client, limit }),
    );
    return NextResponse.json({ released });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
