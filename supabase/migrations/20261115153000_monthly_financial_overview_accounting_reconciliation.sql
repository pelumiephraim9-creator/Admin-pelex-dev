-- Reconcile monthly operating cash, capital allocation, reserves and fashion product-cost metrics.
-- Existing project setup and ledger rows are not modified.
BEGIN;

CREATE OR REPLACE FUNCTION public.project_summary(p_project uuid, p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects; m text; start_m text; first_entry text;
  month_start date; month_end date;
  cash_in_total numeric:=0; cash_out_total numeric:=0; cash_in_month numeric:=0; cash_out_month numeric:=0;
  income_total numeric:=0; expense_total numeric:=0; income_month numeric:=0; expense_month numeric:=0;
  opening_operating_cash numeric:=0; operating_balance numeric:=0; reserve numeric:=0; closing_cash numeric:=0;
  operating_profit numeric:=0; month_profit numeric:=0; savings_held numeric:=0; monthly_allocation numeric:=0;
  receivables_issued numeric:=0; receivables_collected numeric:=0; receivables_outstanding numeric:=0;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  m:=coalesce(nullif(p_month,''),to_char(current_date,'YYYY-MM'));
  IF m !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Choose a valid reporting month (YYYY-MM).'; END IF;
  month_start:=to_date(m||'-01','YYYY-MM-DD');
  month_end:=(month_start+interval '1 month')::date;
  SELECT to_char(min(entry_date),'YYYY-MM') INTO first_entry
  FROM public.ledger_entries WHERE project_id=p_project AND upper(currency)=upper(pr.currency);
  start_m:=to_char(pr.created_at,'YYYY-MM');
  IF first_entry IS NOT NULL AND first_entry<start_m THEN start_m:=first_entry; END IF;

  IF m<start_m THEN
    RETURN jsonb_build_object(
      'name',pr.name,'business_type',pr.business_type,'currency',pr.currency,'month',m,
      'not_started',true,'start_month',start_m,
      'foundation',coalesce(pr.startup_year,0),'startup_year',coalesce(pr.startup_year,0),
      'startup_month',0,'monthly_capital_allocation',0,'reserve_balance',0,'standby_reserve',0,
      'total_out',0,'total_in',0,'profit',0,'balance',0,'opening_startup',0,
      'month_in',0,'month_out',0,'month_operating_balance',0,'month_income',0,'month_expenses',0,
      'month_profit',0,'month_closing',0,'month_receivables_issued',0,'month_receivables_collected',0,
      'recorded_receivables_outstanding',0,'customer_savings_held',0,'status','not started',
      'money_in',0,'money_out',0,'income',0,'expenses',0,'net',0,'closing_balance',0,
      'setup_spent',0,'setup_spend_period',pr.spend_period,'setup_loan',coalesce(pr.loan,0),
      'spent',0,'spend_period',pr.spend_period,'loan',coalesce(pr.loan,0));
  END IF;

  SELECT
    coalesce(sum(amount) FILTER(WHERE public.ledger_kind(entry_type,kind) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE public.ledger_kind(entry_type,kind) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE entry_date>=month_start AND entry_date<month_end
      AND public.ledger_kind(entry_type,kind) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE entry_date>=month_start AND entry_date<month_end
      AND public.ledger_kind(entry_type,kind) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE public.ledger_kind(entry_type,kind)='income'),0),
    coalesce(sum(amount) FILTER(WHERE public.ledger_kind(entry_type,kind)='expense'),0),
    coalesce(sum(amount) FILTER(WHERE entry_date>=month_start AND entry_date<month_end
      AND public.ledger_kind(entry_type,kind)='income'),0),
    coalesce(sum(amount) FILTER(WHERE entry_date>=month_start AND entry_date<month_end
      AND public.ledger_kind(entry_type,kind)='expense'),0),
    coalesce(sum(amount) FILTER(WHERE public.ledger_kind(entry_type,kind)='savings_in'),0) -
      coalesce(sum(amount) FILTER(WHERE kind='transfer' AND party LIKE 'Savings released to complete loan:%'),0),
    coalesce(sum(amount) FILTER(WHERE entry_type='invoice' AND coalesce(kind,'')<>'income'
      AND entry_date>=month_start AND entry_date<month_end),0),
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND kind='receivable_in'
      AND entry_date>=month_start AND entry_date<month_end),0),
    greatest(0,
      coalesce(sum(amount) FILTER(WHERE entry_type='invoice' AND coalesce(kind,'')<>'income' AND entry_date<month_end),0) -
      coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND kind='receivable_in' AND entry_date<month_end),0))
  INTO cash_in_total,cash_out_total,cash_in_month,cash_out_month,
    income_total,expense_total,income_month,expense_month,savings_held,
    receivables_issued,receivables_collected,receivables_outstanding
  FROM public.ledger_entries
  WHERE project_id=p_project AND upper(currency)=upper(pr.currency) AND entry_date<month_end;

  monthly_allocation:=coalesce(pr.startup_month,0);
  reserve:=greatest(coalesce(pr.startup_year,0)-coalesce(pr.startup_month,0),0);
  opening_operating_cash:=monthly_allocation+(cash_in_total-cash_in_month)-(cash_out_total-cash_out_month);
  operating_balance:=opening_operating_cash+cash_in_month-cash_out_month;
  closing_cash:=operating_balance+reserve;
  operating_profit:=income_total-expense_total;
  month_profit:=income_month-expense_month;

  RETURN jsonb_build_object(
    'name',pr.name,'business_type',pr.business_type,'currency',pr.currency,'month',m,
    'not_started',false,'start_month',start_m,'foundation',coalesce(pr.startup_year,0),
    'startup_year',coalesce(pr.startup_year,0),'startup_month',monthly_allocation,
    'monthly_capital_allocation',monthly_allocation,'reserve_balance',reserve,'standby_reserve',reserve,
    'total_out',cash_out_total,'total_in',cash_in_total,'profit',operating_profit,'balance',closing_cash,
    'opening_startup',opening_operating_cash,'month_in',cash_in_month,'month_out',cash_out_month,
    'month_operating_balance',operating_balance,'month_income',income_month,'month_expenses',expense_month,
    'month_profit',month_profit,'month_closing',closing_cash,'customer_savings_held',savings_held,
    'month_receivables_issued',receivables_issued,'month_receivables_collected',receivables_collected,
    'recorded_receivables_outstanding',receivables_outstanding,
    'status',CASE WHEN operating_profit>=0 THEN 'gaining' ELSE 'depreciating' END,
    'money_in',cash_in_month,'money_out',cash_out_month,'income',income_month,'expenses',expense_month,
    'net',month_profit,'closing_balance',closing_cash,
    'setup_spent',coalesce(pr.spent,0),'setup_spend_period',pr.spend_period,'setup_loan',coalesce(pr.loan,0),
    'spent',coalesce(pr.spent,0),'spend_period',pr.spend_period,'loan',coalesce(pr.loan,0));
