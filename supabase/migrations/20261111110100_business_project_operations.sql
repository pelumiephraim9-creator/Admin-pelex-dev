-- Business Agent project isolation: operational records, uploads, agreements and device feeds
begin;

-- The Business Agent test workspace was reset before this migration; these operating tables are empty.
alter table public.ledger_entries alter column project_id set not null;
alter table public.uploads alter column project_id set not null;
alter table public.agreements alter column project_id set not null;
alter table public.devices add column if not exists project_id uuid;
alter table public.pairing_codes add column if not exists project_id uuid;

alter table public.devices
  drop constraint if exists devices_project_workspace_fkey;
alter table public.devices
  add constraint devices_project_workspace_fkey
  foreign key (project_id,workspace_id)
  references public.business_projects(id,workspace_id) on delete restrict;
alter table public.pairing_codes
  drop constraint if exists pairing_codes_project_workspace_fkey;
alter table public.pairing_codes
  add constraint pairing_codes_project_workspace_fkey
  foreign key (project_id,workspace_id)
  references public.business_projects(id,workspace_id) on delete restrict;
alter table public.devices alter column project_id set not null;
alter table public.pairing_codes alter column project_id set not null;

create or replace function public.require_project_record()
returns trigger language plpgsql security invoker set search_path=public
as $$
begin
 if new.project_id is null then raise exception 'Choose a business project before saving this record.'; end if;
 if not exists(select 1 from public.business_projects bp where bp.id=new.project_id and bp.workspace_id=new.workspace_id) then
   raise exception 'The selected project does not belong to this workspace.';
 end if;
 return new;
end;
$$;
drop trigger if exists require_upload_project on public.uploads;
create trigger require_upload_project before insert or update of project_id,workspace_id on public.uploads
for each row execute function public.require_project_record();
drop trigger if exists require_agreement_project on public.agreements;
create trigger require_agreement_project before insert or update of project_id,workspace_id on public.agreements
for each row execute function public.require_project_record();
drop trigger if exists require_device_project on public.devices;
create trigger require_device_project before insert or update of project_id,workspace_id on public.devices
for each row execute function public.require_project_record();

-- Extensible, project-scoped operational records for all modules advertised by business_types.
create table if not exists public.business_project_records (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 project_id uuid not null,
 module_key text not null,
 record_type text not null,
 record_date date not null default current_date,
 amount numeric(18,2),
 currency text,
 quantity numeric(18,4),
 unit_cost numeric(18,4),
 party text,
 reference text,
 status text not null default 'recorded',
 data jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint business_project_records_project_workspace_fkey
  foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict,
 constraint business_project_records_amount_check check(amount is null or amount>=0),
 constraint business_project_records_quantity_check check(quantity is null or quantity>=0),
 constraint business_project_records_unit_cost_check check(unit_cost is null or unit_cost>=0),
 constraint business_project_records_data_object_check check(jsonb_typeof(data)='object')
);
create index if not exists business_project_records_project_date_idx
 on public.business_project_records(project_id,record_date desc,created_at desc);
create index if not exists business_project_records_project_module_idx
 on public.business_project_records(project_id,module_key,record_type,record_date desc);
alter table public.business_project_records enable row level security;
drop policy if exists business_project_records_read on public.business_project_records;
create policy business_project_records_read on public.business_project_records
 for select to authenticated using (public.is_member(workspace_id));
drop policy if exists business_project_records_write on public.business_project_records;
create policy business_project_records_write on public.business_project_records
 for all to authenticated using (public.can_edit(workspace_id))
 with check (
  public.can_edit(workspace_id)
  and exists(select 1 from public.business_projects bp where bp.id=business_project_records.project_id and bp.workspace_id=business_project_records.workspace_id)
 );
grant select,insert,update,delete on public.business_project_records to authenticated;

