import { decodeBase58 } from "../utils/base58";

type TokenBalance = {
  accountIndex: number;
  mint: string;
  uiTokenAmount: {
    amount: string;
  };
};

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export function extractAccountKeys(
  accountKeys:
    | string[]
    | {
        pubkey: string;
      }[],
): string[] {
  return accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey));
}

export function extractMemo(params: {
  accountKeys: string[];
  instructions: Array<{ programIdIndex: number; data: string }>;
}): string | null {
  for (const instruction of params.instructions) {
    const programId = params.accountKeys[instruction.programIdIndex];
    if (programId !== MEMO_PROGRAM_ID) continue;
    const decoded = decodeMemoData(instruction.data);
    if (decoded === null) return null;
    return decoded;
  }
  return null;
}

function decodeMemoData(data: string): string | null {
  const decoded = decodeBase58(data);
  if (!decoded) return null;
  return new TextDecoder().decode(decoded);
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
