-- Keep Business Agent project operations behind authenticated membership.
-- Trigger functions are not public RPC endpoints; remove anonymous execution.
revoke all on function public.add_slip(uuid,uuid,text,numeric,date,text,text,text) from public, anon;
grant execute on function public.add_slip(uuid,uuid,text,numeric,date,text,text,text) to authenticated, service_role;
revoke all on function public.agreements_for_project_month(uuid,uuid,text) from public, anon;
grant execute on function public.agreements_for_project_month(uuid,uuid,text) to authenticated, service_role;
revoke all on function public.create_agreement_for_project(uuid,uuid,text,numeric,numeric,text,numeric,text,text,text,integer,date,text,numeric) from public, anon;
grant execute on function public.create_agreement_for_project(uuid,uuid,text,numeric,numeric,text,numeric,text,text,text,integer,date,text,numeric) to authenticated, service_role;
revoke all on function public.create_business(text,text,text) from public, anon;
grant execute on function public.create_business(text,text,text) to authenticated, service_role;
revoke all on function public.list_my_businesses() from public, anon;
grant execute on function public.list_my_businesses() to authenticated, service_role;
revoke all on function public.decide_agent_action(bigint,boolean) from public, anon;
grant execute on function public.decide_agent_action(bigint,boolean) to authenticated, service_role;
revoke all on function public.delete_upload(uuid) from public, anon;
grant execute on function public.delete_upload(uuid) to authenticated, service_role;
revoke all on function public.restore_upload(uuid) from public, anon;
grant execute on function public.restore_upload(uuid) to authenticated, service_role;
revoke all on function public.list_audit(uuid,integer) from public, anon;
grant execute on function public.list_audit(uuid,integer) to authenticated, service_role;
revoke all on function public.request_agent_action(uuid,integer,text,jsonb) from public, anon;
grant execute on function public.request_agent_action(uuid,integer,text,jsonb) to authenticated, service_role;
revoke all on function public.request_agent_action(uuid,uuid,integer,text,jsonb) from public, anon;
grant execute on function public.request_agent_action(uuid,uuid,integer,text,jsonb) to authenticated, service_role;
revoke all on function public.enforce_business_project_currency() from public, anon;
grant execute on function public.enforce_business_project_currency() to authenticated, service_role;
revoke all on function public.link_ledger_to_project() from public, anon;
grant execute on function public.link_ledger_to_project() to authenticated, service_role;
