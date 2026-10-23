-- Rode no SQL Editor do Supabase: resumo do mês (Key metrics e Viewer insights do período inteiro).

create table if not exists public.month_summaries (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month text not null,              -- '2026-09'
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.month_summaries enable row level security;
drop policy if exists "owner" on public.month_summaries;
create policy "owner" on public.month_summaries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
