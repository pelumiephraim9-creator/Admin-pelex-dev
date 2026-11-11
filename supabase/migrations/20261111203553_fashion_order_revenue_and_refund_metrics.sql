begin;
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
  sales_amount numeric := 0; cogs_amount numeric := 0; stock_purchase_amount numeric := 0; cogs_rows bigint := 0;
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
  select coalesce(sum(coalesce(quantity,0)*coalesce(unit_cost,0)),0),count(*) filter(where unit_cost is not null and quantity is not null) into cogs_amount,cogs_rows from public.business_project_records
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
      'kind','retail','pos_sales',sales_amount,'pos_cost_of_goods_recorded',case when cogs_rows>0 then cogs_amount else null end,
      'gross_profit_on_recorded_pos_cost',case when cogs_rows>0 then sales_amount-cogs_amount else null end,'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'stock_on_hand_quantity',coalesce((select sum(quantity_on_hand) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'retail_store' then business_metrics:=jsonb_build_object(
      'kind','retail','sales_recorded',sales_amount,'cost_of_goods_recorded',case when cogs_rows>0 then cogs_amount else null end,
      'gross_profit_on_recorded_cost',case when cogs_rows>0 then sales_amount-cogs_amount else null end,'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'restaurant' then business_metrics:=jsonb_build_object(
      'kind','hospitality','food_sales',sales_amount,'recorded_food_cost',case when cogs_rows>0 then cogs_amount else null end,
      'gross_profit_on_recorded_food_cost',case when cogs_rows>0 then sales_amount-cogs_amount else null end,'stock_purchases',stock_purchase_amount);
    when 'savings_cooperative' then business_metrics:=jsonb_build_object(
      'kind','cooperative',
      'contributions_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='contributions' and record_type='contribution' and record_date>=start_date and record_date<end_date),
      'member_payouts',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payouts' and record_type in ('payout','distribution') and record_date>=start_date and record_date<end_date),
      'collections_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='collections' and record_type='collection_received' and record_date>=start_date and record_date<end_date),
      'contributors_recorded',(select count(distinct party) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='contributions' and record_type='contribution' and record_date>=start_date and record_date<end_date));
    when 'wholesale' then business_metrics:=jsonb_build_object(
      'kind','wholesale','ledger_operating_revenue',coalesce((base_summary->>'month_income')::numeric,0),
      'stock_purchases',stock_purchase_amount,
      'delivery_count',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='deliveries' and record_type='delivery' and record_date>=start_date and record_date<end_date),
      'delivery_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='deliveries' and record_type='delivery_cost' and record_date>=start_date and record_date<end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'manufacturing' then business_metrics:=jsonb_build_object(
      'kind','manufacturing',
      'production_batches',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='production_batches' and record_type='production_batch' and record_date>=start_date and record_date<end_date),
      'raw_material_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and ((module_key='production_batches' and record_type='raw_material') or (module_key='costing' and record_type='production_cost')) and record_date>=start_date and record_date<end_date),
      'finished_goods_quantity',(select coalesce(sum(quantity),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='production_batches' and record_type='finished_goods' and record_date>=start_date and record_date<end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'pharmacy' then business_metrics:=jsonb_build_object(
      'kind','pharmacy','pos_sales',sales_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'expiry_records',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='expiry' and record_date>=start_date and record_date<end_date),
      'near_expiry_items',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='expiry' and record_type='near_expiry_stock' and record_date>=start_date and record_date<end_date));
    when 'hospitality' then business_metrics:=jsonb_build_object(
      'kind','hospitality',
      'bookings',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='booking' and record_date>=start_date and record_date<end_date),
      'booking_payments',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='booking_payment' and record_date>=start_date and record_date<end_date),
      'cancellations',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='cancellation' and record_date>=start_date and record_date<end_date),
      'maintenance_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='maintenance' and record_date>=start_date and record_date<end_date));
    when 'real_estate' then business_metrics:=jsonb_build_object(
      'kind','property',
      'rent_due',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key in ('tenancies','schedule') and record_type='rent_due' and record_date>=start_date and record_date<end_date),
      'rent_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key in ('tenancies','schedule') and record_type='rent_received' and record_date>=start_date and record_date<end_date),
      'property_maintenance',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='tenancies' and record_type='property_maintenance' and record_date>=start_date and record_date<end_date));
    when 'transport' then business_metrics:=jsonb_build_object(
      'kind','transport',
      'trips_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='trip' and record_date>=start_date and record_date<end_date),
      'fuel_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='fuel' and record_date>=start_date and record_date<end_date),
      'vehicle_maintenance',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='vehicle_maintenance' and record_date>=start_date and record_date<end_date));
    when 'services_agency' then business_metrics:=jsonb_build_object(
      'kind','professional_services',
      'project_milestones',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_milestone' and record_date>=start_date and record_date<end_date),
      'project_costs',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_cost' and record_date>=start_date and record_date<end_date),
      'receivables_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='receivables' and record_type='customer_payment' and record_date>=start_date and record_date<end_date),
      'payroll_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payroll' and record_type='payroll' and record_date>=start_date and record_date<end_date));
    when 'education' then business_metrics:=jsonb_build_object(
      'kind','education',
      'fees_charged',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='fees' and record_type='fee_charged' and record_date>=start_date and record_date<end_date),
      'fees_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='fees' and record_type='fee_collected' and record_date>=start_date and record_date<end_date),
      'scheduled_fee_due',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='schedule' and record_type='fee_due' and record_date>=start_date and record_date<end_date),
      'scheduled_fee_paid',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='schedule' and record_type='fee_payment' and record_date>=start_date and record_date<end_date),
      'payroll_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payroll' and record_type='payroll' and record_date>=start_date and record_date<end_date));
    when 'fashion' then business_metrics:=jsonb_build_object(
      'kind','fashion_retail',
      'sales_revenue',sales_amount,
      'refunds',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='refund' and record_date>=start_date and record_date<end_date),
      'discounts',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='discount' and record_date>=start_date and record_date<end_date),
      'net_sales_after_refunds_and_discounts',sales_amount
        - (select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='refund' and record_date>=start_date and record_date<end_date)
        - (select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='discount' and record_date>=start_date and record_date<end_date),
      'cost_of_goods_recorded',case when cogs_rows>0 then cogs_amount else null end,
      'gross_profit_on_recorded_cost',case when cogs_rows>0 then sales_amount
        - (select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='refund' and record_date>=start_date and record_date<end_date)
        - (select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='sales' and record_type='discount' and record_date>=start_date and record_date<end_date)
        - cogs_amount else null end,
      'orders_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=start_date and record_date<end_date),
      'order_revenue',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=start_date and record_date<end_date),
      'order_refunds',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_refund' and record_date>=start_date and record_date<end_date),
      'net_order_revenue',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=start_date and record_date<end_date)
        - (select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_refund' and record_date>=start_date and record_date<end_date),
      'order_fulfilments',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_fulfilment' and record_date>=start_date and record_date<end_date),
      'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'stock_on_hand_quantity',coalesce((select sum(quantity_on_hand) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'supplier_purchases',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payables' and record_type='purchase' and record_date>=start_date and record_date<end_date));
    when 'ecommerce' then business_metrics:=jsonb_build_object(
      'kind','ecommerce',
      'orders_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=start_date and record_date<end_date),
      'order_revenue',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=start_date and record_date<end_date),
      'refunds',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_refund' and record_date>=start_date and record_date<end_date),
      'fulfilments',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_fulfilment' and record_date>=start_date and record_date<end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'agriculture' then business_metrics:=jsonb_build_object(
      'kind','agriculture',
      'seasons_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='season' and record_date>=start_date and record_date<end_date),
      'harvest_quantity',(select coalesce(sum(quantity),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='harvest' and record_date>=start_date and record_date<end_date),
      'harvest_value',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='harvest' and record_date>=start_date and record_date<end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'construction' then business_metrics:=jsonb_build_object(
      'kind','construction',
      'project_milestones',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_milestone' and record_date>=start_date and record_date<end_date),
      'project_costs',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_cost' and record_date>=start_date and record_date<end_date),
      'receivables_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='receivables' and record_type='customer_payment' and record_date>=start_date and record_date<end_date),
      'supplier_purchases',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payables' and record_type='purchase' and record_date>=start_date and record_date<end_date));
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
;
commit;
