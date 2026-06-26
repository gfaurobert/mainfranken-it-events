import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PAT_PREFIX = "mfe_pat_";
const BCRYPT_ROUNDS = 10;

export function generatePat(): string {
  return PAT_PREFIX + randomBytes(32).toString("base64url");
}

export function patLookup(pat: string): string {
  return createHash("sha256").update(pat).digest("hex");
}

export function isPatFormat(pat: string): boolean {
  return pat.startsWith(PAT_PREFIX) && pat.length > PAT_PREFIX.length + 10;
}

export async function hashPat(pat: string): Promise<string> {
  return bcrypt.hash(pat, BCRYPT_ROUNDS);
}

export async function verifyPat(pat: string, tokenHash: string): Promise<boolean> {
  return bcrypt.compare(pat, tokenHash);
}
