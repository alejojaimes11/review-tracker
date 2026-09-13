insert into storage.buckets (id, name, public)
values ('monthly-reports', 'monthly-reports', true)
on conflict (id) do nothing;

create policy "monthly-reports read"
on storage.objects for select
using (bucket_id = 'monthly-reports');

create policy "monthly-reports insert"
on storage.objects for insert
with check (bucket_id = 'monthly-reports');

create policy "monthly-reports update"
on storage.objects for update
using (bucket_id = 'monthly-reports');

select cron.schedule(
  'generate-monthly-report',
  '0 5 1 * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/generate-monthly-report',
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
