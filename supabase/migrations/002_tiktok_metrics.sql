-- Rode no SQL Editor do Supabase: campos dos prints do TikTok e saques em dólar.
alter table public.lives
  add column if not exists title text,
  add column if not exists rewards_usd numeric(12,2),
  add column if not exists views integer,
  add column if not exists unique_viewers integer,
  add column if not exists active_viewers integer,
  add column if not exists avg_watch_sec integer,
  add column if not exists gifters integer,
  add column if not exists comments integer,
  add column if not exists shares integer,
  add column if not exists likes integer;

alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('entrada','saida','saque'));
