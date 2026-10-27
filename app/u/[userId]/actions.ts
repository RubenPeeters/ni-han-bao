"use server";

import { loadChampions } from "@/lib/champion-icons";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Profile visibility on /settings; the database writes the caller's row only. */
export async function setVisibility(formData: FormData) {
  const supabase = await createClient();
  // The table's check constraint rejects anything but the three values.
  const { error } = await supabase.rpc("set_profile_visibility", { v: String(formData.get("visibility")) });
  if (error) throw new Error(`set_profile_visibility failed: ${error.message}`);
  revalidatePath("/u/[userId]", "page");
  revalidatePath("/settings");
}

/** Favourite champion on /settings: a Data Dragon id, or empty to clear it. */
export async function setFavouriteChampion(formData: FormData) {
  const id = String(formData.get("champion") ?? "");
  if (id && !(await loadChampions()).some((c) => c.id === id)) throw new Error(`unknown champion: ${id}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_favourite_champion", { p_champion: id || null });
  if (error) throw new Error(`set_favourite_champion failed: ${error.message}`);
  revalidatePath("/u/[userId]", "page");
  revalidatePath("/settings");
}

/** "I lend cards" and its default on /settings; the database writes the caller's row only. */
export async function setLending(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_card_lending", {
    p_lends: formData.get("lends") === "on",
    p_lend_all: formData.get("default") === "all",
  });
  if (error) throw new Error(`set_card_lending failed: ${error.message}`);
  revalidatePath("/u/[userId]/collection", "page");
  revalidatePath("/collection");
  revalidatePath("/settings");
}

/** Languages I accept when borrowing, on /settings; the database rejects none or an unknown one. */
export async function setBorrowLanguages(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_borrow_languages", { p_languages: formData.getAll("languages").map(String) });
  if (error) throw new Error(`set_borrow_languages failed: ${error.message}`);
  revalidatePath("/cards/[cardId]", "page");
  revalidatePath("/decks/[deckId]", "page");
  revalidatePath("/settings");
}

/** Show my collection activity in the feed, on /settings; off hides past items too, home_feed() reads it live. */
export async function setFeedCollection(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_feed_collection", { p_on: formData.get("feed") === "on" });
  if (error) throw new Error(`set_feed_collection failed: ${error.message}`);
  revalidatePath("/");
  revalidatePath("/settings");
}

/** The once-asked question of how decks count on the wishlist; preset on new decks. */
export async function setWishlistMode(formData: FormData) {
  const supabase = await createClient();
  // The column's check constraint rejects anything but the three modes.
  const { error } = await supabase.rpc("set_wishlist_mode", { p_mode: String(formData.get("mode")) });
  if (error) throw new Error(`set_wishlist_mode failed: ${error.message}`);
  revalidatePath("/decks");
  revalidatePath("/u/[userId]/wishlist", "page");
  revalidatePath("/wishlist");
  revalidatePath("/settings");
}

/** Confirm or Dispute on the Loans tab, for loans recorded on the site; the database takes the borrower's answer only. */
export async function answerLoan(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_my_riftbound_loan", {
    p_loan: Number(formData.get("loan")),
    p_kind: formData.get("kind") === "disputed" ? "disputed" : "confirmed",
    p_note: String(formData.get("note") ?? "").trim().slice(0, 300) || null,
  });
  if (error) throw new Error(`answer_my_riftbound_loan failed: ${error.message}`);
  revalidatePath("/u/[userId]/loans", "page");
  revalidatePath("/loans");
}
