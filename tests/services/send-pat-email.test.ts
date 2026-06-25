import { describe, expect, it, vi } from "vitest";
import { buildPatEmail, sendPatEmail } from "../../src/services/send-pat-email.js";
import type { Env } from "../../src/lib/env.js";

const env = {
  SMTP_HOST: "smtp.test",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_FROM: "Test <noreply@test.com>",
} as Env;

describe("sendPatEmail", () => {
  it("buildPatEmail includes pat and setup hint", () => {
    const { subject, text } = buildPatEmail({
      pat: "mfe_pat_abc",
      isRenewal: false,
    });
    expect(subject).toContain("agent token");
    expect(text).toContain("mfe_pat_abc");
    expect(text).toContain("Authorization: Bearer");
  });

  it("sendPatEmail calls transport.sendMail", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
    const transport = { sendMail } as never;

    await sendPatEmail(
      transport,
      env,
      { to: "user@example.com", pat: "mfe_pat_xyz", isRenewal: true },
    );

    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0][0].to).toBe("user@example.com");
    expect(sendMail.mock.calls[0][0].text).toContain("mfe_pat_xyz");
  });
});
