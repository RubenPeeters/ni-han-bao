-- Progress of each server's history backfill, now run by the bot itself (#70), so the site
-- can show "Counting history: 40%" until it is done. Written by the bot after each channel;
-- read through the existing "members read" policy on backfill_state.
-- Additive only: the previous release keeps working against it.

alter table public.backfill_state
    -- Readable channels and threads in the latest run; null until a run has listed them.
    add column if not exists channels_total integer,
    add column if not exists channels_done integer not null default 0,
    -- The oldest point any channel's history has been counted back to.
    add column if not exists oldest_at timestamptz,
    -- Set once every readable channel is done; the bot backfills servers without it on start.
    add column if not exists done_at timestamptz;
