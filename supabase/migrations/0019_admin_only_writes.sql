-- Only the owner (a single Supabase Auth user) can edit; visitors keep read access.
-- Visitors can still add a business and run an analysis: both go through Edge
-- Functions (service_role), which this migration does not touch.
-- The check is on the user's id, not just "is logged in", so it still holds
-- even if someone registers another account.

drop policy if exists "businesses update (scoped columns)" on businesses;
revoke update on businesses from anon, authenticated;

create policy "businesses update (owner only)" on businesses
  for update
  to authenticated
  using (auth.uid() = '24716ed6-3250-4fee-b80f-5c3e8dfcc8d8'::uuid)
  with check (auth.uid() = '24716ed6-3250-4fee-b80f-5c3e8dfcc8d8'::uuid);

grant update (
  status, stopped_at, deleted_at,
  initial_reviews, initial_rating, started_at,
  update_frequency_hours, billing_day, category, low_usage_days,
  monthly_goal, notes, phone, photo_url
) on businesses to authenticated;

-- Photos: only the owner uploads or replaces them.
drop policy if exists "business-photos insert" on storage.objects;
drop policy if exists "business-photos update" on storage.objects;

create policy "business-photos insert (owner only)" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-photos' and auth.uid() = '24716ed6-3250-4fee-b80f-5c3e8dfcc8d8'::uuid);

create policy "business-photos update (owner only)" on storage.objects
  for update to authenticated
  using (bucket_id = 'business-photos' and auth.uid() = '24716ed6-3250-4fee-b80f-5c3e8dfcc8d8'::uuid);
