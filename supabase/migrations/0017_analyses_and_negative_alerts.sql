-- MarketPulse block 2: persisted AI analyses (history) + negative-review alert.

-- Each click of "Analizar con IA" is now saved instead of being thrown away, so
-- the dashboard can show the latest read on load and keep a history over time.
-- Written only by the analyze-business Edge Function (service_role, bypasses
-- RLS); the browser can only read it — same model as review_snapshots.
create table analyses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  review_count smallint not null,
  provider text not null,
  bien text not null default '',
  mejorar text not null default '',
  -- [{ accion, motivo, prioridad: 'alta'|'media'|'baja', respaldo, cita }]
  acciones jsonb not null default '[]'::jsonb
);

create index analyses_business_created_idx on analyses (business_id, created_at desc);

alter table analyses enable row level security;

revoke all on analyses from anon, authenticated;
grant select on analyses to anon, authenticated;

create policy "analyses select (public)" on analyses
  for select
  to anon, authenticated
  using (true);

-- Set by sync-businesses when a genuinely new 1-2 star review shows up.
-- Read-only for the browser: the column-scoped UPDATE grant from 0016 does
-- not include it, so only service_role (the sync job) can write it.
alter table businesses add column last_negative_review_at timestamptz;
