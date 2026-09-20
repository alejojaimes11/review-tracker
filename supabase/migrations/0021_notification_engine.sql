-- Notification Engine, phase 2: events -> notifications -> deliveries (admin only).
--
--   sync-businesses ──► notification_events   (facts; unique event_key)
--   notification-engine ──► notifications ──► notification_deliveries (one row per device attempt)
--
-- Every table here is written only by Edge Functions (service_role).
-- The single browser-facing surface is `notifications`, and only a user's own
-- rows, read-only apart from `read_at`.

-- ---------------------------------------------------------------------------
-- Engine state. `events_from` is the launch instant: review growth recorded
-- before it never turns into events, so switching this on doesn't replay
-- weeks of history as a burst of notifications.
-- ---------------------------------------------------------------------------
create table notification_engine_state (
  id smallint primary key default 1 check (id = 1),
  events_from timestamptz not null
);
insert into notification_engine_state (events_from) values (now());
alter table notification_engine_state enable row level security;
revoke all on notification_engine_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- notifications: the concrete message a recipient gets. Generic on purpose:
-- `type` + `data` carry whatever a rule needs, so new kinds need no new table.
-- status: pending (waiting for scheduled_for / retry), sent, failed.
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  -- Not delivered before this instant (silent hours use it; reusable by any type).
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  attempt_count smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_recipient_idx on notifications (recipient_user_id, created_at desc);
create index notifications_due_idx on notifications (scheduled_for) where status = 'pending';

-- ---------------------------------------------------------------------------
-- notification_events: facts produced by the sync. event_key makes the same
-- fact land on the same row no matter how many times it is produced.
-- ---------------------------------------------------------------------------
create table notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  event_type text not null,
  business_id uuid references businesses (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  -- Notification this event ended up in (null if it was skipped by a rule).
  notification_id uuid references notifications (id) on delete set null,
  skipped_reason text,
  created_at timestamptz not null default now(),
  constraint notification_events_event_key_key unique (event_key)
);
create index notification_events_pending_idx on notification_events (created_at) where processed_at is null;
create index notification_events_business_idx on notification_events (business_id, event_type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- notification_deliveries: one row per (notification, device). History stays
-- when a device is later disabled or removed (push_subscription_id -> null).
-- ---------------------------------------------------------------------------
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications (id) on delete cascade,
  push_subscription_id uuid references push_subscriptions (id) on delete set null,
  status text not null check (status in ('sent', 'failed')),
  attempt_count smallint not null default 1,
  attempted_at timestamptz not null default now(),
  -- The push service accepted it (the device itself can't confirm).
  delivered_at timestamptz,
  error_code text,
  error_message text,
  constraint notification_deliveries_target_key unique (notification_id, push_subscription_id)
);
create index notification_deliveries_notification_idx on notification_deliveries (notification_id);

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------
alter table notification_events enable row level security;
alter table notification_deliveries enable row level security;
alter table notifications enable row level security;

revoke all on notification_events, notification_deliveries, notifications from anon, authenticated;

-- A user reads only their own notifications, and only once they are due
-- (a message held back for silent hours is not visible early).
grant select on notifications to authenticated;
create policy "notifications select (own, due)" on notifications
  for select to authenticated
  using (recipient_user_id = auth.uid() and scheduled_for <= now());

-- ...and can only flip read_at on their own rows. No insert, no delete.
grant update (read_at) on notifications to authenticated;
create policy "notifications mark read (own)" on notifications
  for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- emit_review_gained_events: derives `reviews_gained` from review_snapshots.
--
-- Snapshots are append-only, so they are a reliable record of what the sync
-- saw — unlike businesses.current_reviews, which the sync overwrites. Each
-- snapshot is compared with the previous snapshot of the same business; only
-- an increase produces an event. The key includes the snapshot id, so calling
-- this any number of times (sync retry, engine sweep, cron) yields one row.
--   100 -> 95  : nothing.   95 -> 97 : gained = 2.
-- ---------------------------------------------------------------------------
create function emit_review_gained_events(p_since timestamptz default null)
returns integer
language plpgsql
as $$
declare
  v_floor timestamptz;
  v_count integer;
begin
  select events_from into v_floor from notification_engine_state where id = 1;
  v_floor := greatest(coalesce(p_since, v_floor), v_floor);

  with candidates as (
    select s.id, s.business_id, s.review_count, s.created_at, prev.review_count as prev_count
    from review_snapshots s
    cross join lateral (
      select p.review_count
      from review_snapshots p
      where p.business_id = s.business_id
        and (p.created_at, p.id) < (s.created_at, s.id)
      order by p.created_at desc, p.id desc
      limit 1
    ) prev
    where s.created_at >= v_floor
  ),
  inserted as (
    insert into notification_events (event_key, event_type, business_id, payload, occurred_at)
    select
      'reviews_gained:' || c.business_id || ':' || c.id,
      'reviews_gained',
      c.business_id,
      jsonb_build_object(
        'previous_count', c.prev_count,
        'new_count', c.review_count,
        'gained', c.review_count - c.prev_count,
        'snapshot_id', c.id
      ),
      c.created_at
    from candidates c
    join businesses b on b.id = c.business_id and b.deleted_at is null
    where c.review_count > c.prev_count
    on conflict (event_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- engine_commit: the atomic step of the engine. In ONE transaction it creates
-- (or merges into a still-pending) notification AND marks its events as
-- processed. Either both happen or neither, so an interrupted run can be
-- repeated without a duplicate notification and without losing events.
-- Returns null if any of the events was already taken by another run.
-- ---------------------------------------------------------------------------
create function engine_commit(
  p_recipient uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb,
  p_event_ids uuid[],
  p_scheduled_for timestamptz,
  p_merge_into uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_locked integer;
  v_id uuid;
begin
  select count(*) into v_locked
  from (
    select id from notification_events
    where id = any (p_event_ids) and processed_at is null
    for update skip locked
  ) e;

  if v_locked <> coalesce(array_length(p_event_ids, 1), 0) then
    return null;
  end if;

  if p_merge_into is not null then
    update notifications
    set title = p_title, body = p_body, data = p_data, updated_at = now()
    where id = p_merge_into and status = 'pending' and recipient_user_id = p_recipient
    returning id into v_id;
  end if;

  if v_id is null then
    insert into notifications (recipient_user_id, type, title, body, data, scheduled_for)
    values (p_recipient, p_type, p_title, p_body, p_data, p_scheduled_for)
    returning id into v_id;
  end if;

  update notification_events
  set processed_at = now(), notification_id = v_id
  where id = any (p_event_ids);

  return v_id;
end;
$$;

-- Functions are executable by PUBLIC by default; these are backend-only.
revoke execute on function emit_review_gained_events(timestamptz) from public, anon, authenticated;
revoke execute on function engine_commit(uuid, text, text, text, jsonb, uuid[], timestamptz, uuid) from public, anon, authenticated;
grant execute on function emit_review_gained_events(timestamptz) to service_role;
grant execute on function engine_commit(uuid, text, text, text, jsonb, uuid[], timestamptz, uuid) to service_role;
