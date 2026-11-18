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

/** Compares two secret strings in constant time using SHA-256 digests. */
export async function constantTimeSecretMatch(submitted: string, expected?: string): Promise<boolean> {
  if (!expected || !submitted) return false;
  const [a, b] = await Promise.all([sha256(submitted), sha256(expected)]);
  return constantTimeEqual(a, b);
}
