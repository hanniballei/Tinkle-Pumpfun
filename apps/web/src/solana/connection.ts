import { Connection } from "@solana/web3.js";

import { requireEnv } from "../env";

type ConnectionHolder = {
  __solanaConnection?: Connection;
};

const globalForConnection = globalThis as ConnectionHolder;

export function getSolanaConnection(): Connection {
  if (!globalForConnection.__solanaConnection) {
    const endpoint = requireEnv("SOLANA_RPC_URL");
    globalForConnection.__solanaConnection = new Connection(endpoint, {
      commitment: "confirmed",
    });
  }
  return globalForConnection.__solanaConnection;
}
