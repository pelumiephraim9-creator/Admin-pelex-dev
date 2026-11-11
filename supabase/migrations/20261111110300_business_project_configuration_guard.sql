-- Prevent reinterpretation of a populated project when its currency or business type is changed.
begin;

create or replace function public.save_setup_project(
 p_workspace uuid,p_name text,p_business_type text,p_currency text,
 p_capital_month numeric,p_capital_year numeric,p_spent numeric,
 p_spend_period text,p_loan numeric
)
returns uuid language plpgsql security definer set search_path=public
as $$
declare pid uuid; cur text; old_cur text; old_type text; new_type text;
begin
 if not public.can_edit(p_workspace) then raise exception 'You cannot change the setup in this workspace.'; end if;
 cur:=upper(coalesce(nullif(trim(p_currency),''),'NGN'));
 new_type:=coalesce(nullif(trim(p_business_type),''),'general');
 if char_length(cur)<>3 or cur !~ '^[A-Z]{3}$' then raise exception 'Enter a valid three-letter currency code.'; end if;
 if not exists(select 1 from public.business_types where code=new_type) then raise exception 'Choose a supported business type.'; end if;
 select bp.id,bp.currency,bp.business_type into pid,old_cur,old_type
 from public.business_projects bp
 where bp.workspace_id=p_workspace and bp.name=coalesce(nullif(trim(p_name),''),'My business')
 limit 1;
 if pid is not null then
  if upper(coalesce(old_cur,''))<>cur and (
    exists(select 1 from public.ledger_entries where project_id=pid)
    or exists(select 1 from public.uploads where project_id=pid)
    or exists(select 1 from public.agreements where project_id=pid)
    or exists(select 1 from public.business_project_records where project_id=pid)
  ) then raise exception 'Currency is locked after this project has records. Create another project for a different currency.'; end if;
  if old_type<>new_type and (
    exists(select 1 from public.ledger_entries where project_id=pid)
    or exists(select 1 from public.uploads where project_id=pid)
    or exists(select 1 from public.agreements where project_id=pid)
    or exists(select 1 from public.business_project_records where project_id=pid)
  ) then raise exception 'Business type is locked after this project has records. Create a new project for a different business type.'; end if;
 end if;
 insert into public.business_projects
  (workspace_id,name,business_type,currency,startup_month,startup_year,spent,spend_period,loan)
 values(p_workspace,coalesce(nullif(trim(p_name),''),'My business'),new_type,cur,
  greatest(coalesce(p_capital_month,0),0),greatest(coalesce(p_capital_year,0),0),
  greatest(coalesce(p_spent,0),0),case when p_spend_period='year' then 'year' else 'month' end,
  greatest(coalesce(p_loan,0),0))
 on conflict(workspace_id,name) do update set
  business_type=excluded.business_type,currency=excluded.currency,
  startup_month=excluded.startup_month,startup_year=excluded.startup_year,
  spent=excluded.spent,spend_period=excluded.spend_period,loan=excluded.loan
 returning id into pid;
 return pid;
end;
$$;

commit;
