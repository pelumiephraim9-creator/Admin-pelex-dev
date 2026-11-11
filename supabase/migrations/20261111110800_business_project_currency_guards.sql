-- Hard-enforce the selected project's reporting currency on every financial and operational write.
begin;

create or replace function public.require_ledger_project()
returns trigger language plpgsql set search_path=public
as $$
declare project_currency text;
begin
 if new.project_id is null then raise exception 'Select the business project for this transaction before saving.'; end if;
 select upper(bp.currency) into project_currency from public.business_projects bp
 where bp.id=new.project_id and bp.workspace_id=new.workspace_id;
 if project_currency is null then raise exception 'The selected project does not belong to this workspace.'; end if;
 if upper(coalesce(new.currency,''))<>project_currency then
  raise exception 'This transaction must use the selected project currency (%).',project_currency;
 end if;
 return new;
end;
$$;
drop trigger if exists zz_ledger_require_project on public.ledger_entries;
create trigger zz_ledger_require_project
before insert or update of project_id,workspace_id,currency on public.ledger_entries
for each row execute function public.require_ledger_project();

create or replace function public.require_project_record()
returns trigger language plpgsql set search_path=public
as $$
declare project_currency text;
begin
 if new.project_id is null then raise exception 'Choose a business project before saving this record.'; end if;
 select upper(bp.currency) into project_currency from public.business_projects bp
 where bp.id=new.project_id and bp.workspace_id=new.workspace_id;
 if project_currency is null then raise exception 'The selected project does not belong to this workspace.'; end if;
 if tg_table_name='uploads' then
  if new.currency is not null and upper(new.currency)<>project_currency then
   raise exception 'Uploaded files must use this project''s reporting currency (%).',project_currency;
  end if;
 end if;
 return new;
end;
$$;
drop trigger if exists require_upload_project on public.uploads;
create trigger require_upload_project before insert or update of project_id,workspace_id,currency on public.uploads
for each row execute function public.require_project_record();
drop trigger if exists require_agreement_project on public.agreements;
create trigger require_agreement_project before insert or update of project_id,workspace_id on public.agreements
for each row execute function public.require_project_record();
drop trigger if exists require_device_project on public.devices;
create trigger require_device_project before insert or update of project_id,workspace_id on public.devices
for each row execute function public.require_project_record();

alter table public.business_project_records alter column currency set not null;
create or replace function public.require_business_project_record()
returns trigger language plpgsql set search_path=public
as $$
declare project_currency text; mods text[];
begin
 select upper(bp.currency),bt.modules into project_currency,mods
 from public.business_projects bp join public.business_types bt on bt.code=bp.business_type
 where bp.id=new.project_id and bp.workspace_id=new.workspace_id;
 if project_currency is null then raise exception 'The selected project does not belong to this workspace.'; end if;
 if upper(coalesce(new.currency,''))<>project_currency then
  raise exception 'Operational records must use this project''s reporting currency (%).',project_currency;
 end if;
 if not (new.module_key=any(mods)) then raise exception 'The selected business type does not enable the % module.',new.module_key; end if;
 return new;
end;
$$;
drop trigger if exists require_business_project_record on public.business_project_records;
create trigger require_business_project_record
before insert or update of project_id,workspace_id,module_key,currency on public.business_project_records
for each row execute function public.require_business_project_record();

alter table public.payment_events alter column currency set not null;
create or replace function public.require_payment_project_currency()
returns trigger language plpgsql set search_path=public
as $$
declare project_currency text;
begin
 select upper(currency) into project_currency from public.business_projects
 where id=new.project_id and workspace_id=new.workspace_id;
 if project_currency is null then raise exception 'The payment project does not belong to this workspace.'; end if;
 if upper(coalesce(new.currency,''))<>project_currency then
  raise exception 'Payment records must use this project''s reporting currency (%).',project_currency;
 end if;
 return new;
end;
$$;
drop trigger if exists require_payment_connection_currency on public.payment_connections;
create trigger require_payment_connection_currency
before insert or update of project_id,workspace_id,currency on public.payment_connections
for each row execute function public.require_payment_project_currency();
drop trigger if exists require_payment_event_currency on public.payment_events;
create trigger require_payment_event_currency
before insert or update of project_id,workspace_id,currency on public.payment_events
for each row execute function public.require_payment_project_currency();

commit;
