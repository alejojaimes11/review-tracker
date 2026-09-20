-- Web Push, phase 1: admin devices only.
--
-- admin_users replaces "one hardcoded UUID" as the source of truth for who is
-- an admin. Edge Functions check it server-side (service_role). Existing RLS
-- policies from 0019 still use the literal UUID and can move to this table
-- later without touching anything here.
--
-- push_subscriptions holds browser push endpoints + keys. Anyone holding an
-- endpoint can send that device notifications, so anon/authenticated get no
-- access at all — every read and write goes through Edge Functions.

create table admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table admin_users enable row level security;
revoke all on admin_users from anon, authenticated;

insert into admin_users (user_id)
values ('24716ed6-3250-4fee-b80f-5c3e8dfcc8d8');

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Set for admin devices. Null for business devices (added in a later phase,
  -- which will identify them by business_id instead of a login).
  user_id uuid references auth.users (id) on delete cascade,
  audience text not null check (audience in ('admin', 'business')),
  business_id uuid references businesses (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  enabled boolean not null default true,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_audience_shape check (
    (audience = 'admin' and business_id is null and user_id is not null)
    or (audience = 'business' and business_id is not null)
  )
);

create index push_subscriptions_audience_idx on push_subscriptions (audience, enabled);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;
