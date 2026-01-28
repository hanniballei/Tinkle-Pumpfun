import { Pool } from "pg";

import { requireEnv } from "../env";

type PoolHolder = {
  __dbPool?: Pool;
};

const globalForPool = globalThis as PoolHolder;

export function getPool(): Pool {
  if (!globalForPool.__dbPool) {
    globalForPool.__dbPool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
    });
  }
  return globalForPool.__dbPool;
}
