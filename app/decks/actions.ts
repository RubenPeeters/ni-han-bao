"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/** New deck on /decks: an empty, private deck of the caller's, opened in the editor. */
export async function createDeck(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_riftbound_deck", {
    p_deck: null,
    p_name: String(formData.get("name") ?? "").trim().slice(0, 100) || "New deck",
    p_legend: null,
    p_champion: null,
    p_notes: "",
    p_visibility: "private",
    p_language: "en",
    p_allow_other_languages: true,
    p_entries: [],
  });
  if (error) throw new Error(`save_riftbound_deck failed: ${error.message}`);
  redirect(`/decks/${data}`);
}
