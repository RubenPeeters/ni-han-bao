-- The bot's own Discord CDN avatar, rewritten with every heartbeat so the site follows
-- avatar changes. Nullable: rows written by an older bot have none.
alter table public.bot_status add column if not exists avatar_url text;
