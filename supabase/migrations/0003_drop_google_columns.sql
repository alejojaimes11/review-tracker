alter table businesses drop column if exists place_id;
alter table businesses drop column if exists photo_url;
alter table businesses alter column maps_url set not null;
alter table businesses add constraint businesses_maps_url_key unique (maps_url);
