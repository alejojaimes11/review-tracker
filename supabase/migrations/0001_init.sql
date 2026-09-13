create table businesses (
  id                     uuid primary key default gen_random_uuid(),
  maps_url               text not null unique,
  name                   text not null,
  initial_reviews        int not null,
  current_reviews        int not null,
  initial_rating         numeric(2,1),
  current_rating         numeric(2,1),
  started_at             timestamptz not null default now(),
  stopped_at             timestamptz,
  status                 text not null default 'active'
                           check (status in ('active','stopped')),
  update_frequency_hours int not null default 24,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table review_snapshots (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  review_count  int not null,
  rating        numeric(2,1) not null,
  created_at    timestamptz not null default now()
);

create index review_snapshots_business_id_created_at_idx
  on review_snapshots (business_id, created_at desc);