create or replace function public.business_add_project_record(
 p_workspace uuid,p_project uuid,p_module text,p_record_type text,p_date date,
 p_amount numeric,p_currency text,p_quantity numeric,p_unit_cost numeric,
 p_party text,p_reference text,p_status text,p_data jsonb
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare pid uuid; cur text; mods text[];
begin
 if not public.can_edit(p_workspace) then raise exception 'You cannot edit this business project.'; end if;
 select bp.id,bp.currency,bt.modules into pid,cur,mods
 from public.business_projects bp join public.business_types bt on bt.code=bp.business_type
 where bp.id=p_project and bp.workspace_id=p_workspace;
 if pid is null then raise exception 'Choose a valid business project.'; end if;
 if not (p_module=any(mods)) then raise exception 'The selected business type does not enable the % module.',p_module; end if;
 if p_amount is not null and p_amount<0 or p_quantity is not null and p_quantity<0 or p_unit_cost is not null and p_unit_cost<0 then
  raise exception 'Amounts, quantities and unit costs cannot be negative.';
 end if;
 if p_currency is not null and upper(p_currency)<>upper(cur) then raise exception 'Use this project reporting currency (%).',cur; end if;
 if p_data is not null and jsonb_typeof(p_data)<>'object' then raise exception 'Record details must be a JSON object.'; end if;
 insert into public.business_project_records
  (workspace_id,project_id,module_key,record_type,record_date,amount,currency,quantity,unit_cost,party,reference,status,data,created_by)
 values
  (p_workspace,p_project,p_module,p_record_type,coalesce(p_date,current_date),p_amount,cur,p_quantity,p_unit_cost,
   nullif(trim(p_party),''),nullif(trim(p_reference),''),coalesce(nullif(p_status,''),'recorded'),coalesce(p_data,'{}'::jsonb),auth.uid())
 returning id into pid;
 return pid;
end;
$$;

create or replace function public.business_list_project_records(
 p_workspace uuid,p_project uuid,p_module text default null,p_from date default null,p_to date default null
)
returns setof public.business_project_records
language plpgsql stable security definer set search_path=public
as $$
begin
 if not public.is_member(p_workspace) then raise exception 'You are not a member of this business.'; end if;
 if p_project is null or not exists(select 1 from public.business_projects where id=p_project and workspace_id=p_workspace) then
  raise exception 'Choose a valid business project.';
 end if;
 return query select r.* from public.business_project_records r
 where r.workspace_id=p_workspace and r.project_id=p_project
  and (p_module is null or r.module_key=p_module)
  and (p_from is null or r.record_date>=p_from)
  and (p_to is null or r.record_date<=p_to)
 order by r.record_date desc,r.created_at desc;
end;
$$;

-- File confirmation must match the project assigned to the uploaded source file.
create or replace function public.confirm_upload(p_upload uuid,p_currency text,p_entries jsonb)
returns integer language plpgsql security definer set search_path=public
as $$
declare ws uuid; upload_project uuid; n integer:=0; e jsonb; et text; k text; cur text; pid uuid; amt numeric; dt date;
begin
 select workspace_id,project_id into ws,upload_project from public.uploads
 where id=p_upload and status='pending_review' for update;
 if ws is null or upload_project is null or not public.can_edit(ws) then
  raise exception 'Upload not found, project not selected, already confirmed, or access denied.';
 end if;
 cur:=upper(coalesce(nullif(trim(p_currency),''),''));
 if char_length(cur)<>3 or cur !~ '^[A-Z]{3}$' then raise exception 'Choose a valid three-letter currency code.'; end if;
 if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)=0 then raise exception 'There are no transaction rows to confirm.'; end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  et:=lower(coalesce(e->>'type','other'));
  if et not in ('invoice','receipt','sale','expense','payment','other') then raise exception 'Invalid transaction type in uploaded rows.'; end if;
  amt:=nullif(e->>'amount','')::numeric;dt:=nullif(e->>'date','')::date;
  if amt is null or amt<=0 or dt is null then raise exception 'Every uploaded row needs a valid date and amount greater than zero.'; end if;
  k:=coalesce(nullif(e->>'kind',''),public.ledger_kind(et,null));
  if k not in ('income','expense','principal_in','principal_out','savings_in','transfer','capital','receivable_in') then raise exception 'Invalid accounting classification in uploaded rows.'; end if;
  pid:=nullif(e->>'project_id','')::uuid;
  if pid is distinct from upload_project then raise exception 'Every row in this file must belong to the project selected when the file was uploaded.'; end if;
  cur:=upper(coalesce(nullif(e->>'currency',''),upper(p_currency)));
  if cur<>upper(p_currency) then raise exception 'Every uploaded row must use the selected project currency.'; end if;
  insert into public.ledger_entries(workspace_id,project_id,upload_id,entry_date,entry_type,amount,currency,party,due_date,kind,category,created_by)
  values(ws,upload_project,p_upload,dt,et,amt,cur,e->>'party',nullif(e->>'due','')::date,k,nullif(e->>'category',''),auth.uid());
  n:=n+1;
 end loop;
 update public.uploads set status='confirmed',currency=upper(p_currency) where id=p_upload;
 return n;
