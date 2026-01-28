type TokenBalance = {
  accountIndex: number;
  mint: string;
  uiTokenAmount: {
    amount: string;
  };
};

export function extractAccountKeys(
  accountKeys:
    | string[]
    | {
        pubkey: string;
      }[],
): string[] {
  return accountKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey,
  );
}

export function computeTokenNetAmount(params: {
  accountKeys: string[];
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
  vault: string;
  mint: string;
}): bigint {
  const pre = new Map<number, bigint>();
  const post = new Map<number, bigint>();

  for (const entry of params.preTokenBalances ?? []) {
    if (entry.mint !== params.mint) continue;
    if (params.accountKeys[entry.accountIndex] !== params.vault) continue;
    pre.set(entry.accountIndex, BigInt(entry.uiTokenAmount.amount));
  }

  for (const entry of params.postTokenBalances ?? []) {
    if (entry.mint !== params.mint) continue;
    if (params.accountKeys[entry.accountIndex] !== params.vault) continue;
    post.set(entry.accountIndex, BigInt(entry.uiTokenAmount.amount));
  }

  let total = 0n;
  const indices = new Set([...pre.keys(), ...post.keys()]);
  for (const index of indices) {
    const before = pre.get(index) ?? 0n;
    const after = post.get(index) ?? 0n;
    total += after - before;
  }

  return total;
}
