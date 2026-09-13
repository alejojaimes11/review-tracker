create policy "business-photos read"
on storage.objects for select
using (bucket_id = 'business-photos');

create policy "business-photos insert"
on storage.objects for insert
with check (bucket_id = 'business-photos');

create policy "business-photos update"
on storage.objects for update
using (bucket_id = 'business-photos');