end;
$$;

-- Repayments and savings releases must be recorded against the same project as the loan agreement.
create or replace function public.record_payment(p_agreement uuid,p_amount numeric,p_date date)
returns numeric language plpgsql security definer set search_path=public
as $$
declare ag public.agreements; rem numeric:=p_amount; it public.schedule_items; cur text;
 applied numeric:=0;p_sum numeric:=0;i_sum numeric:=0;s_sum numeric:=0;take numeric;owed numeric;pp numeric;ip numeric;sp numeric;
begin
 select * into ag from public.agreements where id=p_agreement;
 if not found or not public.can_edit(ag.workspace_id) then raise exception 'You cannot record payments for this agreement.'; end if;
 if p_amount is null or p_amount<=0 or p_date is null then raise exception 'Enter a valid payment date and amount.'; end if;
 select currency into cur from public.business_projects where id=ag.project_id and workspace_id=ag.workspace_id;
 for it in select * from public.schedule_items where agreement_id=p_agreement and status<>'paid' order by seq loop
  exit when rem<=0;owed:=it.amount_due-it.amount_paid;take:=least(owed,rem);
  update public.schedule_items set amount_paid=amount_paid+take,status=case when amount_paid+take>=amount_due then 'paid' else 'partial' end where id=it.id;
  if it.amount_due>0 then pp:=round(take*it.principal_due/it.amount_due,2);ip:=round(take*it.interest_due/it.amount_due,2);sp:=take-pp-ip;
  else pp:=take;ip:=0;sp:=0;end if;
  p_sum:=p_sum+pp;i_sum:=i_sum+ip;s_sum:=s_sum+sp;rem:=rem-take;applied:=applied+take;
 end loop;
 if p_sum>0 then insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
 values(ag.workspace_id,ag.project_id,p_date,'receipt',p_sum,cur,'Principal returned: '||ag.party,'principal_in',auth.uid());end if;
 if i_sum>0 then insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
 values(ag.workspace_id,ag.project_id,p_date,'receipt',i_sum,cur,'Interest: '||ag.party,'income',auth.uid());end if;
 if s_sum>0 then insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
 values(ag.workspace_id,ag.project_id,p_date,'other',s_sum,cur,'Savings kept: '||ag.party,'savings_in',auth.uid());end if;
 if not exists(select 1 from public.schedule_items where agreement_id=p_agreement and status<>'paid') then update public.agreements set status='closed' where id=p_agreement;end if;
 return applied;
end;
$$;

create or replace function public.release_savings(p_agreement uuid)
returns numeric language plpgsql security definer set search_path=public
as $$
declare ag public.agreements;cur text;
begin
 select * into ag from public.agreements where id=p_agreement;
 if not found or not public.can_edit(ag.workspace_id) then raise exception 'You cannot release savings for this loan.';end if;
 if ag.savings_model<>'savings_box_completes' or ag.deposit<=0 then raise exception 'This loan has no savings box.';end if;
 if ag.status<>'closed' then raise exception 'Savings are released when the loan is fully repaid.';end if;
 if exists(select 1 from public.ledger_entries where project_id=ag.project_id and party='Savings released to complete loan: '||ag.party) then return 0;end if;
 select currency into cur from public.business_projects where id=ag.project_id and workspace_id=ag.workspace_id;
 insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
 values(ag.workspace_id,ag.project_id,current_date,'other',ag.deposit,cur,'Savings released to complete loan: '||ag.party,'transfer',auth.uid());
 return ag.deposit;
end;
$$;