END
$function$


CREATE OR REPLACE FUNCTION public.project_months(p_project uuid)
 RETURNS TABLE(month text, money_in numeric, money_out numeric, profit numeric, opening numeric, closing numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects;
BEGIN
 SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
 IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
 RETURN QUERY
 WITH monthly AS (
  SELECT to_char(date_trunc('month',le.entry_date),'YYYY-MM') mon,
   coalesce(sum(le.amount) FILTER(WHERE public.ledger_kind(le.entry_type,le.kind) IN
    ('income','principal_in','receivable_in','savings_in','capital')),0) cash_in,
   coalesce(sum(le.amount) FILTER(WHERE public.ledger_kind(le.entry_type,le.kind) IN
    ('expense','principal_out','transfer')),0) cash_out,
   coalesce(sum(le.amount) FILTER(WHERE public.ledger_kind(le.entry_type,le.kind)='income'),0) -
   coalesce(sum(le.amount) FILTER(WHERE public.ledger_kind(le.entry_type,le.kind)='expense'),0) operating_profit
  FROM public.ledger_entries le
  WHERE le.project_id=p_project AND upper(le.currency)=upper(pr.currency) GROUP BY 1
 ), running AS (
  SELECT mon,cash_in,cash_out,operating_profit,
   coalesce(sum(cash_in-cash_out) OVER(ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior_cash_net,
   cash_in-cash_out current_cash_net FROM monthly
 )
 SELECT r.mon,r.cash_in,r.cash_out,r.operating_profit,
  coalesce(pr.startup_month,0)+r.prior_cash_net,
  coalesce(pr.startup_month,0)+r.prior_cash_net+r.current_cash_net+
    greatest(coalesce(pr.startup_year,0)-coalesce(pr.startup_month,0),0),
  CASE WHEN r.operating_profit>=0 THEN 'gaining' ELSE 'depreciating' END
 FROM running r ORDER BY r.mon;
END
$function$


CREATE OR REPLACE FUNCTION public.business_project_dashboard_summary(p_workspace uuid, p_project uuid, p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  pr public.business_projects%rowtype;
  m text; v_start_date date; v_end_date date;
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
  v_start_date:=to_date(m||'-01','YYYY-MM-DD'); v_end_date:=(v_start_date+interval '1 month')::date;
  base_summary:=public.project_summary(p_project,m);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.module_key,x.record_type),'[]'::jsonb) into operational_summary
  from (
    select module_key,record_type,count(*)::bigint record_count,
      coalesce(sum(amount),0) amount_total,coalesce(sum(quantity),0) quantity_total,
      coalesce(sum(coalesce(quantity,0)*coalesce(unit_cost,0)),0) recorded_cost
    from public.business_project_records
    where workspace_id=p_workspace and project_id=p_project and record_date>=v_start_date and record_date<v_end_date
    group by module_key,record_type
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.record_date desc,x.created_at desc),'[]'::jsonb) into operational_records
  from (
    select id,module_key,record_type,record_date,amount,currency,quantity,unit_cost,party,reference,status,data,created_at
    from public.business_project_records
    where workspace_id=p_workspace and project_id=p_project and record_date>=v_start_date and record_date<v_end_date
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
      'due_this_month',(select coalesce(sum(s.amount_due),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.due_date>=v_start_date and s.due_date<v_end_date),
      'paid_against_month_schedule',(select coalesce(sum(s.amount_paid),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.due_date>=v_start_date and s.due_date<v_end_date),
      'outstanding_schedule',(select coalesce(sum(greatest(0,s.amount_due-s.amount_paid)),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project),
      'overdue_schedule',(select coalesce(sum(greatest(0,s.amount_due-s.amount_paid)),0) from public.schedule_items s join public.agreements a on a.id=s.agreement_id where a.workspace_id=p_workspace and a.project_id=p_project and s.status<>'paid' and s.due_date<current_date)
    ) into agreement_summary;
  end if;

  select coalesce(sum(amount),0) into sales_amount from public.business_project_records
  where workspace_id=p_workspace and project_id=p_project and module_key in ('sales','pos_sales')
    and record_type in ('sale','pos_sale') and record_date>=v_start_date and record_date<v_end_date;
  select coalesce(sum(coalesce(quantity,0)*coalesce(unit_cost,0)),0),count(*) filter(where unit_cost is not null and quantity is not null) into cogs_amount,cogs_rows from public.business_project_records
  where workspace_id=p_workspace and project_id=p_project and module_key in ('sales','pos_sales')
    and record_type in ('sale','pos_sale') and record_date>=v_start_date and record_date<v_end_date;
  select coalesce(sum(amount),0) into stock_purchase_amount from public.ledger_entries
  where workspace_id=p_workspace and project_id=p_project and entry_date>=v_start_date and entry_date<v_end_date
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
      'contributions_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='contributions' and record_type='contribution' and record_date>=v_start_date and record_date<v_end_date),
      'member_payouts',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payouts' and record_type in ('payout','distribution') and record_date>=v_start_date and record_date<v_end_date),
      'collections_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='collections' and record_type='collection_received' and record_date>=v_start_date and record_date<v_end_date),
      'contributors_recorded',(select count(distinct party) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='contributions' and record_type='contribution' and record_date>=v_start_date and record_date<v_end_date));
    when 'wholesale' then business_metrics:=jsonb_build_object(
      'kind','wholesale','ledger_operating_revenue',coalesce((base_summary->>'month_income')::numeric,0),
      'stock_purchases',stock_purchase_amount,
      'delivery_count',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='deliveries' and record_type='delivery' and record_date>=v_start_date and record_date<v_end_date),
      'delivery_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='deliveries' and record_type='delivery_cost' and record_date>=v_start_date and record_date<v_end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'manufacturing' then business_metrics:=jsonb_build_object(
      'kind','manufacturing',
      'production_batches',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='production_batches' and record_type='production_batch' and record_date>=v_start_date and record_date<v_end_date),
      'raw_material_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and ((module_key='production_batches' and record_type='raw_material') or (module_key='costing' and record_type='production_cost')) and record_date>=v_start_date and record_date<v_end_date),
      'finished_goods_quantity',(select coalesce(sum(quantity),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='production_batches' and record_type='finished_goods' and record_date>=v_start_date and record_date<v_end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'pharmacy' then business_metrics:=jsonb_build_object(
      'kind','pharmacy','pos_sales',sales_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0),
      'expiry_records',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='expiry' and record_date>=v_start_date and record_date<v_end_date),
      'near_expiry_items',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='expiry' and record_type='near_expiry_stock' and record_date>=v_start_date and record_date<v_end_date));
    when 'hospitality' then business_metrics:=jsonb_build_object(
      'kind','hospitality',
      'bookings',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='booking' and record_date>=v_start_date and record_date<v_end_date),
      'booking_payments',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='booking_payment' and record_date>=v_start_date and record_date<v_end_date),
      'cancellations',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='bookings' and record_type='cancellation' and record_date>=v_start_date and record_date<v_end_date),
      'maintenance_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='maintenance' and record_date>=v_start_date and record_date<v_end_date));
    when 'real_estate' then business_metrics:=jsonb_build_object(
      'kind','property',
      'rent_due',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key in ('tenancies','schedule') and record_type='rent_due' and record_date>=v_start_date and record_date<v_end_date),
      'rent_received',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key in ('tenancies','schedule') and record_type='rent_received' and record_date>=v_start_date and record_date<v_end_date),
      'property_maintenance',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='tenancies' and record_type='property_maintenance' and record_date>=v_start_date and record_date<v_end_date));
    when 'transport' then business_metrics:=jsonb_build_object(
      'kind','transport',
      'trips_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='trip' and record_date>=v_start_date and record_date<v_end_date),
      'fuel_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='fuel' and record_date>=v_start_date and record_date<v_end_date),
      'vehicle_maintenance',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='trips' and record_type='vehicle_maintenance' and record_date>=v_start_date and record_date<v_end_date));
    when 'services_agency' then business_metrics:=jsonb_build_object(
      'kind','professional_services',
      'project_milestones',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_milestone' and record_date>=v_start_date and record_date<v_end_date),
      'project_costs',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_cost' and record_date>=v_start_date and record_date<v_end_date),
      'receivables_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='receivables' and record_type='customer_payment' and record_date>=v_start_date and record_date<v_end_date),
      'payroll_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payroll' and record_type='payroll' and record_date>=v_start_date and record_date<v_end_date));
    when 'education' then business_metrics:=jsonb_build_object(
      'kind','education',
      'fees_charged',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='fees' and record_type='fee_charged' and record_date>=v_start_date and record_date<v_end_date),
      'fees_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='fees' and record_type='fee_collected' and record_date>=v_start_date and record_date<v_end_date),
      'scheduled_fee_due',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='schedule' and record_type='fee_due' and record_date>=v_start_date and record_date<v_end_date),
      'scheduled_fee_paid',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='schedule' and record_type='fee_payment' and record_date>=v_start_date and record_date<v_end_date),
      'payroll_cost',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payroll' and record_type='payroll' and record_date>=v_start_date and record_date<v_end_date));
    when 'ecommerce' then business_metrics:=jsonb_build_object(
      'kind','ecommerce',
      'orders_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=v_start_date and record_date<v_end_date),
      'order_revenue',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order' and record_date>=v_start_date and record_date<v_end_date),
      'refunds',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_refund' and record_date>=v_start_date and record_date<v_end_date),
      'fulfilments',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='orders' and record_type='order_fulfilment' and record_date>=v_start_date and record_date<v_end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'agriculture' then business_metrics:=jsonb_build_object(
      'kind','agriculture',
      'seasons_recorded',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='season' and record_date>=v_start_date and record_date<v_end_date),
      'harvest_quantity',(select coalesce(sum(quantity),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='harvest' and record_date>=v_start_date and record_date<v_end_date),
      'harvest_value',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='seasons' and record_type='harvest' and record_date>=v_start_date and record_date<v_end_date),
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    when 'construction' then business_metrics:=jsonb_build_object(
      'kind','construction',
      'project_milestones',(select count(*) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_milestone' and record_date>=v_start_date and record_date<v_end_date),
      'project_costs',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='projects' and record_type='project_cost' and record_date>=v_start_date and record_date<v_end_date),
      'receivables_collected',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='receivables' and record_type='customer_payment' and record_date>=v_start_date and record_date<v_end_date),
      'supplier_purchases',(select coalesce(sum(amount),0) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and module_key='payables' and record_type='purchase' and record_date>=v_start_date and record_date<v_end_date));
    when 'fashion' then business_metrics:=jsonb_build_object(
      'kind','fashion',
      'sales_recorded',sales_amount,
      'recorded_product_cost',case when cogs_rows>0 then cogs_amount else null end,
      'stock_purchases',stock_purchase_amount,
      'stock_on_hand_value',coalesce((select sum(estimated_stock_value) from public.business_project_inventory_summary(p_workspace,p_project)),0));
    else business_metrics:=jsonb_build_object(
      'kind',pr.business_type,
      'operational_amount',coalesce((select sum(amount) from public.business_project_records where workspace_id=p_workspace and project_id=p_project and record_date>=v_start_date and record_date<v_end_date),0));
  end case;

  return jsonb_build_object('project_id',pr.id,'project_name',pr.name,'business_type',pr.business_type,
    'currency',pr.currency,'reporting_cycle',pr.reporting_cycle,'month',m,'modules',to_jsonb(modules),
    'financial',base_summary,'operational_summary',operational_summary,'operational_records',operational_records,
    'inventory',inventory_summary,'agreements',agreement_summary,'business_metrics',business_metrics);
end;
$function$


COMMIT;
