import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "./session";

export function requireUser(req: NextRequest): { wallet: string } | null {
  return getSessionFromRequest(req);
}
