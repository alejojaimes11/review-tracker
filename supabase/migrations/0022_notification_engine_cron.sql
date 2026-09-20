-- Runs the Notification Engine on its own schedule, independent of sync-businesses:
-- a problem in either one can never affect the other. Every 15 minutes it turns
-- pending events into notifications, sends the ones that are due (silent hours
-- hold the rest back) and retries transient failures.
--
-- Same pattern as the sync cron (0014): the service role key comes from Vault.
select cron.schedule(
  'notification-engine-every-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/notification-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
