-- Phase 3.1: private client links + business push subscriptions + sensitive-column lockdown.
--
-- A client (a business owner, no login) opens /c/<token>. The token is 256 random bits;
-- only its SHA-256 is stored here, so a database leak does not leak working links.
-- Everything in this file is reached through Edge Functions (service_role).
--
-- This migration deliberately does NOT touch notifications / the Notification Engine:
-- business-audience notifications arrive in 3.2.

-- ---------------------------------------------------------------------------
-- business_access_links
-- No expiry by default (expires_at stays null): a link is valid until it is
-- revoked or regenerated. expires_at exists so an expiry policy can be added later.
-- ---------------------------------------------------------------------------
create table business_access_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  token_hash text not null,
  -- First characters of the token, only so the admin can tell links apart. Not usable as a token.
  token_prefix text not null,
  label text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  -- Rate limit for the client "send test" button.
  last_test_at timestamptz,
  -- Set on the OLD link when it is regenerated.
  replaced_by uuid references business_access_links (id) on delete set null,
  constraint business_access_links_token_hash_key unique (token_hash),
  constraint business_access_links_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create index business_access_links_business_idx on business_access_links (business_id) where revoked_at is null;

alter table business_access_links enable row level security;
revoke all on business_access_links from anon, authenticated;

-- ---------------------------------------------------------------------------
-- push_subscriptions.link_id: which link authorised this device.
-- The audience/business_id shape check already exists (0020); this adds the link.
-- ---------------------------------------------------------------------------
alter table push_subscriptions
  add column link_id uuid references business_access_links (id) on delete cascade;

alter table push_subscriptions
  add constraint push_subscriptions_business_link check (
    audience <> 'business' or (link_id is not null and user_id is null)
  ),
  add constraint push_subscriptions_admin_no_link check (
    audience <> 'admin' or link_id is null
  );

create index push_subscriptions_business_idx on push_subscriptions (business_id)
  where audience = 'business' and enabled;
create index push_subscriptions_link_idx on push_subscriptions (link_id);

-- ---------------------------------------------------------------------------
-- revoke_access_link: in ONE transaction, kills the link and switches off every
-- device it had authorised. Idempotent. Returns false if the link doesn't exist.
-- ---------------------------------------------------------------------------
create function revoke_access_link(p_link_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update business_access_links
  set revoked_at = coalesce(revoked_at, now())
  where id = p_link_id
  returning id into v_id;

  if v_id is null then
    return false;
  end if;

  update push_subscriptions
  set enabled = false, updated_at = now()
  where link_id = p_link_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_access_link: new link for the same business (same label) + the old
-- one is revoked (and its devices switched off), atomically. Returns the new id,
-- or null if the old link doesn't exist.
-- ---------------------------------------------------------------------------
create function regenerate_access_link(
  p_link_id uuid,
  p_token_hash text,
  p_token_prefix text,
  p_created_by uuid
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_label text;
  v_new uuid;
begin
  select business_id, label into v_business, v_label
  from business_access_links
  where id = p_link_id
  for update;

  if not found then
    return null;
  end if;

  insert into business_access_links (business_id, token_hash, token_prefix, label, created_by)
  values (v_business, p_token_hash, p_token_prefix, v_label, p_created_by)
  returning id into v_new;

  perform revoke_access_link(p_link_id);

  update business_access_links set replaced_by = v_new where id = p_link_id;

  return v_new;
end;
$$;

revoke execute on function revoke_access_link(uuid) from public, anon, authenticated;
revoke execute on function regenerate_access_link(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function revoke_access_link(uuid) to service_role;
grant execute on function regenerate_access_link(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Sensitive columns of businesses stop being publicly readable.
--
-- Until now anon could read every column of every business (RLS policy
-- "businesses select (public)" is using(true) and the table-level SELECT grant
-- covered all columns), including internal notes, the owner's phone, billing day
-- and the last sync error. Clients now get private links, so one client must not
-- be able to read another's data through the public API.
--
-- Column-level grant: anon keeps an explicit allow-list. Columns added in the
-- future are NOT readable by anon until they are added here on purpose.
-- authenticated (the admin session) keeps full SELECT — no change for the admin.
-- The Edge Functions use service_role and are unaffected.
--
-- Hidden from anon: phone, notes, billing_day, last_sync_error,
-- update_frequency_hours, low_usage_days, last_negative_review_at.
-- ---------------------------------------------------------------------------
revoke select on businesses from anon;

grant select (
  id, maps_url, name, photo_url, category,
  initial_reviews, current_reviews, initial_rating, current_rating,
  started_at, stopped_at, status,
  last_synced_at, last_growth_at,
  monthly_goal, deleted_at, created_at, updated_at
) on businesses to anon;
