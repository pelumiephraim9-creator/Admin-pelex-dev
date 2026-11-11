-- Align workspace KPI compatibility RPC with the canonical cash-flow / P&L split.
CREATE OR REPLACE FUNCTION public.ledger_kind(e_type text,k text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT coalesce(k,
    CASE WHEN e_type IN ('sale','receipt','invoice','payment') THEN 'income'
         WHEN e_type IN ('expense','purchase','cost') THEN 'expense'
         ELSE 'other' END);
$function$;

CREATE OR REPLACE FUNCTION public.business_kpis(p_workspace uuid,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects;
  cash_in_month numeric; cash_out_month numeric; income_month numeric; expense_month numeric;
  principal_issued numeric; cash_in_total numeric; cash_out_total numeric;
  income_total numeric; expense_total numeric;
  cust_total bigint; cust_new bigint; owed_total numeric; overdue_amt numeric; overdue_cnt bigint; cur text;
BEGIN
  IF NOT public.is_member(p_workspace) THEN RAISE EXCEPTION 'Not a member of this business.'; END IF;
  SELECT * INTO pr FROM public.business_projects WHERE workspace_id=p_workspace ORDER BY created_at LIMIT 1;
  SELECT coalesce(currency,'NGN') INTO cur FROM public.workspace_settings WHERE workspace_id=p_workspace;

  SELECT
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND ledger_kind(entry_type,kind) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind)='income'),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind)='expense'),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind)='principal_out'),0)
  INTO cash_in_month,cash_out_month,income_month,expense_month,principal_issued
  FROM public.ledger_entries
  WHERE workspace_id=p_workspace AND to_char(date_trunc('month',entry_date),'YYYY-MM')=p_month;

  SELECT
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND ledger_kind(entry_type,kind) IN ('income','principal_in','receivable_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind)='income'),0),
    coalesce(sum(amount) FILTER(WHERE ledger_kind(entry_type,kind)='expense'),0)
  INTO cash_in_total,cash_out_total,income_total,expense_total
  FROM public.ledger_entries
  WHERE workspace_id=p_workspace AND to_char(date_trunc('month',entry_date),'YYYY-MM')<=p_month;

  SELECT count(*),count(*) FILTER(WHERE to_char(date_trunc('month',start_date),'YYYY-MM')=p_month)
  INTO cust_total,cust_new FROM public.agreements WHERE workspace_id=p_workspace;
  SELECT coalesce(sum(s.amount_due-s.amount_paid),0) INTO owed_total
  FROM public.schedule_items s JOIN public.agreements a ON a.id=s.agreement_id
  WHERE a.workspace_id=p_workspace AND s.status<>'paid';
  SELECT coalesce(sum(s.amount_due-s.amount_paid),0),count(*) INTO overdue_amt,overdue_cnt
  FROM public.schedule_items s JOIN public.agreements a ON a.id=s.agreement_id
  WHERE a.workspace_id=p_workspace AND s.status<>'paid' AND s.due_date<current_date;

  RETURN jsonb_build_object(
    'month',p_month,'currency',coalesce(cur,pr.currency,'NGN'),
    'foundation',coalesce(pr.startup_year,0),
    'money_in',cash_in_month,'money_out',cash_out_month,
    'income',income_month,'expenses',expense_month,
    'profit',income_month-expense_month,
    'profit_margin_pct',CASE WHEN income_month>0 THEN round((income_month-expense_month)/income_month*100,1) ELSE 0 END,
    'profit_to_date',income_total-expense_total,
    'balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'return_on_investment_pct',CASE WHEN coalesce(pr.startup_year,0)>0 THEN round((income_total-expense_total)/pr.startup_year*100,1) ELSE 0 END,
    'loans_given',principal_issued,
    'customers_total',cust_total,'customers_new_this_month',cust_new,
    'owed_total',owed_total,'overdue_amount',overdue_amt,'overdue_items',overdue_cnt,
    'status',CASE WHEN income_month-expense_month>=0 THEN 'gaining' ELSE 'depreciating' END
  );
END
$function$;

REVOKE ALL ON FUNCTION public.business_kpis(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_kpis(uuid,text) TO authenticated,service_role;
