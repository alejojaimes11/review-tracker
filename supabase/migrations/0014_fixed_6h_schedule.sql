-- User wants every business to sync at the same fixed clock times —
-- 6am, 12pm, 6pm, 12am (Colombia, UTC-5) — instead of hourly polling where
-- each business drifts to its own offset based on when it last synced.
-- Safe to do on a fixed 6h cadence because every FREQUENCY_OPTIONS value in
-- the settings panel (6/12/24/48) is a multiple of 6 — a business set to
-- 12h/24h/48h simply becomes "due" every 2nd/4th/8th run, still exactly on
-- schedule, never under-served the way the old 2x/day cron was (see
-- 0009_hourly_polling.sql).
select cron.unschedule('sync-businesses-hourly');

select cron.schedule(
  'sync-businesses-every-6h',
  '0 5,11,17,23 * * *',
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
