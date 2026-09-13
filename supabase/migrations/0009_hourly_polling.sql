-- The cron only polling 2x/day meant a business set to "cada 6h" in the
-- settings panel could never actually sync every 6h — it was capped at
-- whatever the two fixed daily windows allowed. Polling hourly lets each
-- business's own update_frequency_hours (checked inside sync-businesses)
-- actually be honored.
select cron.unschedule('sync-businesses-6am-6pm');

select cron.schedule(
  'sync-businesses-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync-businesses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
