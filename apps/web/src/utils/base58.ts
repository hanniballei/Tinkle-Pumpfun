const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = ALPHABET.length;
const ALPHABET_MAP = new Map<string, number>(
  ALPHABET.split("").map((char, index) => [char, index]),
);

export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array();

  const bytes: number[] = [0];
  for (const char of input) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) return null;

    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * BASE;
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

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % BASE;
      carry = (carry / BASE) | 0;
    }
    while (carry > 0) {
      digits.push(carry % BASE);
      carry = (carry / BASE) | 0;
    }
  }

  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros += 1;
    else break;
  }

  let result = "";
  for (let i = 0; i < leadingZeros; i += 1) {
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    result += ALPHABET[digits[i]];
  }
  return result;
}
