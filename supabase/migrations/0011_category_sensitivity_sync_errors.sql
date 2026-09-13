alter table businesses
  add column category text,
  add column low_usage_days smallint not null default 1 check (low_usage_days >= 1),
  add column last_sync_error text;
