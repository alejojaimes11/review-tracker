-- Security hardening ahead of making the repo public (AI Builders Hackathon 2026).
-- Closes the "RLS disabled" critical advisory on businesses/review_snapshots/reviews
-- and drops unused public-write storage policies on monthly-reports.
--
-- Nothing here affects Edge Functions: add-business, sync-businesses,
-- analyze-business and generate-monthly-report all authenticate with
-- SUPABASE_SERVICE_ROLE_KEY, which always bypasses RLS and table grants.
-- Everything below only scopes what the anon/authenticated roles (i.e. the
-- browser, via the public anon key) can do — there is no login in this app,
-- so "authenticated" is treated exactly as untrusted as "anon" (anyone could
-- self-register against Supabase Auth's public API and obtain that role).

-- ---------------------------------------------------------------------------
-- businesses: frontend needs full SELECT (dashboard + trash + detail) and
-- UPDATE, but only on the columns its own features actually write. Columns
-- that are sync-authoritative (current_reviews, current_rating, maps_url,
-- name, last_synced_at, last_growth_at, last_sync_error, created_at,
-- updated_at, id) are excluded — those are only ever written by Edge
-- Functions via service_role, which this does not affect.
-- ---------------------------------------------------------------------------
alter table businesses enable row level security;

revoke insert, delete, truncate on businesses from anon, authenticated;
revoke update on businesses from anon, authenticated;

create policy "businesses select (public)" on businesses
  for select
  to anon, authenticated
  using (true);

create policy "businesses update (scoped columns)" on businesses
  for update
  to anon, authenticated
  using (true)
  with check (true);

grant update (
  status, stopped_at, deleted_at,
  initial_reviews, initial_rating, started_at,
  update_frequency_hours, billing_day, category, low_usage_days,
  monthly_goal, notes, phone, photo_url
) on businesses to anon, authenticated;

-- ---------------------------------------------------------------------------
-- review_snapshots: frontend only ever reads (business detail history +
-- cross-business recent snapshots for sparklines). Writes come exclusively
-- from add-business/sync-businesses via service_role.
-- ---------------------------------------------------------------------------
alter table review_snapshots enable row level security;

revoke insert, update, delete, truncate on review_snapshots from anon, authenticated;

create policy "review_snapshots select (public)" on review_snapshots
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- reviews: the frontend never queries this table directly — only
-- analyze-business (service_role) reads it. No policies for anon/authenticated
-- at all: with RLS enabled and no matching policy, access defaults to denied.
-- ---------------------------------------------------------------------------
alter table reviews enable row level security;

revoke all on reviews from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: monthly-reports only needs to be readable from the frontend
-- (list() + getPublicUrl()). The only writer is generate-monthly-report
-- (service_role, which bypasses storage RLS too) — the public insert/update
-- policies never served any real purpose.
-- business-photos is deliberately left untouched: the manual photo upload
-- feature writes directly from the browser with no auth to gate it, and
-- restricting it would either break that feature or require adding
-- authentication — out of scope for this pass.
-- ---------------------------------------------------------------------------
drop policy if exists "monthly-reports insert" on storage.objects;
drop policy if exists "monthly-reports update" on storage.objects;
