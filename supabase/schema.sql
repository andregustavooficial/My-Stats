-- My Stats: rode este arquivo inteiro no Supabase em SQL Editor -> New query -> Run.
-- Cada tabela só pode ser lida e alterada pelo usuário logado que criou a linha (RLS).

create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null default current_date,
  duration_min integer,
  peak_viewers integer,
  avg_viewers integer,
  new_followers integer,
  diamonds integer,
  earnings numeric(12,2),
  title text,
  rewards_usd numeric(12,2),
  views integer,
  unique_viewers integer,
  active_viewers integer,
  avg_watch_sec integer,
  gifters integer,
  comments integer,
  shares integer,
  likes integer,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null default current_date,
  description text not null,
  amount numeric(12,2) not null,
  kind text not null default 'entrada' check (kind in ('entrada','saida','saque')),
  status text not null default 'pendente' check (status in ('pendente','pago')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.video_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  status text not null default 'ideia' check (status in ('ideia','roteiro','gravado','postado')),
  due_date date,
  idea text,
  plan text,
  created_at timestamptz not null default now()
);

create table if not exists public.live_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  scheduled_at timestamptz not null,
  theme text not null,
  status text not null default 'planejada' check (status in ('planejada','feita','cancelada')),
  goal text,
  checklist text,
  notes text,
  created_at timestamptz not null default now()
);

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
  foreach t in array array['lives','payments','video_plans','live_plans','withdrawals','reward_snapshots','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner" on public.%I', t);
    execute format(
      'create policy "owner" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
