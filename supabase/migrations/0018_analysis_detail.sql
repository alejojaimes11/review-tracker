-- Richer AI analyses: everything beyond the original bien/mejorar/acciones
-- (executive summary, deterministic stats, strengths/opportunities with
-- evidence, themes, and suggested replies) lives in one jsonb column so the
-- shape can keep evolving without a migration per field. Old rows keep the
-- empty default and the UI falls back to the original layout for them.
alter table analyses add column detalle jsonb not null default '{}'::jsonb;
