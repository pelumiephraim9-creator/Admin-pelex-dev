-- Business Agent project-level operational reporting
begin;

create or replace function public.business_project_module_summary(
 p_workspace uuid,p_project uuid,p_from date default null,p_to date default null
)
returns table(
 module_key text,record_type text,record_count bigint,
 amount_total numeric,quantity_total numeric,recorded_cost numeric
)
language plpgsql stable security definer set search_path=public
as $$
begin
 if not public.is_member(p_workspace) then raise exception 'You are not a member of this business.';end if;
 if p_project is null or not exists(select 1 from public.business_projects where id=p_project and workspace_id=p_workspace) then
  raise exception 'Choose a valid business project.';
 end if;
 return query
 select r.module_key,r.record_type,count(*)::bigint,
  coalesce(sum(r.amount),0),coalesce(sum(r.quantity),0),
  coalesce(sum(coalesce(r.quantity,0)*coalesce(r.unit_cost,0)),0)
 from public.business_project_records r
 where r.workspace_id=p_workspace and r.project_id=p_project
  and (p_from is null or r.record_date>=p_from)
  and (p_to is null or r.record_date<=p_to)
 group by r.module_key,r.record_type
 order by r.module_key,r.record_type;
end;
$$;

create or replace function public.business_project_inventory_summary(
 p_workspace uuid,p_project uuid
)
returns table(
 item text,quantity_in numeric,quantity_out numeric,quantity_adjusted numeric,
 quantity_on_hand numeric,average_unit_cost numeric,estimated_stock_value numeric
)
language plpgsql stable security definer set search_path=public
as $$
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
   coalesce(sum(r.quantity) filter(where r.record_type='stock_out'),0) qout,
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
$$;

commit;
