"use server";

import { FEEDBACK_FAILED, feedbackRequest, feedbackThanks, sendFeedback } from "@/bot/src/feedback";
import { createClient } from "@/lib/supabase/server";

export type FeedbackState = { sent: boolean; message: string } | null;

/** The feedback form: to forge's intake from here, so the token never reaches the browser. */
export async function sendSiteFeedback(_: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return { sent: false, message: "Log in to send feedback." };
  const forgeUrl = process.env.FORGE_URL;
  const token = process.env.FORGE_INTAKE_TOKEN;
  if (!forgeUrl || !token) return { sent: false, message: "Feedback is not set up on this site." };
  const me = await supabase.rpc("current_discord_id");
  const meta = claims.claims.user_metadata ?? {};
  // Only a path on this site: the field is caller input.
  const from = String(formData.get("from") ?? "");
  const request = feedbackRequest({
    kind: String(formData.get("kind") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    submitter: { name: meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? "Discord user", id: me.data ?? meta.provider_id ?? "unknown" },
    context: { page: from.startsWith("/") && !from.startsWith("//") ? from.slice(0, 300) : null },
  });
  if (typeof request === "string") return { sent: false, message: request };
  try {
    return { sent: true, message: feedbackThanks(await sendFeedback(forgeUrl, token, request)) };
  } catch (err) {
    console.error("feedback failed:", err instanceof Error ? err.message : err);
    return { sent: false, message: FEEDBACK_FAILED };
  }
}
