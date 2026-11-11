-- Business Agent project isolation foundation
-- Every operating record belongs to exactly one business project.
-- Existing unrelated agent/account tables and security policies are not changed.

begin;

alter table public.business_projects
  add column if not exists reporting_cycle text not null default 'monthly',
  add column if not exists profile jsonb not null default '{}'::jsonb;

alter table public.business_projects
  drop constraint if exists business_projects_reporting_cycle_check;
alter table public.business_projects
  add constraint business_projects_reporting_cycle_check
  check (reporting_cycle in ('daily','weekly','monthly'));
alter table public.business_projects
  drop constraint if exists business_projects_profile_object_check;
alter table public.business_projects
  add constraint business_projects_profile_object_check
  check (jsonb_typeof(profile) = 'object');

create unique index if not exists business_projects_id_workspace_uq
  on public.business_projects(id, workspace_id);

alter table public.business_projects
  drop constraint if exists business_projects_business_type_fkey;
alter table public.business_projects
  add constraint business_projects_business_type_fkey
  foreign key (business_type) references public.business_types(code);

alter table public.ledger_entries
  drop constraint if exists ledger_entries_project_id_fkey;
alter table public.ledger_entries
  drop constraint if exists ledger_entries_project_workspace_fkey;
alter table public.ledger_entries
  add constraint ledger_entries_project_workspace_fkey
  foreign key (project_id, workspace_id)
  references public.business_projects(id, workspace_id)
  on delete restrict;

alter table public.uploads
  add column if not exists project_id uuid;
alter table public.uploads
  drop constraint if exists uploads_project_workspace_fkey;
alter table public.uploads
  add constraint uploads_project_workspace_fkey
  foreign key (project_id, workspace_id)
  references public.business_projects(id, workspace_id)
  on delete restrict;

alter table public.agreements
  add column if not exists project_id uuid;
alter table public.agreements
  drop constraint if exists agreements_project_workspace_fkey;
alter table public.agreements
  add constraint agreements_project_workspace_fkey
  foreign key (project_id, workspace_id)
  references public.business_projects(id, workspace_id)
  on delete restrict;

create index if not exists ledger_entries_project_date_idx
  on public.ledger_entries(project_id, entry_date desc, id desc);
create index if not exists agreements_project_start_idx
  on public.agreements(project_id, start_date desc);
create index if not exists uploads_project_created_idx
  on public.uploads(project_id, created_at desc);

create or replace function public.require_ledger_project()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.project_id is null then
    raise exception 'Select the business project for this transaction before saving.';
  end if;
  if not exists (
    select 1 from public.business_projects bp
    where bp.id = new.project_id and bp.workspace_id = new.workspace_id
  ) then
    raise exception 'The selected project does not belong to this workspace.';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_ledger_require_project on public.ledger_entries;
create trigger zz_ledger_require_project
before insert or update of project_id, workspace_id on public.ledger_entries
for each row execute function public.require_ledger_project();

