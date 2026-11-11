-- Stage 1/2: safe transaction register, explicit project ownership, and cash-vs-profit reporting.
-- Additive and non-destructive: existing ledger rows are not reclassified or deleted.

CREATE OR REPLACE FUNCTION public.save_setup_project(
  p_workspace uuid, p_name text, p_business_type text, p_currency text,
  p_capital_month numeric, p_capital_year numeric, p_spent numeric,
  p_spend_period text, p_loan numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid uuid; cur text;
BEGIN
  IF NOT public.can_edit(p_workspace) THEN
    RAISE EXCEPTION 'You cannot change the setup in this workspace.';
  END IF;
  cur := upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  IF char_length(cur) <> 3 OR cur !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Enter a valid three-letter currency code.';
  END IF;
  INSERT INTO public.business_projects
    (workspace_id,name,business_type,currency,startup_month,startup_year,spent,spend_period,loan)
  VALUES
    (p_workspace,coalesce(nullif(trim(p_name),''),'My business'),
     coalesce(nullif(trim(p_business_type),''),'general'),cur,
     greatest(coalesce(p_capital_month,0),0),greatest(coalesce(p_capital_year,0),0),
     greatest(coalesce(p_spent,0),0),
     CASE WHEN p_spend_period='year' THEN 'year' ELSE 'month' END,
     greatest(coalesce(p_loan,0),0))
  ON CONFLICT (workspace_id,name) DO UPDATE SET
    business_type=excluded.business_type,currency=excluded.currency,
    startup_month=excluded.startup_month,startup_year=excluded.startup_year,
    spent=excluded.spent,spend_period=excluded.spend_period,loan=excluded.loan
  RETURNING id INTO pid;
  -- Never delete setup-origin ledger entries when setup is edited.
  RETURN pid;
END
$function$;

CREATE OR REPLACE FUNCTION public.link_ledger_to_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE project_count integer; only_project uuid;
BEGIN
  IF NEW.project_id IS NULL
     AND (NEW.kind IS NOT NULL OR NEW.entry_type IN ('sale','receipt','invoice','payment','expense','purchase','cost'))
     AND (NEW.source_key IS NULL OR NEW.source_key NOT LIKE 'setup:%') THEN
    SELECT count(*), (array_agg(id ORDER BY created_at))[1]
      INTO project_count, only_project
      FROM public.business_projects WHERE workspace_id=NEW.workspace_id;
    -- Only auto-link when there is exactly one possible project; never guess across projects.
    IF project_count=1 THEN NEW.project_id := only_project; END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.business_list_transactions(
  p_workspace uuid, p_project uuid DEFAULT NULL, p_from date DEFAULT NULL,
  p_to date DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 500
)
RETURNS TABLE(
  id bigint, entry_date date, entry_type text, kind text, amount numeric,
  currency text, party text, category text, due_date date, project_id uuid,
  upload_id uuid, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_member(p_workspace) THEN
    RAISE EXCEPTION 'You are not a member of this business.';
  END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_projects
    WHERE id=p_project AND workspace_id=p_workspace
  ) THEN RAISE EXCEPTION 'Choose a project in this business.'; END IF;
  RETURN QUERY
  SELECT le.id,le.entry_date,le.entry_type,le.kind,le.amount,le.currency,
         le.party,le.category,le.due_date,le.project_id,le.upload_id,le.created_at
  FROM public.ledger_entries le
  WHERE le.workspace_id=p_workspace
    AND (p_project IS NULL OR le.project_id=p_project)
    AND (p_from IS NULL OR le.entry_date>=p_from)
    AND (p_to IS NULL OR le.entry_date<=p_to)
    AND (nullif(trim(p_search),'') IS NULL OR
         concat_ws(' ',le.party,le.category,le.entry_type,le.kind,le.source_key) ILIKE '%'||trim(p_search)||'%')
  ORDER BY le.entry_date DESC,le.id DESC
  LIMIT greatest(1,least(coalesce(p_limit,500),1000));
END
$function$;

CREATE OR REPLACE FUNCTION public.business_add_transaction(
  p_workspace uuid, p_project uuid, p_entry_type text, p_kind text,
  p_amount numeric, p_date date, p_party text, p_currency text,
  p_category text DEFAULT NULL, p_due_date date DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE eid bigint; project_to_use uuid; cur text; et text; k text;
BEGIN
  IF NOT public.can_edit(p_workspace) THEN RAISE EXCEPTION 'You cannot add transactions to this business.'; END IF;
  et:=lower(coalesce(p_entry_type,'')); k:=lower(coalesce(p_kind,''));
  IF et NOT IN ('invoice','receipt','sale','expense','payment','other') THEN RAISE EXCEPTION 'Choose a valid transaction type.'; END IF;
  IF k NOT IN ('income','expense','principal_in','principal_out','savings_in','transfer','capital') THEN RAISE EXCEPTION 'Choose a valid accounting classification.'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Amount must be greater than zero.'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Transaction date is required.'; END IF;
  cur:=upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  IF char_length(cur)<>3 OR cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Enter a valid three-letter currency code.'; END IF;
  IF p_project IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.business_projects WHERE id=p_project AND workspace_id=p_workspace) THEN
      RAISE EXCEPTION 'Choose a project in this business.';
    END IF;
    project_to_use:=p_project;
  ELSE
    SELECT id INTO project_to_use FROM public.business_projects WHERE workspace_id=p_workspace ORDER BY created_at LIMIT 1;
    IF (SELECT count(*) FROM public.business_projects WHERE workspace_id=p_workspace)>1 THEN
      RAISE EXCEPTION 'Choose the project for this transaction.';
    END IF;
  END IF;
  INSERT INTO public.ledger_entries
    (workspace_id,project_id,entry_date,entry_type,amount,currency,party,kind,category,due_date,created_by)
  VALUES
    (p_workspace,project_to_use,p_date,et,p_amount,cur,
     left(coalesce(nullif(trim(p_party),''),'Manual transaction'),160),
     k,nullif(trim(coalesce(p_category,'')),''),p_due_date,auth.uid())
  RETURNING id INTO eid;
  RETURN eid;
END
$function$;

CREATE OR REPLACE FUNCTION public.business_update_transaction(
  p_workspace uuid, p_entry_id bigint, p_entry_type text, p_kind text,
  p_amount numeric, p_date date, p_party text, p_currency text,
  p_category text DEFAULT NULL, p_due_date date DEFAULT NULL, p_project uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE eid bigint; cur text; et text; k text;
BEGIN
  IF NOT public.can_edit(p_workspace) THEN RAISE EXCEPTION 'You cannot edit transactions in this business.'; END IF;
  et:=lower(coalesce(p_entry_type,'')); k:=lower(coalesce(p_kind,''));
  IF et NOT IN ('invoice','receipt','sale','expense','payment','other') THEN RAISE EXCEPTION 'Choose a valid transaction type.'; END IF;
  IF k NOT IN ('income','expense','principal_in','principal_out','savings_in','transfer','capital') THEN RAISE EXCEPTION 'Choose a valid accounting classification.'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_date IS NULL THEN RAISE EXCEPTION 'Enter a valid date and an amount greater than zero.'; END IF;
  cur:=upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  IF char_length(cur)<>3 OR cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Enter a valid three-letter currency code.'; END IF;
  IF p_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_projects WHERE id=p_project AND workspace_id=p_workspace) THEN
    RAISE EXCEPTION 'Choose a project in this business.';
  END IF;
  UPDATE public.ledger_entries SET
    project_id=p_project,entry_type=et,kind=k,amount=p_amount,entry_date=p_date,
    party=left(coalesce(nullif(trim(p_party),''),'Manual transaction'),160),
    currency=cur,category=nullif(trim(coalesce(p_category,'')),''),
    due_date=p_due_date
  WHERE id=p_entry_id AND workspace_id=p_workspace
  RETURNING id INTO eid;
  IF eid IS NULL THEN RAISE EXCEPTION 'Transaction not found in this business.'; END IF;
  RETURN eid;
END
$function$;

-- Rebuild reports with distinct operating profit and cash movement.
CREATE OR REPLACE FUNCTION public.project_summary(p_project uuid,p_month text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects; m text;
  rev_total numeric; exp_total numeric; rev_month numeric; exp_month numeric;
  cash_in_total numeric; cash_out_total numeric; cash_in_month numeric; cash_out_month numeric;
  cash_before numeric; cash_after numeric; savings_held numeric;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  m:=coalesce(nullif(p_month,''),to_char(current_date,'YYYY-MM'));
  SELECT
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income'),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','savings_in','capital')) ,0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','savings_in','capital')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')=m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','savings_in','capital')),0)
      - coalesce(sum(amount) FILTER(WHERE to_char(date_trunc('month',entry_date),'YYYY-MM')<m AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0),
    coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='savings_in'),0)
      - coalesce(sum(amount) FILTER(WHERE kind='transfer' AND party LIKE 'Savings released to complete loan:%'),0)
  INTO rev_total,exp_total,cash_in_total,cash_out_total,rev_month,exp_month,cash_in_month,cash_out_month,cash_before,savings_held
  FROM public.ledger_entries WHERE project_id=p_project AND to_char(date_trunc('month',entry_date),'YYYY-MM')<=m;
  cash_after:=coalesce(pr.startup_year,0)+cash_before+cash_in_month-cash_out_month;
  RETURN jsonb_build_object(
    'name',pr.name,'business_type',pr.business_type,'currency',pr.currency,'month',m,
    'foundation',coalesce(pr.startup_year,0),'startup_year',coalesce(pr.startup_year,0),
    'total_out',cash_out_total,'total_in',cash_in_total,
    'profit',rev_total-exp_total,'balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'opening_startup',coalesce(pr.startup_year,0)+cash_before,
    'month_in',cash_in_month,'month_out',cash_out_month,'month_profit',rev_month-exp_month,
    'month_closing',cash_after,'customer_savings_held',savings_held,
    'status',case when rev_total-exp_total>=0 then 'gaining' else 'depreciating' end,
    'money_in',cash_in_month,'money_out',cash_out_month,
    'income',rev_total,'expenses',exp_total,'net',rev_total-exp_total,
    'closing_balance',coalesce(pr.startup_year,0)+cash_in_total-cash_out_total,
    'spent',pr.spent,'spend_period',pr.spend_period,'loan',pr.loan
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.project_months(p_project uuid)
RETURNS TABLE(month text,money_in numeric,money_out numeric,profit numeric,opening numeric,closing numeric,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pr public.business_projects;
BEGIN
  SELECT * INTO pr FROM public.business_projects WHERE id=p_project;
  IF NOT FOUND OR NOT public.is_member(pr.workspace_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  RETURN QUERY
  WITH m AS (
    SELECT to_char(date_trunc('month',entry_date),'YYYY-MM') mon,
      coalesce(sum(amount) FILTER(WHERE entry_type<>'invoice' AND coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('income','principal_in','savings_in','capital')),0) ci,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind)) IN ('expense','principal_out','transfer')),0) co,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='income'),0) ri,
      coalesce(sum(amount) FILTER(WHERE coalesce(nullif(kind,''),public.ledger_kind(entry_type,kind))='expense'),0) re
    FROM public.ledger_entries WHERE project_id=p_project GROUP BY 1
  ), r AS (
    SELECT mon,ci,co,ri-re pf,
      sum(ci-co) OVER(ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) cash_cum,
      sum(ci-co) OVER(ORDER BY mon ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) cash_before
    FROM m
  )
  SELECT r.mon,r.ci,r.co,r.pf,
    coalesce(pr.startup_year,0)+coalesce(r.cash_before,0),
    coalesce(pr.startup_year,0)+coalesce(r.cash_cum,0),
    CASE WHEN r.pf>=0 THEN 'gaining' ELSE 'depreciating' END
  FROM r ORDER BY r.mon;
