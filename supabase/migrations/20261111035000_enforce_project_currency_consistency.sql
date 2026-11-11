CREATE OR REPLACE FUNCTION public.enforce_business_project_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE project_currency text;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT upper(bp.currency) INTO project_currency
  FROM public.business_projects bp
  WHERE bp.id=NEW.project_id AND bp.workspace_id=NEW.workspace_id;
  IF project_currency IS NULL THEN
    RAISE EXCEPTION 'The selected project does not belong to this workspace.';
  END IF;
  IF upper(coalesce(NEW.currency,''))<>project_currency THEN
    RAISE EXCEPTION 'This project reports in %; transaction currency must match. Create a separate project for another currency.',project_currency;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_ledger_project_currency ON public.ledger_entries;
CREATE TRIGGER trg_ledger_project_currency
BEFORE INSERT OR UPDATE OF project_id,workspace_id,currency ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_business_project_currency();

CREATE OR REPLACE FUNCTION public.save_setup_project(
  p_workspace uuid, p_name text, p_business_type text, p_currency text,
  p_capital_month numeric, p_capital_year numeric, p_spent numeric,
  p_spend_period text, p_loan numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid uuid; cur text;
BEGIN
  IF NOT public.can_edit(p_workspace) THEN RAISE EXCEPTION 'You cannot change the setup in this workspace.'; END IF;
  cur:=upper(coalesce(nullif(trim(p_currency),''),'NGN'));
  IF char_length(cur)<>3 OR cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Enter a valid three-letter currency code.'; END IF;
  SELECT bp.id INTO pid FROM public.business_projects bp
  WHERE bp.workspace_id=p_workspace AND bp.name=coalesce(nullif(trim(p_name),''),'My business')
  LIMIT 1;
  IF pid IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.ledger_entries le
    WHERE le.project_id=pid AND upper(le.currency)<>cur
  ) THEN
    RAISE EXCEPTION 'This project already has transactions in another currency. Create a separate project instead of changing its currency.';
  END IF;
  INSERT INTO public.business_projects
    (workspace_id,name,business_type,currency,startup_month,startup_year,spent,spend_period,loan)
  VALUES(p_workspace,coalesce(nullif(trim(p_name),''),'My business'),
    coalesce(nullif(trim(p_business_type),''),'general'),cur,
    greatest(coalesce(p_capital_month,0),0),greatest(coalesce(p_capital_year,0),0),
    greatest(coalesce(p_spent,0),0),CASE WHEN p_spend_period='year' THEN 'year' ELSE 'month' END,
    greatest(coalesce(p_loan,0),0))
  ON CONFLICT(workspace_id,name) DO UPDATE SET
    business_type=excluded.business_type,currency=excluded.currency,
    startup_month=excluded.startup_month,startup_year=excluded.startup_year,
    spent=excluded.spent,spend_period=excluded.spend_period,loan=excluded.loan
  RETURNING id INTO pid;
  RETURN pid;
END
$function$;

REVOKE ALL ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) TO authenticated,service_role;