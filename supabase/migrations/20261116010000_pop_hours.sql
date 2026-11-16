-- Paid helpers (Martha) and the hours they log. Service role only, via the pop-shifts Edge Function.

create table public.pop_helpers (
  id           uuid primary key default gen_random_uuid(),
  household_id text not null default 'pop',
  name         text not null check (char_length(name) between 1 and 60),
  hourly_rate  numeric(8,2) not null default 0 check (hourly_rate >= 0),
  created_at   timestamptz not null default now(),
  unique (household_id, name)
);

create table public.pop_hours (
  id           uuid primary key default gen_random_uuid(),
  household_id text not null default 'pop',
  helper_id    uuid not null references public.pop_helpers(id) on delete cascade,
  work_date    date not null,
  start_time   time not null,
  end_time     time not null,
  minutes      integer not null check (minutes between 1 and 1440),
  note         text not null default '' check (char_length(note) <= 200),
  paid         boolean not null default false,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index pop_hours_household_helper_date_idx on public.pop_hours (household_id, helper_id, work_date);

alter table public.pop_helpers enable row level security;
alter table public.pop_hours   enable row level security;

-- No policies on purpose. Revoke the default grants anon/authenticated get on new public tables.
revoke all on public.pop_helpers from anon, authenticated;
revoke all on public.pop_hours   from anon, authenticated;

insert into public.pop_helpers (household_id, name, hourly_rate) values ('pop', 'Martha', 0);
