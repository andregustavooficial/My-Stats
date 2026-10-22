-- Rode no SQL Editor do Supabase: aba Recompensas (saques, print de domingo e limite de saque).

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null default current_date,
  amount_usd numeric(12,2) not null,
  rate_brl numeric(10,4) not null,
  created_at timestamptz not null default now()
);

-- Um registro por print de "Upcoming rewards"
create table if not exists public.reward_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  taken_at timestamptz not null default now(),
  available_usd numeric(12,2),
  upcoming_usd numeric(12,2),
  week_start date,
  week_diamonds integer,
  weekly_pct numeric(5,2),
  league text,
  league_days integer,
  valid_days_done boolean,
  fans_done boolean
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  daily_limit_usd numeric(12,2) not null default 5000
);

do $$
declare t text;
begin
  foreach t in array array['withdrawals','reward_snapshots','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner" on public.%I', t);
    execute format(
      'create policy "owner" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
