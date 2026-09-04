import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const claimSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{48}$/i),
  profileId: z.string().uuid(),
  email: z.string().email(),
});

export const claimSellerReferralAfterSignup = createServerFn({ method: "POST" })
  .validator((data: unknown) => claimSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claimed, error } = await supabaseAdmin.rpc(
      "claim_sdr_referral_invite" as any,
      {
        p_token: data.token,
        p_profile_id: data.profileId,
        p_email: data.email.toLowerCase().trim(),
      },
    );
    if (error) return { ok: false as const };
    return { ok: Boolean(claimed) };
  });
