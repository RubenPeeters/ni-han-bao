-- Store preview images (#261): the og:image of a store's link, found by the bot when the link
-- is saved and rechecked weekly; the site hotlinks it. Additive only: RLS and policies unchanged.
alter table public.stores add column if not exists image_url text;
alter table public.stores add column if not exists image_checked_at timestamptz;
