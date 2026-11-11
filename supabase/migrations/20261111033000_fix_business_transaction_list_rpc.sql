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
    SELECT 1 FROM public.business_projects bp
    WHERE bp.id=p_project AND bp.workspace_id=p_workspace
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
REVOKE ALL ON FUNCTION public.business_list_transactions(uuid,uuid,date,date,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_list_transactions(uuid,uuid,date,date,text,integer) TO authenticated,service_role;