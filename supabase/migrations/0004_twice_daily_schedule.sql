alter table businesses alter column update_frequency_hours set default 12;
update businesses set update_frequency_hours = 12;

select cron.unschedule('sync-businesses-hourly');

select cron.schedule(
  'sync-businesses-6am-6pm',
  '0 11,23 * * *',
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
