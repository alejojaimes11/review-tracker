-- Delivery claims: only ONE engine run can send a given notification at a time.
--
-- Without this, two engine runs overlapping (cron + a manual call, two slow
-- crons, a retry after a timeout) could both read the same pending
-- notification and push it twice. Now the delivery step must first CLAIM a
-- notification:
--
--   claim_due_notifications()  -> atomically marks due notifications as claimed
--                                 (FOR UPDATE SKIP LOCKED), returns only the ones
--                                 this run won, plus its claim_token.
--   claim_token acts as a fencing token: every later write to the notification
--   is conditioned on it, so a run that lost its claim (lease expired) cannot
--   overwrite or continue what another run now owns.
--   The claim is a LEASE: if a run dies or times out, the claim expires and a
--   later run picks the notification up again.
--
-- notification_deliveries and its per-device behaviour are unchanged.

alter table notifications
  add column claimed_at timestamptz,
  add column claim_token uuid;

create function claim_due_notifications(p_limit integer default 50, p_lease_seconds integer default 300)
returns table (
  id uuid,
  recipient_user_id uuid,
  title text,
  body text,
  data jsonb,
  attempt_count smallint,
  claim_token uuid
)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with due as (
    select n.id
    from notifications n
    where n.status = 'pending'
      and n.scheduled_for <= now()
      -- never claimed, or the previous claim's lease has run out
      and (n.claimed_at is null or n.claimed_at < now() - make_interval(secs => p_lease_seconds))
    order by n.scheduled_for
    limit p_limit
    for update skip locked
  )
  update notifications n
  set claimed_at = now(), claim_token = v_token, updated_at = now()
  from due
  where n.id = due.id
  returning n.id, n.recipient_user_id, n.title, n.body, n.data, n.attempt_count, n.claim_token;
end;
$$;

-- A notification that a run has claimed (is sending) must not be rewritten by
-- the grouping step: merge only into pending notifications nobody has claimed.
-- Otherwise new events could be merged into a message that was already sent
-- and never be announced. (Same function as before plus `claimed_at is null`.)
create or replace function engine_commit(
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
set search_path = public, pg_temp
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
    where id = p_merge_into
      and status = 'pending'
      and claimed_at is null
      and recipient_user_id = p_recipient
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

-- Backend-only, as the other engine functions.
revoke execute on function claim_due_notifications(integer, integer) from public, anon, authenticated;
grant execute on function claim_due_notifications(integer, integer) to service_role;
revoke execute on function engine_commit(uuid, text, text, text, jsonb, uuid[], timestamptz, uuid) from public, anon, authenticated;
grant execute on function engine_commit(uuid, text, text, text, jsonb, uuid[], timestamptz, uuid) to service_role;
