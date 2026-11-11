-- Project-bound POS pairing codes. A device can only ever write to the project it was paired with.
begin;

create or replace function public.create_pairing_code(p_workspace uuid,p_project uuid)
returns text language plpgsql security definer set search_path=public
as $$
declare c text;
begin
 if not public.is_owner(p_workspace) then raise exception 'Only the owner can add a device.';end if;
 if p_project is null or not exists(select 1 from public.business_projects where id=p_project and workspace_id=p_workspace) then
  raise exception 'Select the business project this device will record for.';
 end if;
 c:=upper(substr(md5(gen_random_uuid()::text||clock_timestamp()::text),1,8));
 insert into public.pairing_codes(code,workspace_id,project_id,created_by,expires_at)
 values(c,p_workspace,p_project,auth.uid(),now()+interval '10 minutes');
 return c;
end;
$$;

create or replace function public.create_pairing_code(p_workspace uuid)
returns text language plpgsql security definer set search_path=public
as $$
declare pid uuid;n integer;
begin
 select count(*),(array_agg(id order by created_at))[1] into n,pid
 from public.business_projects where workspace_id=p_workspace;
 if n<>1 then raise exception 'Select a project when pairing a device. This older action is safe only when exactly one project exists.';end if;
 return public.create_pairing_code(p_workspace,pid);
end;
$$;

create or replace function public.redeem_pairing_code(p_code text,p_name text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare pc public.pairing_codes;tok text;dev uuid;
begin
 select * into pc from public.pairing_codes where code=upper(trim(p_code)) for update;
 if not found or pc.used or pc.expires_at<now() or pc.project_id is null then
  raise exception 'That code is not valid, has no project, or has expired. Ask the owner for a new one.';
 end if;
 tok:=encode(gen_random_bytes(32),'hex');
 insert into public.devices(workspace_id,project_id,name,token_hash,created_by)
 values(pc.workspace_id,pc.project_id,coalesce(nullif(trim(p_name),''),'Device'),encode(digest(tok,'sha256'),'hex'),pc.created_by)
 returning id into dev;
 update public.pairing_codes set used=true where code=pc.code;
 return jsonb_build_object('token',tok,'device_id',dev,'project_id',pc.project_id);
end;
$$;

commit;
