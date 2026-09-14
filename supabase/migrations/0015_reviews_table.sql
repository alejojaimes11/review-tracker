-- Reseñas individuales (texto + rating puntual), primer bloque de MarketPulse.
-- Deliberadamente mínima: sin identidad del reviewer (nombre, foto, perfil) —
-- mismo principio de "dato mínimo" que ya rige el resto del proyecto, y
-- evita guardar datos personales de terceros sin necesidad concreta.
-- review_id es la clave de Apify para esa reseña puntual: la usamos para
-- deduplicar entre corridas del sync (reviewsSort: newest trae solape con
-- lo ya visto, no queremos filas repetidas).
create table reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  review_id text not null unique,
  rating smallint,
  text text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index reviews_business_id_idx on reviews(business_id);
create index reviews_published_at_idx on reviews(published_at desc);
