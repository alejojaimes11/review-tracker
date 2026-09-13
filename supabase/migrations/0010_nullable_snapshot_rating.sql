-- A business with 0 reviews has no rating average on Google — Apify returns
-- null in that case, which was violating the not-null constraint here and
-- silently breaking sync-businesses for any business with zero reviews.
alter table review_snapshots alter column rating drop not null;