create or replace function public.business_add_transaction(
  p_workspace uuid, p_project uuid, p_entry_type text, p_kind text,
  p_amount numeric, p_date date, p_party text, p_currency text,
  p_category text default null, p_due_date date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare eid bigint; cur text; et text; k text;
begin
  if not public.can_edit(p_workspace) then
    raise exception 'You cannot add transactions to this business.';
  end if;
  if p_project is null or not exists (
    select 1 from public.business_projects
    where id=p_project and workspace_id=p_workspace
  ) then
    raise exception 'Choose a valid project for this transaction.';
  end if;
  et := lower(coalesce(p_entry_type,''));
  k := lower(coalesce(p_kind,''));
  if et not in ('invoice','receipt','sale','expense','payment','other') then
    raise exception 'Choose a valid transaction type.';
  end if;
  if k not in ('income','expense','principal_in','principal_out','savings_in','transfer','capital','receivable_in') then
    raise exception 'Choose a valid accounting classification.';
  end if;
  if p_amount is null or p_amount<=0 or p_date is null then
    raise exception 'Enter a valid date and an amount greater than zero.';
  end if;
  cur := upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  if char_length(cur)<>3 or cur !~ '^[A-Z]{3}$' then
    raise exception 'Enter a valid three-letter currency code.';
  end if;
  insert into public.ledger_entries
    (workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,category,due_date,created_by)
  values
    (p_workspace,p_project,p_date,et,p_amount,cur,
     left(coalesce(nullif(trim(p_party),''),'Manual transaction'),160),
     k,nullif(trim(coalesce(p_category,'')),''),p_due_date,auth.uid())
  returning id into eid;
  return eid;
end;
$$;

create or replace function public.business_update_transaction(
  p_workspace uuid, p_entry_id bigint, p_entry_type text, p_kind text,
  p_amount numeric, p_date date, p_party text, p_currency text,
  p_category text default null, p_due_date date default null, p_project uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare eid bigint; cur text; et text; k text;
begin
  if not public.can_edit(p_workspace) then
    raise exception 'You cannot edit transactions in this business.';
  end if;
  if p_project is null or not exists (
    select 1 from public.business_projects
    where id=p_project and workspace_id=p_workspace
  ) then
    raise exception 'Choose a valid project for this transaction.';
  end if;
  et := lower(coalesce(p_entry_type,''));
  k := lower(coalesce(p_kind,''));
  if et not in ('invoice','receipt','sale','expense','payment','other') then
    raise exception 'Choose a valid transaction type.';
  end if;
  if k not in ('income','expense','principal_in','principal_out','savings_in','transfer','capital','receivable_in') then
    raise exception 'Choose a valid accounting classification.';
  end if;
  if p_amount is null or p_amount<=0 or p_date is null then
    raise exception 'Enter a valid date and an amount greater than zero.';
  end if;
  cur := upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  if char_length(cur)<>3 or cur !~ '^[A-Z]{3}$' then
    raise exception 'Enter a valid three-letter currency code.';
  end if;
  update public.ledger_entries
  set project_id=p_project, entry_type=et, kind=k, amount=p_amount,
      entry_date=p_date,
      party=left(coalesce(nullif(trim(p_party),''),'Manual transaction'),160),
      currency=cur, category=nullif(trim(coalesce(p_category,'')),''), due_date=p_due_date
  where id=p_entry_id and workspace_id=p_workspace
  returning id into eid;
  if eid is null then raise exception 'Transaction not found in this business.'; end if;
  return eid;
end;
$$;

create or replace function public.save_setup_project_v2(
  p_workspace uuid, p_name text, p_business_type text, p_currency text,
  p_capital_month numeric, p_capital_year numeric, p_spent numeric,
  p_spend_period text, p_loan numeric, p_reporting_cycle text, p_profile jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid; cycle text;
begin
  if not public.can_edit(p_workspace) then
    raise exception 'You cannot change the setup in this workspace.';
  end if;
  if not exists (select 1 from public.business_types where code=p_business_type) then
    raise exception 'Choose a supported business type.';
  end if;
  cycle := coalesce(nullif(p_reporting_cycle,''),'monthly');
  if cycle not in ('daily','weekly','monthly') then
    raise exception 'Choose a valid reporting cycle.';
  end if;
  if p_profile is not null and jsonb_typeof(p_profile)<>'object' then
    raise exception 'Project configuration must be a JSON object.';
  end if;
  pid := public.save_setup_project(
    p_workspace,p_name,p_business_type,p_currency,p_capital_month,
    p_capital_year,p_spent,p_spend_period,p_loan
  );
  update public.business_projects
  set reporting_cycle=cycle, profile=coalesce(p_profile,'{}'::jsonb)
  where id=pid and workspace_id=p_workspace;
  return pid;
end;
$$;

create or replace function public.create_agreement_for_project(
  p_workspace uuid, p_project uuid, p_party text, p_principal numeric,
  p_deposit numeric, p_deposit_treatment text, p_rate numeric,
  p_rate_basis text, p_method text, p_cycle text, p_term integer,
  p_start date, p_savings_model text default 'upfront_credited',
  p_savings_per_instalment numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare ag uuid; cur text; dep numeric:=coalesce(p_deposit,0);
        model text:=coalesce(p_savings_model,'upfront_credited');
begin
  if not public.can_edit(p_workspace) then
    raise exception 'You cannot create agreements in this workspace.';
  end if;
  if p_project is null or not exists (
    select 1 from public.business_projects bp
    join public.business_types bt on bt.code=bp.business_type
    where bp.id=p_project and bp.workspace_id=p_workspace
      and 'agreements'=any(bt.modules)
  ) then
    raise exception 'Choose a lending or finance project with the agreements module.';
  end if;
  if model='per_instalment' then dep:=0; end if;
  select upper(currency) into cur from public.business_projects
  where id=p_project and workspace_id=p_workspace;
  if cur is null then raise exception 'Project currency is not configured.'; end if;
  insert into public.agreements
    (workspace_id,project_id,party,principal,deposit,deposit_treatment,rate,
     rate_basis,method,cycle,term_cycles,start_date,created_by,savings_model,savings_per_instalment)
  values
    (p_workspace,p_project,trim(p_party),p_principal,dep,
     case when model='savings_box_completes' then 'savings' else 'credited' end,
     p_rate,coalesce(p_rate_basis,'per_cycle'),p_method,p_cycle,p_term,p_start,
     auth.uid(),model,coalesce(p_savings_per_instalment,0))
  returning id into ag;
  perform public.build_schedule(ag);
  insert into public.ledger_entries
    (workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
  values
    (p_workspace,p_project,p_start,'expense',p_principal,cur,
     'Disbursed: '||trim(p_party),'principal_out',auth.uid());
  if dep>0 then
    insert into public.ledger_entries
      (workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,created_by)
    values
      (p_workspace,p_project,p_start,
       case when model='upfront_credited' then 'receipt' else 'other' end,
       dep,cur,
       case when model='upfront_credited' then 'Upfront deposit: ' else 'Savings held: ' end||trim(p_party),
       case when model='upfront_credited' then 'principal_in' else 'savings_in' end,auth.uid());
  end if;
  return ag;
end;
$$;

create or replace function public.create_agreement(
  p_workspace uuid, p_party text, p_principal numeric, p_deposit numeric,
  p_deposit_treatment text, p_rate numeric, p_rate_basis text, p_method text,
  p_cycle text, p_term integer, p_start date,
  p_savings_model text default 'upfront_credited',
  p_savings_per_instalment numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid; n integer;
begin
  select count(*), (array_agg(bp.id order by bp.created_at))[1]
  into n,pid
  from public.business_projects bp
  join public.business_types bt on bt.code=bp.business_type
  where bp.workspace_id=p_workspace and 'agreements'=any(bt.modules);
  if n<>1 then
    raise exception 'Select the lending project before creating an agreement. This older action is safe only when exactly one lending project exists.';
  end if;
  return public.create_agreement_for_project(
    p_workspace,pid,p_party,p_principal,p_deposit,p_deposit_treatment,
    p_rate,p_rate_basis,p_method,p_cycle,p_term,p_start,
    p_savings_model,p_savings_per_instalment
  );
end;
$$;

create or replace function public.agreements_for_project_month(
  p_workspace uuid, p_project uuid, p_month text
)
returns table(
  agreement_id uuid, customer text, start_date date, principal numeric,
  paid numeric, owed numeric, outstanding numeric, overdue_items bigint, status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_workspace) then
    raise exception 'Not a member of this business.';
  end if;
  if p_project is null or not exists (
    select 1 from public.business_projects
    where id=p_project and workspace_id=p_workspace
  ) then
    raise exception 'Choose a valid project.';
  end if;
  return query
  select a.id,a.party,a.start_date,a.principal,
    coalesce(sum(s.amount_paid),0),coalesce(sum(s.amount_due),0),
    coalesce(sum(s.amount_due-s.amount_paid),0),
    count(*) filter(where s.due_date<current_date and s.status<>'paid'),
    a.status
  from public.agreements a
  left join public.schedule_items s on s.agreement_id=a.id
  where a.workspace_id=p_workspace and a.project_id=p_project
    and to_char(date_trunc('month',a.start_date),'YYYY-MM')=p_month
  group by a.id,a.party,a.start_date,a.principal,a.status
  order by a.start_date,a.party;
end;
$$;

create or replace function public.agreements_for_month(p_workspace uuid,p_month text)
returns table(
  agreement_id uuid, customer text, start_date date, principal numeric,
  paid numeric, owed numeric, outstanding numeric, overdue_items bigint, status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare pid uuid; n integer;
begin
  if not public.is_member(p_workspace) then
    raise exception 'Not a member of this business.';
  end if;
  select count(*),(array_agg(bp.id order by bp.created_at))[1]
  into n,pid
  from public.business_projects bp
  join public.business_types bt on bt.code=bp.business_type
  where bp.workspace_id=p_workspace and 'agreements'=any(bt.modules);
  if n<>1 then
    raise exception 'Choose a lending project. Workspace-wide agreement summaries are disabled when multiple lending projects exist.';
  end if;
  return query select * from public.agreements_for_project_month(p_workspace,pid,p_month);
end;
$$;

create or replace function public.business_kpis(p_workspace uuid,p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare pid uuid; n integer;
begin
  if not public.is_member(p_workspace) then
    raise exception 'Not a member of this business.';
  end if;
  select count(*),(array_agg(id order by created_at))[1]
  into n,pid from public.business_projects where workspace_id=p_workspace;
  if n<>1 then
    raise exception 'Select a project to view its KPIs. Portfolio totals across different business types are not calculated as one business.';
  end if;
  return public.project_summary(pid,p_month);
end;
$$;

commit;


-- Project-specific editing and monthly dashboard summaries added 11 Nov 2026.
create index if not exists business_project_records_project_date_idx
  on public.business_project_records (workspace_id, project_id, record_date desc, module_key);

CREATE OR REPLACE FUNCTION public.update_business_project_v2(p_workspace uuid, p_project uuid, p_name text, p_business_type text, p_currency text, p_capital_month numeric, p_capital_year numeric, p_spent numeric, p_spend_period text, p_loan numeric, p_reporting_cycle text, p_profile jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  old_project public.business_projects%rowtype;
  new_currency text := upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  new_type text := coalesce(nullif(trim(p_business_type),''),'general');
  new_cycle text := coalesce(nullif(p_reporting_cycle,''),'monthly');
begin
  if not public.can_edit(p_workspace) then
    raise exception 'You cannot change this business project.';
  end if;
  if p_project is null then raise exception 'Choose a project to update.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter a project name.'; end if;
  if char_length(new_currency)<>3 or new_currency !~ '^[A-Z]{3}$' then
    raise exception 'Enter a valid three-letter currency code.';
  end if;
  if not exists(select 1 from public.business_types where code=new_type) then
    raise exception 'Choose a supported business type.';
  end if;
  if new_cycle not in ('daily','weekly','monthly') then
    raise exception 'Choose a valid reporting cycle.';
  end if;
  if p_profile is not null and jsonb_typeof(p_profile)<>'object' then
    raise exception 'Project configuration must be a JSON object.';
  end if;

  select * into old_project from public.business_projects
  where id=p_project and workspace_id=p_workspace for update;
  if not found then raise exception 'Project not found in this workspace.'; end if;

  if (upper(old_project.currency)<>new_currency or old_project.business_type<>new_type) and (
    exists(select 1 from public.ledger_entries where project_id=p_project)
    or exists(select 1 from public.uploads where project_id=p_project)
    or exists(select 1 from public.agreements where project_id=p_project)
    or exists(select 1 from public.business_project_records where project_id=p_project)
  ) then
    raise exception 'Business type and currency are locked after this project has records. Create a separate project instead.';
  end if;

  update public.business_projects
  set name=trim(p_name),
      business_type=new_type,
      currency=new_currency,
      startup_month=greatest(coalesce(p_capital_month,0),0),
      startup_year=greatest(coalesce(p_capital_year,0),0),
      spent=greatest(coalesce(p_spent,0),0),
      spend_period=case when p_spend_period='year' then 'year' else 'month' end,
      loan=greatest(coalesce(p_loan,0),0),
      reporting_cycle=new_cycle,
      profile=coalesce(p_profile,'{}'::jsonb)
  where id=p_project and workspace_id=p_workspace;

  return p_project;
end;
$function$


revoke all on function public.update_business_project_v2(uuid,uuid,text,text,text,numeric,numeric,numeric,text,numeric,text,jsonb) from public, anon;
grant execute on function public.update_business_project_v2(uuid,uuid,text,text,text,numeric,numeric,numeric,text,numeric,text,jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_project_dashboard_summary(p_workspace uuid, p_project uuid, p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  pr public.business_projects%rowtype;
  m text; start_date date; end_date date;
  base_summary jsonb; operational_summary jsonb; operational_records jsonb;
  inventory_summary jsonb := '[]'::jsonb; agreement_summary jsonb := '{}'::jsonb;
  business_metrics jsonb := '{}'::jsonb; modules text[];
  sales_amount numeric := 0; cogs_amount numeric := 0; stock_purchase_amount numeric := 0;
begin
  if not public.is_member(p_workspace) then raise exception 'You are not a member of this business.'; end if;
  select bp.* into pr from public.business_projects bp
  where bp.id=p_project and bp.workspace_id=p_workspace;
  if not found then raise exception 'Choose a valid business project.'; end if;
  select bt.modules into modules from public.business_types bt where bt.code=pr.business_type;

  m:=coalesce(nullif(p_month,''),to_char(current_date,'YYYY-MM'));
  if m !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a valid reporting month (YYYY-MM).'; end if;
  start_date:=to_date(m||'-01','YYYY-MM-DD'); end_date:=(start_date+interval '1 month')::date;
  base_summary:=public.project_summary(p_project,m);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.module_key,x.record_type),'[]'::jsonb) into operational_summary
  from (
    select module_key,record_type,count(*)::bigint record_count,
      coalesce(sum(amount),0) amount_total,coalesce(sum(quantity),0) quantity_total,
      coalesce(sum(coalesce(quantity,0)*coalesce(unit_cost,0)),0) recorded_cost
    from public.business_project_records
    where workspace_id=p_workspace and project_id=p_project and record_date>=start_date and record_date<end_date
    group by module_key,record_type
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.record_date desc,x.created_at desc),'[]'::jsonb) into operational_records
  from (
    select id,module_key,record_type,record_date,amount,currency,quantity,unit_cost,party,reference,status,data,created_at
    from public.business_project_records
    where workspace_id=p_workspace and project_id=p_project and record_date>=start_date and record_date<end_date
    order by record_date desc,created_at desc limit 100
  ) x;

  if 'inventory'=any(modules) then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.item),'[]'::jsonb) into inventory_summary
    from public.business_project_inventory_summary(p_workspace,p_project) x;
  end if;

  if 'agreements'=any(modules) then
    select jsonb_build_object(
      'agreement_count',(select count(*) from public.agreements a where a.workspace_id=p_workspace and a.project_id=p_project),
      'principal_total',(select coalesce(sum(a.principal),0) from public.agreements a where a.workspace_id=p_workspace and a.project_id=p_project),
      'due_this_month',(select coalesce(sum(s.amount_due),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.due_date>=start_date and s.due_date<end_date),
      'paid_against_month_schedule',(select coalesce(sum(s.amount_paid),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.due_date>=start_date and s.due_date<end_date),
      'outstanding_schedule',(select coalesce(sum(greatest(0,s.amount_due-s.amount_paid)),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project),
      'overdue_schedule',(select coalesce(sum(greatest(0,s.amount_due-s.amount_paid)),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.status<>'paid' and s.due_date<current_date)
    ) into agreement_summary;
  end if;

  select coalesce(sum(amount),0) into sales_amount from public.business_project_records
  where workspace_id=p_workspace and project_id=p_project and module_key in ('sales','pos_sales')
    and record_type in ('sale','pos_sale') and record_date>=start_date and record_date<end_date;
  select coalesce(sum(coalesce(quantity,0)*coalesce(unit_cost,0)),0) into cogs_amount from public.business_project_records
  where workspace_id=p_workspace and project_id=p_project and module_key in ('sales','pos_sales')
    and record_type in ('sale','pos_sale') and record_date>=start_date and record_date<end_date;
  select coalesce(sum(amount),0) into stock_purchase_amount from public.ledger_entries
  where workspace_id=p_workspace and project_id=p_project and entry_date>=start_date and entry_date<end_date
    and coalesce(kind,public.ledger_kind(entry_type,kind))='expense'
    and (coalesce(category,'') ilike '%stock%' or coalesce(category,'') ilike '%inventory%' or entry_type='purchase');

  case pr.business_type
    when 'finance' then business_metrics:=jsonb_build_object(
      'kind','lending','principal_disbursed',coalesce((base_summary->>'month_principal_issued')::numeric,0),
      'principal_repaid',coalesce((base_summary->>'month_principal_repaid')::numeric,0),
      'interest_income',coalesce((base_summary->>'month_interest_income')::numeric,0),
      'receivables_outstanding',coalesce((base_summary->>'recorded_receivables_outstanding')::numeric,0),
      'customer_savings_held',coalesce((base_summary->>'customer_savings_held')::numeric,0),
      'agreement_count',coalesce((agreement_summary->>'agreement_count')::integer,0),
      'scheduled_outstanding',coalesce((agreement_summary->>'outstanding_schedule')::numeric,0),
      'overdue_scheduled_amount',coalesce((agreement_summary->>'overdue_schedule')::numeric,0));
    when 'supermarket' then business_metrics:=jsonb_build_object(
      'kind','retail','pos_sales',sales_amount,'pos_cost_of_goods_recorded',cogs_amount,
      'gross_profit_on_recorded_pos_cost',sales_amount-cogs_amount,'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'stock_on_hand_quantity',coalesce((select sum(quantity_on_hand) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'retail_store' then business_metrics:=jsonb_build_object(
      'kind','retail','sales_recorded',sales_amount,'cost_of_goods_recorded',cogs_amount,
      'gross_profit_on_recorded_cost',sales_amount-cogs_amount,'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'restaurant' then business_metrics:=jsonb_build_object(
      'kind','hospitality','food_sales',sales_amount,'recorded_food_cost',cogs_amount,
      'gross_profit_on_recorded_food_cost',sales_amount-cogs_amount,'stock_purchases',stock_purchase_amount);
    else business_metrics:=jsonb_build_object(
      'kind',pr.business_type,
      'operational_amount',coalesce((select sum(amount) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and record_date>=start_date and record_date<end_date),0),
      'operational_cost',coalesce((select sum(coalesce(quantity,0)*coalesce(unit_cost,0)) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and record_date>=start_date and record_date<end_date),0));
  end case;

  return jsonb_build_object('project_id',pr.id,'project_name',pr.name,'business_type',pr.business_type,
    'currency',pr.currency,'reporting_cycle',pr.reporting_cycle,'month',m,'modules',to_jsonb(modules),
    'financial',base_summary,'operational_summary',operational_summary,'operational_records',operational_records,
    'inventory',inventory_summary,'agreements',agreement_summary,'business_metrics',business_metrics);
end;
$function$


revoke all on function public.business_project_dashboard_summary(uuid,uuid,text) from public, anon;
grant execute on function public.business_project_dashboard_summary(uuid,uuid,text) to authenticated, service_role;


-- Server-side module record validation and inventory waste handling.
CREATE OR REPLACE FUNCTION public.business_add_project_record(p_workspace uuid, p_project uuid, p_module text, p_record_type text, p_date date, p_amount numeric, p_currency text, p_quantity numeric, p_unit_cost numeric, p_party text, p_reference text, p_status text, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid; cur text; mods text[]; allowed_types text[]; record_kind text;
begin
  if not public.can_edit(p_workspace) then raise exception 'You cannot edit this business project.'; end if;
  select bp.id,bp.currency,bt.modules into pid,cur,mods
  from public.business_projects bp join public.business_types bt on bt.code=bp.business_type
  where bp.id=p_project and bp.workspace_id=p_workspace;
  if pid is null then raise exception 'Choose a valid business project.'; end if;
  if not (p_module=any(mods)) then raise exception 'The selected business type does not enable the % module.',p_module; end if;

  record_kind:=lower(coalesce(nullif(trim(p_record_type),''),''));
  allowed_types:=case p_module
    when 'sales' then array['sale','refund','discount']
    when 'pos_sales' then array['pos_sale','pos_refund','cash_variance']
    when 'inventory' then array['stock_in','stock_out','stock_adjustment','stock_waste']
    when 'orders' then array['order','order_refund','order_fulfilment']
    when 'bookings' then array['booking','booking_payment','cancellation']
    when 'payroll' then array['payroll','payroll_tax','staff_advance']
    when 'fees' then array['fee_charged','fee_collected','fee_waiver']
    when 'trips' then array['trip','fuel','vehicle_maintenance']
    when 'expenses' then array['operating_cost','supplier_payment']
    when 'payables' then array['purchase','supplier_payment']
    when 'receivables' then array['invoice_issued','customer_payment']
    when 'production_batches' then array['production_batch','raw_material','finished_goods']
    when 'costing' then array['production_cost','unit_cost_update']
    when 'seasons' then array['season','harvest']
    when 'tenancies' then array['rent_due','rent_received','property_maintenance']
    when 'maintenance' then array['maintenance_job','maintenance_cost']
    when 'contributions' then array['contribution','member_payout']
    when 'payouts' then array['payout','distribution']
    when 'deliveries' then array['delivery','delivery_cost']
    when 'projects' then array['project_milestone','project_cost']
    when 'shifts' then array['shift_open','shift_close','cash_variance']
    when 'expiry' then array['expired_stock','near_expiry_stock']
    when 'collections' then array['collection_received','collection_due','collection_overdue']
    when 'deposits' then array['deposit_received','deposit_refunded','deposit_released']
    when 'cash' then array['cash_opening','cash_closing','cash_variance']
    when 'payment_webhooks' then array['payment_received','payment_refunded','payment_failed']
    else array[]::text[]
  end;
  if not (record_kind=any(allowed_types)) then
    raise exception 'Record type % is not permitted for the % module.',record_kind,p_module;
  end if;
  if (p_amount is not null and p_amount<0) or (p_quantity is not null and p_quantity<0) or (p_unit_cost is not null and p_unit_cost<0) then
    raise exception 'Amounts, quantities and unit costs cannot be negative.';
  end if;
  if p_currency is not null and upper(p_currency)<>upper(cur) then raise exception 'Use this project reporting currency (%).',cur; end if;
  if p_data is not null and jsonb_typeof(p_data)<>'object' then raise exception 'Record details must be a JSON object.'; end if;

  insert into public.business_project_records
    (workspace_id,project_id,module_key,record_type,record_date,amount,currency,quantity,unit_cost,party,reference,status,data,created_by)
  values
    (p_workspace,p_project,p_module,record_kind,coalesce(p_date,current_date),p_amount,cur,p_quantity,p_unit_cost,
     nullif(trim(p_party),''),nullif(trim(p_reference),''),coalesce(nullif(p_status,''),'recorded'),coalesce(p_data,'{}'::jsonb),auth.uid())
  returning id into pid;
  return pid;
end;
$function$


CREATE OR REPLACE FUNCTION public.business_project_inventory_summary(p_workspace uuid, p_project uuid)
 RETURNS TABLE(item text, quantity_in numeric, quantity_out numeric, quantity_adjusted numeric, quantity_on_hand numeric, average_unit_cost numeric, estimated_stock_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if not public.is_member(p_workspace) then raise exception 'You are not a member of this business.';end if;
 if p_project is null or not exists(
  select 1 from public.business_projects bp join public.business_types bt on bt.code=bp.business_type
  where bp.id=p_project and bp.workspace_id=p_workspace and 'inventory'=any(bt.modules)
 ) then raise exception 'Inventory is not enabled for this project.';
 end if;
 return query
 with grouped as (
  select coalesce(nullif(r.reference,''),nullif(r.party,''),'Unlabelled item') item,
   coalesce(sum(r.quantity) filter(where r.record_type='stock_in'),0) qin,
   coalesce(sum(r.quantity) filter(where r.record_type in ('stock_out','stock_waste')),0) qout,
   coalesce(sum(r.quantity) filter(where r.record_type='stock_adjustment'),0) qadj,
   case when coalesce(sum(r.quantity) filter(where r.record_type='stock_in'),0)>0
    then sum(r.quantity*r.unit_cost) filter(where r.record_type='stock_in' and r.unit_cost is not null)
      / nullif(sum(r.quantity) filter(where r.record_type='stock_in' and r.unit_cost is not null),0)
    else 0 end avgcost
  from public.business_project_records r
  where r.workspace_id=p_workspace and r.project_id=p_project and r.module_key='inventory'
  group by 1
 )
 select item,qin,qout,qadj,qin-qout+qadj,avgcost,greatest(0,qin-qout+qadj)*avgcost
 from grouped order by item;
end;
$function$