-- Existing till slip API remains compatible only for a single unambiguous project.
create or replace function public.add_slip(
 p_workspace uuid,p_project uuid,p_type text,p_amount numeric,p_date date,
 p_party text,p_currency text default 'NGN',p_category text default null
)
returns bigint language plpgsql security definer set search_path=public
as $$
declare eid bigint;t text:=lower(coalesce(p_type,'receipt'));k text;cur text;
begin
 if not public.can_edit(p_workspace) then raise exception 'You cannot add slips to this business.';end if;
 if p_project is null or not exists(select 1 from public.business_projects where id=p_project and workspace_id=p_workspace) then raise exception 'Choose the project for this slip.';end if;
 if p_amount is null or p_amount<=0 or p_date is null then raise exception 'Enter a valid date and amount above zero.';end if;
 if t not in ('sale','receipt','expense','repayment','loan') then raise exception 'Unknown slip type: %',t;end if;
 select currency into cur from public.business_projects where id=p_project;
 if upper(coalesce(p_currency,cur))<>upper(cur) then raise exception 'Use the selected project currency (%).',cur;end if;
 k:=case when t='expense' then 'expense' when t='repayment' then 'principal_in' when t='loan' then 'principal_out' else 'income' end;
 insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,category,created_by)
 values(p_workspace,p_project,p_date,case when t='repayment' then 'receipt' when t='loan' then 'expense' else t end,
 p_amount,cur,left(coalesce(nullif(trim(p_party),''),'Slip'),120),k,
 coalesce(nullif(trim(coalesce(p_category,'')),''),case when t='loan' then 'Loan given' end),auth.uid())
 returning id into eid;return eid;
end;
$$;

create or replace function public.add_slip(
 p_workspace uuid,p_type text,p_amount numeric,p_date date,p_party text,
 p_currency text default 'NGN',p_category text default null
)
returns bigint language plpgsql security definer set search_path=public
as $$
declare pid uuid;n integer;
begin
 select count(*),(array_agg(id order by created_at))[1] into n,pid from public.business_projects where workspace_id=p_workspace;
 if n<>1 then raise exception 'Choose a project before adding a till slip. Workspace-wide slip entry is disabled when multiple projects exist.';end if;
 return public.add_slip(p_workspace,pid,p_type,p_amount,p_date,p_party,p_currency,p_category);
end;
$$;

-- Device credentials are project-bound, and incoming POS rows inherit that project.
create or replace function public.redeem_pairing_code(p_code text,p_name text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare pc public.pairing_codes;tok text;dev uuid;
begin
 select * into pc from public.pairing_codes where code=upper(trim(p_code)) for update;
 if not found or pc.used or pc.expires_at<now() or pc.project_id is null then raise exception 'That code is not valid, has no project, or has expired. Ask the owner for a new one.';end if;
 if not public.is_member(pc.workspace_id) then raise exception 'You cannot connect a device to this business.';end if;
 tok:=encode(gen_random_bytes(32),'hex');
 insert into public.devices(workspace_id,project_id,name,token_hash,created_by)
 values(pc.workspace_id,pc.project_id,coalesce(nullif(trim(p_name),''),'Device'),encode(digest(tok,'sha256'),'hex'),pc.created_by)
 returning id into dev;
 update public.pairing_codes set used=true where code=pc.code;
 return jsonb_build_object('token',tok,'device_id',dev,'project_id',pc.project_id);
end;
$$;

create or replace function public.device_ingest(p_token text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare d public.devices;e jsonb;n_new int:=0;n_seen int:=0;cur text;
begin
 select * into d from public.devices
 where token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and not revoked;
 if not found or d.project_id is null then raise exception 'This device is not connected to a business project. Ask the owner to reconnect it.';end if;
 select currency into cur from public.business_projects where id=d.project_id and workspace_id=d.workspace_id;
 for e in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
  if e->>'source_key' is null or e->>'date' is null or e->>'amount' is null then continue;end if;
  insert into public.ledger_entries(workspace_id,project_id,entry_date,entry_type,amount,currency,party,due_date,source_key,device_id,created_by)
  values(d.workspace_id,d.project_id,(e->>'date')::date,coalesce(nullif(e->>'type',''),'other'),(e->>'amount')::numeric,
   coalesce(nullif(e->>'currency',''),cur),nullif(e->>'party',''),nullif(e->>'due','')::date,e->>'source_key',d.id,d.created_by)
  on conflict(workspace_id,source_key) where source_key is not null do nothing;
  if found then n_new:=n_new+1;else n_seen:=n_seen+1;end if;
 end loop;
 update public.devices set last_seen=now() where id=d.id;
 return jsonb_build_object('new',n_new,'already_recorded',n_seen,'project_id',d.project_id);
end;
$$;

commit;