END
$function$;

CREATE OR REPLACE FUNCTION public.confirm_upload(p_upload uuid,p_currency text,p_entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ws uuid; n integer:=0; e jsonb; et text; k text; cur text; pid uuid; amt numeric; dt date;
BEGIN
  SELECT workspace_id INTO ws FROM public.uploads WHERE id=p_upload AND status='pending_review' FOR UPDATE;
  IF ws IS NULL OR NOT public.can_edit(ws) THEN RAISE EXCEPTION 'Upload not found, already confirmed, or access denied.'; END IF;
  cur:=upper(coalesce(nullif(trim(p_currency),''),''));
  IF char_length(cur)<>3 OR cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Choose a valid three-letter currency code.'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries)=0 THEN RAISE EXCEPTION 'There are no transaction rows to confirm.'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    et:=lower(coalesce(e->>'type','other'));
    IF et NOT IN ('invoice','receipt','sale','expense','payment','other') THEN RAISE EXCEPTION 'Invalid transaction type in uploaded rows.'; END IF;
    amt:=nullif(e->>'amount','')::numeric;
    IF amt IS NULL OR amt<=0 THEN RAISE EXCEPTION 'Uploaded row amounts must be greater than zero.'; END IF;
    dt:=nullif(e->>'date','')::date;
    IF dt IS NULL THEN RAISE EXCEPTION 'Every uploaded row needs a valid date.'; END IF;
    k:=coalesce(nullif(e->>'kind',''),public.ledger_kind(et,NULL));
    IF k NOT IN ('income','expense','principal_in','principal_out','savings_in','transfer','capital') THEN RAISE EXCEPTION 'Invalid accounting classification in uploaded rows.'; END IF;
    cur:=upper(coalesce(nullif(e->>'currency',''),cur));
    IF char_length(cur)<>3 OR cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Every uploaded row needs a valid three-letter currency.'; END IF;
    pid:=nullif(e->>'project_id','')::uuid;
    IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.business_projects WHERE id=pid AND workspace_id=ws) THEN RAISE EXCEPTION 'An uploaded row refers to a project outside this business.'; END IF;
    IF pid IS NULL THEN
      SELECT id INTO pid FROM public.business_projects WHERE workspace_id=ws ORDER BY created_at LIMIT 1;
      IF (SELECT count(*) FROM public.business_projects WHERE workspace_id=ws)>1 THEN RAISE EXCEPTION 'Choose a project before confirming this upload.'; END IF;
    END IF;
    INSERT INTO public.ledger_entries
      (workspace_id,project_id,upload_id,entry_date,entry_type,amount,currency,party,due_date,kind,category,created_by)
    VALUES(ws,pid,p_upload,dt,et,amt,cur,e->>'party',nullif(e->>'due','')::date,k,nullif(e->>'category',''),auth.uid());
    n:=n+1;
  END LOOP;
  UPDATE public.uploads SET status='confirmed',currency=upper(p_currency) WHERE id=p_upload;
  RETURN n;
END
$function$;

REVOKE ALL ON FUNCTION public.business_list_transactions(uuid,uuid,date,date,text,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_add_transaction(uuid,uuid,text,text,numeric,date,text,text,text,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_update_transaction(uuid,bigint,text,text,numeric,date,text,text,text,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_list_transactions(uuid,uuid,date,date,text,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_add_transaction(uuid,uuid,text,text,numeric,date,text,text,text,date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_update_transaction(uuid,bigint,text,text,numeric,date,text,text,text,date,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.confirm_upload(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_upload(uuid,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.project_summary(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_summary(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.project_months(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_months(uuid) TO authenticated,service_role;
