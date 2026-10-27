-- League rank history (#301): lol_ranks is overwritten every refresh, so the bot also appends
-- a row here whenever an account's tier or division in a queue differs from its last row
-- (never for LP alone). The first refresh writes one baseline row per account and queue.
-- Additive only.

-- Not per server (an account spans them), so no guild_id. Riot policy: only Riot's official
-- tier and division, never a computed score. Deleted with its account on /lol unlink.
create table if not exists public.lol_rank_changes (
    id bigint generated always as identity primary key,
    user_id text not null,
    game text not null default 'lol' check (game = 'lol'),
    -- The account ranked: a relink to another account starts from a new baseline.
    puuid text not null,
    -- RANKED_SOLO_5x5 or RANKED_FLEX_SR.
    queue text not null,
    tier text not null,
    -- Null for Master, Grandmaster and Challenger, which have no divisions.
    division text,
    lp integer not null,
    changed_at timestamptz not null default now(),
    foreign key (user_id, game) references public.game_accounts (user_id, game) on delete cascade
);

create index if not exists lol_rank_changes_latest on public.lol_rank_changes (user_id, puuid, queue, changed_at desc);

-- RLS on and no policies, as lol_ranks: read through functions only.
alter table public.lol_rank_changes enable row level security;

-- forget_user() finds the table by its user_id column; this keeps a forgotten user out.
create trigger skip_forgotten before insert on public.lol_rank_changes
    for each row execute function public.skip_forgotten();
