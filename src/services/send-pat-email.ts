import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { Env } from "../lib/env.js";

export interface PatEmailInput {
  to: string;
  pat: string;
  isRenewal: boolean;
}

export function createSmtpTransport(env: Env): Transporter {
  const auth =
    env.SMTP_USER && env.SMTP_PASS
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined;

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth,
  });
}

export function buildPatEmail(input: { pat: string; isRenewal: boolean }) {
  const subject = input.isRenewal
    ? "Your new Mainfranken IT-Events agent token"
    : "Your Mainfranken IT-Events agent token";

  const text = [
    "Hello,",
    "",
    "Use this personal access token so your AI agent can save events and confirm attendance:",
    "",
    input.pat,
    "",
    "Add it to your MCP server config:",
    `  Authorization: Bearer ${input.pat}`,
    "",
    input.isRenewal
      ? "Your previous token has been revoked."
      : "Keep this token private. Anyone with it can act as you.",
    "",
    "— Mainfranken IT-Events",
  ].join("\n");

  return { subject, text };
}

export async function sendPatEmail(
  transport: Transporter,
  env: Env,
  input: PatEmailInput,
): Promise<void> {
  const { subject, text } = buildPatEmail({
    pat: input.pat,
    isRenewal: input.isRenewal,
  });

  await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject,
    text,
  });
}
