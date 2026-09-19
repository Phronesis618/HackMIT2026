/** Small id helpers usable in browser and Node (no external deps). */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(prefix: string, length = 10): string {
  let body = '';
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  } else {
    for (let i = 0; i < length; i++) body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}-${body}`;
}

/** Deterministic 32-bit hash (FNV-1a) for seeds derived from text. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
