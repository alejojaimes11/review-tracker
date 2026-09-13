-- Soft delete: "Eliminar negocio" now sets deleted_at instead of removing the
-- row, so it can be restored from a "Papelera" view. Existing queries need to
-- filter deleted_at is null explicitly (dashboard list, sync, monthly reports).
alter table businesses
  add column deleted_at timestamptz,
  add column notes text,
  add column phone text;
