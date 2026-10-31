-- PELEX media bucket. Public links are accessible without login; review before running.
insert into storage.buckets(id,name,public) values('pelex-media','pelex-media',true) on conflict(id) do update set public=true;
