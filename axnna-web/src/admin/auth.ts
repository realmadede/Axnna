const COOKIE_NAME = 'axnna_admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  iat: number;
  exp: number;
  nonce: string;
  ver: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(digest);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Compares two secret strings in constant time using SHA-256 digests. */
export async function constantTimeSecretMatch(submitted: string, expected?: string): Promise<boolean> {
  if (!expected || !submitted) return false;
  const [a, b] = await Promise.all([sha256(submitted), sha256(expected)]);
  return constantTimeEqual(a, b);
}

/** Verifies the submitted passphrase in constant time using SHA-256 digests. */
export async function verifyPassphrase(submitted: string, expected?: string): Promise<boolean> {
  return constantTimeSecretMatch(submitted, expected);
}

/** Issues an HMAC-SHA256 signed session token valid for 12 hours. */
export async function createSessionToken(secret: string, version: string = '1'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID(),
    ver: version,
  };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Verifies an HMAC-SHA256 session token, its expiration, and version claim. */
export async function verifySessionToken(
  token: string,
  secret: string,
  expectedVersion?: string
): Promise<{ valid: boolean; payload?: SessionPayload }> {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return { valid: false };

  const encodedPayload = token.slice(0, dotIdx);
  const encodedSig = token.slice(dotIdx + 1);
  const sigBytes = fromBase64Url(encodedSig);
  const payloadBytes = fromBase64Url(encodedPayload);
  if (!sigBytes || !payloadBytes) return { valid: false };

  const key = await getHmacKey(secret);
  const validSig = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(encodedPayload)
  );
  if (!validSig) return { valid: false };

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now || typeof payload.nonce !== 'string') {
      return { valid: false };
    }
    if (expectedVersion && payload.ver !== expectedVersion) {
      return { valid: false };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export function extractSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function buildSessionCookie(token: string, isHttps: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildClearSessionCookie(isHttps: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isHttps) attrs.push('Secure');
  return attrs.join('; ');
}
