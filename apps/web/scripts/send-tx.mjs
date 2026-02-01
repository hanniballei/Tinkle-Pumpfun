import fs from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map(ALPHABET.split("").map((char, index) => [char, index]));

function decodeBase58(input) {
  if (!input) return null;
  const bytes = [0];
  for (const char of input) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * ALPHABET.length;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeros = 0;
  for (const char of input) {
    if (char === "1") leadingZeros += 1;
    else break;
  }
  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    result[result.length - 1 - i] = bytes[i];
  }
  return result;
}

function readSecretKey() {
  const jsonInline = process.env.SECRET_KEY_JSON;
  const base58Inline = process.env.SECRET_KEY_BASE58;
  const keypairPath = process.env.KEYPAIR_FILE;

  if (jsonInline) {
    const parsed = JSON.parse(jsonInline);
    return Uint8Array.from(parsed);
  }

  if (base58Inline) {
    const decoded = decodeBase58(base58Inline);
    if (!decoded) throw new Error("SECRET_KEY_BASE58 无法解析");
    return decoded;
  }

  if (keypairPath) {
    const raw = fs.readFileSync(keypairPath, "utf8").trim();
    if (raw.startsWith("[")) {
      return Uint8Array.from(JSON.parse(raw));
    }
    const decoded = decodeBase58(raw);
    if (!decoded) throw new Error("KEYPAIR_FILE 内容无法解析");
    return decoded;
  }

  throw new Error("缺少私钥：请设置 KEYPAIR_FILE 或 SECRET_KEY_JSON/SECRET_KEY_BASE58");
}

async function main() {
  const txBase64 = process.env.TX_BASE64;
  const rpcUrl = process.env.RPC_URL;
  if (!txBase64) throw new Error("缺少 TX_BASE64");
  if (!rpcUrl) throw new Error("缺少 RPC_URL");

  const secret = readSecretKey();
  const keypair = Keypair.fromSecretKey(secret);
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(keypair);

  const connection = new Connection(rpcUrl, "confirmed");
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  console.log("txSignature:", signature);
}

main().catch((err) => {
  console.error("发送失败：", err.message);
  process.exit(1);
});
