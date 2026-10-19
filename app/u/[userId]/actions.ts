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

/** The lending form on your own Collection tab; the database writes the caller's row only. */
export async function setLending(formData: FormData) {
  const supabase = await createClient();
  const choice = formData.get("default");
  // No choice: the default picked before stays. The table's check constraint rejects anything else.
  const { error } = await supabase.rpc("riftbound_set_lending", {
    lends: formData.get("lends") === "on",
    lend_default: choice ? String(choice) : null,
  });
  if (error) throw new Error(`riftbound_set_lending failed: ${error.message}`);
  revalidatePath("/u/[userId]/collection", "page");
}
