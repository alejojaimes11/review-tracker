create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- One-time setup after deploying (run in the SQL editor, not committed with real secrets):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- sync-businesses itself checks each business's own update_frequency_hours,
-- so running this hourly is just the polling cadence, not the actual sync frequency.
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
    body := '{}'::jsonb
  );
  $$
);
