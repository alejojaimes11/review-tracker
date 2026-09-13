-- Optional monthly review goal per business, e.g. "10 reseñas este mes".
-- Nullable: null means no goal set, progress UI stays hidden for that business.
alter table businesses
  add column monthly_goal smallint check (monthly_goal is null or monthly_goal > 0);
