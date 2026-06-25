import * as z from "zod";

const optionalBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === "true"));

export const searchEventsQuerySchema = z.object({
  query: z.string().min(1).optional(),
  date_from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  date_to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  city: z.string().min(1).optional(),
  tags: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    ),
  is_free: optionalBoolean,
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? 20 : Number(v)))
    .pipe(z.number().int().min(1).max(50)),
});

export const eventIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const PUBLIC_EVENT_COLUMNS =
  "id,title,description,starts_at,ends_at,location_name,city,address,url,organizer,tags,is_free,price" as const;
