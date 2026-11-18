// No look-alike characters (0/o, 1/l/i), since the password is read out or retyped.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A random 12-character password for handing to a person who must replace it. */
export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}
