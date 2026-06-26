import * as z from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().min(1),
  REGISTER_EMAIL_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

function omitUndefined(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function loadEnv(overrides?: Record<string, string | undefined>) {
  const serviceKey =
    overrides?.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;

  return envSchema.parse(
    omitUndefined({
      SUPABASE_URL: overrides?.SUPABASE_URL ?? process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      PORT: overrides?.PORT ?? process.env.PORT,
      SMTP_HOST: overrides?.SMTP_HOST ?? process.env.SMTP_HOST,
      SMTP_PORT: overrides?.SMTP_PORT ?? process.env.SMTP_PORT,
      SMTP_SECURE: overrides?.SMTP_SECURE ?? process.env.SMTP_SECURE,
      SMTP_USER: overrides?.SMTP_USER ?? process.env.SMTP_USER,
      SMTP_PASS: overrides?.SMTP_PASS ?? process.env.SMTP_PASS,
      SMTP_FROM: overrides?.SMTP_FROM ?? process.env.SMTP_FROM,
      REGISTER_EMAIL_COOLDOWN_SECONDS:
        overrides?.REGISTER_EMAIL_COOLDOWN_SECONDS ??
        process.env.REGISTER_EMAIL_COOLDOWN_SECONDS,
    }),
  );
}
