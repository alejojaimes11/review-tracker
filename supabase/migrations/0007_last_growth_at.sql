alter table businesses add column last_growth_at timestamptz;
update businesses set last_growth_at = started_at where last_growth_at is null;
