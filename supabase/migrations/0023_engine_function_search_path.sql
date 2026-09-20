-- Security advisor: pin the search_path of the engine functions so a role can't shadow objects they use.
alter function emit_review_gained_events(timestamptz) set search_path = public, pg_temp;
alter function engine_commit(uuid, text, text, text, jsonb, uuid[], timestamptz, uuid) set search_path = public, pg_temp;
