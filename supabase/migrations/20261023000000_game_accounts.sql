-- /lol link (#102): a Discord user's own game account, proven by a profile icon change.
-- Additive only.

-- The PUUID, not the Riot ID, which its owner can rename. Not per server (an account
-- spans them), so no guild_id. RLS on and no policies: only the bot reads or writes it,
-- and nothing shows on the website yet. Riot policy: show only what the member linked.
create table if not exists public.game_accounts (
    user_id text not null,
    game text not null,
    external_id text not null,
    region text not null,
    verified_at timestamptz not null default now(),
    primary key (user_id, game)
);

alter table public.game_accounts enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.game_accounts
    for each row execute function public.skip_forgotten();
