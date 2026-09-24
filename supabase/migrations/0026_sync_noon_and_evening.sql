-- Automatic sync at exactly two fixed times a day: 12:00 and 18:00 Colombia
-- (UTC-5, no DST) = 17:00 and 23:00 UTC.
--
-- Why the old schedule was replaced: "cron every 6h + a due check" never gave a
-- 6h business real 6h updates. A sync is stamped a few minutes AFTER the cron
-- fires (e.g. 18:05), so at the next run only 5h55m have passed, not 6, and the
-- business was skipped — in practice 6h businesses updated every 12h, and 12h
-- ones every 24h.
--
-- The cron now sends {"force": true}: every active business is refreshed at
-- each of the two runs, independent of update_frequency_hours (that setting no
-- longer affects the automatic runs). sync-businesses is unchanged; `force` is
-- read after its backend-only guard, so it cannot be used to bypass it.
select cron.unschedule('sync-businesses-every-6h');

select cron.schedule(
  'sync-businesses-noon-and-evening',
  '0 17,23 * * *',
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
    body := '{"force": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
