-- Expose monthly lending movements and outstanding receivables without treating principal as P&L.
CREATE OR REPLACE FUNCTION public.project_summary(p_project uuid,p_month text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects; m text;
  rev_total numeric; exp_total numeric; rev_month numeric; exp_month numeric;
  cash_in_total numeric; cash_out_total numeric; cash_in_month numeric; cash_out_month numeric;
  cash_before numeric; cash_after numeric; savings_held numeric;
  month_principal_issued numeric; month_principal_repaid numeric; month_interest_income numeric;
  month_capital numeric; receivables numeric; loan_receivable numeric;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  m:=coalesce(nullif(p_month,''),to_char(current_date,'YYYY-MM'));
  SELECT
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income'),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','receivable_in','savings_in','capital')),0)
      - coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='savings_in'),0)
      - coalesce(sum(amount) FILTER(WHERE kind='transfer' AND party LIKE 'Savings released to complete loan:%'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND kind='principal_out'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND kind='principal_in'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND kind='income' AND lower(coalesce(category,'')) LIKE '%interest%'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND kind='capital'),0),
    greatest(0,coalesce(sum(amount) FILTER(WHERE entry_type='invoice'),0)-coalesce(sum(amount) FILTER(WHERE kind='receivable_in'),0)),
    greatest(0,coalesce(sum(amount) FILTER(WHERE kind='principal_out'),0)-coalesce(sum(amount) FILTER(WHERE kind='principal_in'),0))
  INTO rev_total,exp_total,cash_in_total,cash_out_total,rev_month,exp_month,cash_in_month,cash_out_month,cash_before,savings_held,
       month_principal_issued,month_principal_repaid,month_interest_income,month_capital,receivables,loan_receivable
  FROM public.ledger_entries WHERE project_id=p_project AND to_char(date_trunc('month',entry_date),'YYYY-MM')<=m;
  cash_after:=coalesce(pr.startup_year,0)+cash_before+cash_in_month-cash_out_month;
  RETURN jsonb_build_object(
    'name',pr.name,'business_type',pr.business_type,'currency',pr.currency,'month',m,
    'foundation',coalesce(pr.startup_year,0),'startup_year',coalesce(pr.startup_year,0),
    'total_out',cash_out_total,'total_in',cash_in_total,'profit',rev_total-exp_total,
    'balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'opening_startup',coalesce(pr.startup_year,0)+cash_before,'month_in',cash_in_month,'month_out',cash_out_month,
    'month_profit',rev_month-exp_month,'month_income',rev_month,'month_expenses',exp_month,
    'month_principal_issued',month_principal_issued,'month_principal_repaid',month_principal_repaid,
    'month_interest_income',month_interest_income,'month_capital_introduced',month_capital,
    'receivables_outstanding',receivables,'loan_receivable_outstanding',loan_receivable,
    'month_closing',cash_after,'customer_savings_held',savings_held,
    'status',case when rev_total-exp_total>=0 then 'gaining' else 'depreciating' end,
    'money_in',cash_in_month,'money_out',cash_out_month,'income',rev_total,'expenses',exp_total,'net',rev_total-exp_total,
    'closing_balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'spent',pr.spent,'spend_period',pr.spend_period,'loan',pr.loan);
END $function$;

REVOKE ALL ON FUNCTION public.project_summary(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_summary(uuid,text) TO authenticated,service_role;
