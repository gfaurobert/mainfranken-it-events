import * as z from "zod";

export const registerEmailSchema = z.object({
  email: z.string().email(),
});

export const rsvpStatusSchema = z.enum(["interested", "going"]);
