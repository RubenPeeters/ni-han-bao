"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** The visibility form on your own profile; the database writes the caller's row only. */
export async function setVisibility(formData: FormData) {
  const supabase = await createClient();
  // The table's check constraint rejects anything but the three values.
  const { error } = await supabase.rpc("set_profile_visibility", { v: String(formData.get("visibility")) });
  if (error) throw new Error(`set_profile_visibility failed: ${error.message}`);
  revalidatePath("/u/[userId]", "page");
}

/** "I lend cards" and its default on your own Collection tab; the database writes the caller's row only. */
export async function setLending(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_card_lending", {
    p_lends: formData.get("lends") === "on",
    p_lend_all: formData.get("default") === "all",
  });
  if (error) throw new Error(`set_card_lending failed: ${error.message}`);
  revalidatePath("/u/[userId]/collection", "page");
}

/** The once-asked question of how decks count on the wishlist; preset on new decks. */
export async function setWishlistMode(formData: FormData) {
  const supabase = await createClient();
  // The column's check constraint rejects anything but the three modes.
  const { error } = await supabase.rpc("set_wishlist_mode", { p_mode: String(formData.get("mode")) });
  if (error) throw new Error(`set_wishlist_mode failed: ${error.message}`);
  revalidatePath("/decks");
  revalidatePath("/u/[userId]/wishlist", "page");
}
