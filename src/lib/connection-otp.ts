import { createHash, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export function generateConnectionOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function connectionOtpLookup(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function hashConnectionOtp(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyConnectionOtp(code: string, codeHash: string): Promise<boolean> {
  return bcrypt.compare(code, codeHash);
}
