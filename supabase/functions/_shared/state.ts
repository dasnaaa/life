// Signierter, zustandsloser OAuth-state-Parameter (HMAC-SHA256 ueber Web
// Crypto). Vermeidet eine eigene oauth_states-Tabelle: der state traegt
// seine Gueltigkeit (Signatur + Ablaufzeit) selbst.

const encoder = new TextEncoder();

export type OAuthState = {
  user_id: string;
  account_label: string;
  platform: "web" | "native";
  nonce: string;
  exp: number;
};

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signState(payload: OAuthState, secret: string): Promise<string> {
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes));
  return `${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`;
}

export async function verifyState(state: string, secret: string): Promise<OAuthState> {
  const [payloadB64, signatureB64] = state.split(".");
  if (!payloadB64 || !signatureB64) {
    throw new Error("Malformed OAuth state");
  }

  const payloadBytes = fromBase64Url(payloadB64);
  const signatureBytes = fromBase64Url(signatureB64);
  const key = await hmacKey(secret);

  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes as BufferSource, payloadBytes as BufferSource);
  if (!valid) {
    throw new Error("Invalid OAuth state signature");
  }

  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as OAuthState;
  if (Date.now() > payload.exp) {
    throw new Error("OAuth state expired");
  }

  return payload;
}
