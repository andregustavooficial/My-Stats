-- Rode no SQL Editor do Supabase: meta de diamantes do mês e forma do saque (Payoneer ou Pix, banco).

create table if not exists public.goals (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month text not null,              -- '2026-10'
  diamonds bigint not null,
  primary key (user_id, month)
);

alter table public.goals enable row level security;
drop policy if exists "owner" on public.goals;
create policy "owner" on public.goals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.withdrawals add column if not exists method text not null default 'payoneer';
alter table public.withdrawals add column if not exists bank text not null default 'inter';
