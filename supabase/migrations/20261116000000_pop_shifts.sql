-- Pop's Shift Board: day-coverage shifts (9 AM to 9 PM) for watching Pop.
-- Locked to the service role. The pop-shifts Edge Function is the only reader/writer.

create table public.pop_shifts (
  id           uuid primary key default gen_random_uuid(),
  household_id text not null default 'pop',
  shift_date   date not null,
  start_time   time not null,
  end_time     time not null,
  name         text not null check (char_length(name) between 1 and 60),
  note         text not null default '' check (char_length(note) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pop_shifts_order check (end_time > start_time),
  constraint pop_shifts_window check (start_time >= '09:00' and end_time <= '21:00')
);

create index pop_shifts_household_date_idx on public.pop_shifts (household_id, shift_date);

alter table public.pop_shifts enable row level security;

-- No policies on purpose: anon and authenticated get nothing.
revoke all on public.pop_shifts from anon, authenticated;
