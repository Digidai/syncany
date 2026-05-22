/**
 * Local mirror of @raltic/auth-core's decryptToken. Duplicated here
 * to keep the agent package's type-resolution graph from pulling in
 * better-auth + drizzle from auth-core (transitive types fail in
 * agent's stricter tsconfig). Format is the contract:
 *   base64( iv (12 bytes) || ciphertext || authTag (16 bytes inline) )
 * Encrypted with AES-GCM under a 32-byte key encoded as base64.
 */
const IV_BYTES = 12;

function base64Decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function decryptConnectorToken(blob: string, kekBase64: string): Promise<string> {
  const raw = base64Decode(kekBase64);
  if (raw.byteLength !== 32) {
    throw new Error(`CONNECTOR_TOKEN_KEY must be 32 bytes, got ${raw.byteLength}`);
  }
  const key = await crypto.subtle.importKey(
    "raw", raw as unknown as ArrayBuffer, { name: "AES-GCM" }, false, ["decrypt"],
  );
  const all = base64Decode(blob);
  if (all.byteLength < IV_BYTES + 16) throw new Error("ciphertext too short");
  const iv = all.subarray(0, IV_BYTES);
  const ct = all.subarray(IV_BYTES);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    ct as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(pt);
}
