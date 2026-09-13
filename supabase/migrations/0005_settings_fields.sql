alter table businesses
  add column photo_url text,
  add column billing_day smallint check (billing_day is null or billing_day between 1 and 31);

insert into storage.buckets (id, name, public)
values ('business-photos', 'business-photos', true)
on conflict (id) do nothing;
