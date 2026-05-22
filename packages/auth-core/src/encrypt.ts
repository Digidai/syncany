/**
 * Envelope encryption for stored credentials (e.g. user_connectors.encrypted_token).
 *
 * Design:
 *   - KEK (key-encryption-key) is a Worker secret: `CONNECTOR_TOKEN_KEY`
 *   - It's a base64-encoded 32-byte (256-bit) key — rotate via:
 *       openssl rand -base64 32 | npx wrangler secret put CONNECTOR_TOKEN_KEY
 *   - Per-record we use AES-GCM with a freshly generated 96-bit IV.
 *   - Stored blob format: base64( iv (12) || ciphertext || authTag (16 inline) )
 *     i.e. WebCrypto's encrypt() returns ciphertext||tag concatenated,
 *     we prepend the IV for self-contained decrypt.
 *
 * Threat model addressed:
 *   - D1 dump leak → ciphertext is useless without the Worker secret.
 *   - In-process memory read → not addressed (live keys exist briefly).
 *
 * Key rotation is NOT yet implemented (re-encrypting old rows on KEK
 * change). v1 assumes the same KEK for the project lifetime; a future
 * helper can decrypt-old-encrypt-new in a cron pass.
 */

const ALG = "AES-GCM";
const IV_BYTES = 12;

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64Decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importKey(rawBase64: string): Promise<CryptoKey> {
  const raw = base64Decode(rawBase64);
  if (raw.byteLength !== 32) {
    throw new Error(
      `CONNECTOR_TOKEN_KEY must be 32 bytes (256-bit, base64-encoded). Got ${raw.byteLength}.`,
    );
  }
  return crypto.subtle.importKey("raw", raw as unknown as ArrayBuffer, { name: ALG }, false, [
    "encrypt", "decrypt",
  ]);
}

/** Encrypt a UTF-8 plaintext under the Worker's connector KEK. */
export async function encryptToken(plaintext: string, kekBase64: string): Promise<string> {
  if (!plaintext) throw new Error("encryptToken: empty plaintext");
  const key = await importKey(kekBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const pt = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALG, iv: iv as unknown as ArrayBuffer }, key, pt as unknown as ArrayBuffer),
  );
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(ct, iv.byteLength);
  return base64Encode(combined);
}

/** Decrypt a blob produced by encryptToken. */
export async function decryptToken(blob: string, kekBase64: string): Promise<string> {
  const all = base64Decode(blob);
  if (all.byteLength < IV_BYTES + 16) {
    throw new Error("decryptToken: ciphertext too short");
  }
  const iv = all.subarray(0, IV_BYTES);
  const ct = all.subarray(IV_BYTES);
  const key = await importKey(kekBase64);
  const ptBuf = await crypto.subtle.decrypt(
    { name: ALG, iv: iv as unknown as ArrayBuffer },
    key,
    ct as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(ptBuf);
}

/** Generate a fresh 256-bit KEK as base64. Use offline for secret rotation. */
export function generateKekBase64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return base64Encode(raw);
}
