CREATE OR REPLACE FUNCTION public.project_month_breakdown(p_project uuid, p_month text)
 RETURNS TABLE(cat_name text, dir_name text, entries bigint, total_amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  RETURN QUERY
  SELECT coalesce(nullif(le.category,''),CASE WHEN le.kind IS NULL AND le.entry_type='receipt' THEN 'Unclassified receipts - review' ELSE CASE coalesce(nullif(le.kind,''),public.ledger_kind(le.entry_type,le.kind))
    WHEN 'income' THEN 'Operating income' WHEN 'receivable_in' THEN 'Invoice payments received'
    WHEN 'principal_in' THEN 'Loan principal repaid' WHEN 'expense' THEN 'Operating expenses'
    WHEN 'principal_out' THEN 'Loans issued' WHEN 'savings_in' THEN 'Customer savings held'
    WHEN 'capital' THEN 'Owner capital' ELSE 'Cash transfers' END END),
    CASE WHEN coalesce(nullif(le.kind,''),public.ledger_kind(le.entry_type,le.kind)) IN ('income','principal_in','receivable_in','savings_in','capital') THEN 'in' ELSE 'out' END,
    count(*),sum(le.amount)
  FROM public.ledger_entries le
  WHERE le.project_id=p_project AND upper(le.currency)=upper(pr.currency) AND to_char(date_trunc('month',le.entry_date),'YYYY-MM')=p_month
    AND coalesce(nullif(le.kind,''),public.ledger_kind(le.entry_type,le.kind)) IN ('income','receivable_in','principal_in','expense','principal_out','savings_in','capital','transfer')
  GROUP BY 1,2 ORDER BY 2,1;
END $function$;

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
  WITH m AS (
    SELECT to_char(date_trunc('month',entry_date),'YYYY-MM') mon,
      coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0) ci,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0) co,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income' AND NOT (kind IS NULL AND entry_type='receipt')),0) ri,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0) re
    FROM public.ledger_entries WHERE project_id=p_project AND upper(currency)=upper(pr.currency) GROUP BY 1
  ), r AS (
    SELECT mon,ci,co,ri-re pf,
      sum(ci-co) OVER(ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cash_cum,
      sum(ci-co) OVER(ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) cash_before
    FROM m
  )
  SELECT r.mon,r.ci,r.co,r.pf,coalesce(pr.startup_year,0)+coalesce(r.cash_before,0),
    coalesce(pr.startup_year,0)+coalesce(r.cash_cum,0),
    CASE WHEN r.pf>=0 THEN 'gaining' ELSE 'depreciating' END
  FROM r ORDER BY r.mon;
END $function$;

CREATE OR REPLACE FUNCTION public.project_summary(p_project uuid, p_month text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects; m text;
  rev_total numeric; exp_total numeric; rev_month numeric; exp_month numeric;
  cash_in_total numeric; cash_out_total numeric; cash_in_month numeric; cash_out_month numeric;
  cash_before numeric; cash_after numeric; savings_held numeric;
  principal_issued numeric; principal_repaid numeric; invoices_issued numeric;
  receivable_collected numeric; receivable_open numeric; interest_received numeric;
  savings_received numeric;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  m:=coalesce(nullif(p_month,''),to_char(current_date,'YYYY-MM'));
  SELECT
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income' AND NOT (kind IS NULL AND entry_type='receipt')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income' AND NOT (kind IS NULL AND entry_type='receipt')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0)
      - coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='savings_in'),0)
      - coalesce(sum(amount) FILTER(WHERE kind='transfer' AND party LIKE 'Savings released to complete loan:%'),0)
  INTO rev_total,exp_total,cash_in_total,cash_out_total,rev_month,exp_month,cash_in_month,cash_out_month,cash_before,savings_held
  FROM public.ledger_entries WHERE project_id=p_project AND upper(currency)=upper(pr.currency) AND to_char(date_trunc('month',entry_date),'YYYY-MM')<=m;
  cash_after:=coalesce(pr.startup_year,0)+cash_before+cash_in_month-cash_out_month;
  SELECT
    coalesce(sum(amount) FILTER(WHERE kind='principal_out'),0),
    coalesce(sum(amount) FILTER(WHERE kind='principal_in'),0),
    coalesce(sum(amount) FILTER(WHERE entry_type='invoice'),0),
    coalesce(sum(amount) FILTER(WHERE kind='receivable_in'),0),
    coalesce(sum(amount) FILTER(WHERE kind='income' AND coalesce(category,'') ILIKE '%interest%'),0),
    coalesce(sum(amount) FILTER(WHERE kind='savings_in'),0)
  INTO principal_issued,principal_repaid,invoices_issued,receivable_collected,interest_received,savings_received
  FROM public.ledger_entries
  WHERE project_id=p_project AND upper(currency)=upper(pr.currency) AND to_char(date_trunc('month',entry_date),'YYYY-MM')=m;
  SELECT greatest(0,
    coalesce(sum(amount) FILTER(WHERE entry_type='invoice'),0) -
    coalesce(sum(amount) FILTER(WHERE kind='receivable_in'),0))
  INTO receivable_open
  FROM public.ledger_entries
  WHERE project_id=p_project AND upper(currency)=upper(pr.currency) AND to_char(date_trunc('month',entry_date),'YYYY-MM')<=m;
  RETURN jsonb_build_object('name',pr.name,'business_type',pr.business_type,'currency',pr.currency,'month',m,
    'foundation',coalesce(pr.startup_year,0),'startup_year',coalesce(pr.startup_year,0),'startup_month',coalesce(pr.startup_month,0),'setup_spent',coalesce(pr.spent,0),'setup_spend_period',pr.spend_period,'setup_loan',coalesce(pr.loan,0),
    'total_out',cash_out_total,'total_in',cash_in_total,'profit',rev_total-exp_total,
    'balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'opening_startup',coalesce(pr.startup_year,0)+cash_before,'month_in',cash_in_month,'month_out',cash_out_month,
    'month_income',rev_month,'month_expenses',exp_month,'month_profit',rev_month-exp_month,
    'month_closing',cash_after,'customer_savings_held',savings_held,
    'month_principal_issued',principal_issued,'month_principal_repaid',principal_repaid,
    'month_receivables_issued',invoices_issued,'month_receivables_collected',receivable_collected,
    'recorded_receivables_outstanding',receivable_open,'month_interest_income',interest_received,
    'month_customer_savings_received',savings_received,
    'status',case when rev_total-exp_total>=0 then 'gaining' else 'depreciating' end,
    'money_in',cash_in_month,'money_out',cash_out_month,'income',rev_total,'expenses',exp_total,'net',rev_total-exp_total,
    'closing_balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'spent',pr.spent,'spend_period',pr.spend_period,'loan',pr.loan);
END $function$;

REVOKE ALL ON FUNCTION public.agreements_for_month(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agreements_for_month(uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.agreements_for_month(uuid,text) TO authenticated;

WITH sole_project AS (SELECT workspace_id,min(id::text)::uuid AS project_id,min(upper(currency)) AS currency FROM public.business_projects GROUP BY workspace_id HAVING count(*)=1) UPDATE public.ledger_entries le SET project_id=sp.project_id FROM sole_project sp WHERE le.workspace_id=sp.workspace_id AND le.project_id IS NULL AND upper(le.currency)=sp.currency;