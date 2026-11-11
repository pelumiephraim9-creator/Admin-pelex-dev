-- Business Agent Stage 1: harden lending RPC authorization without changing records.
-- Existing ledger entries and agreements are intentionally untouched.

CREATE OR REPLACE FUNCTION public.build_schedule(p_agreement uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  a public.agreements;
  base numeric;
  n int;
  r numeric;
  i int;
  bal numeric;
  pay numeric;
  intr numeric;
  prin numeric;
  due date;
  step interval;
  total_int numeric;
  left_principal numeric;
  sav numeric;
  cum_int numeric := 0;
begin
  -- Lock the agreement while rebuilding its schedule and require workspace edit rights.
  select * into a from public.agreements where id = p_agreement for update;
  if not found or not public.can_edit(a.workspace_id) then
    raise exception 'You cannot build a schedule for this agreement.';
  end if;

  delete from public.schedule_items where agreement_id = p_agreement;
  base := case when a.savings_model in ('upfront_credited','savings_box_completes')
               then a.principal - a.deposit else a.principal end;
  if base <= 0 then raise exception 'Deposit cannot be equal to or above the principal.'; end if;
  n := a.term_cycles;
  sav := case when a.savings_model = 'per_instalment' then a.savings_per_instalment else 0 end;
  step := case a.cycle when 'daily' then interval '1 day'
                       when 'weekly' then interval '1 week'
                       else interval '1 month' end;
  if a.rate_basis = 'total' then total_int := base * a.rate; r := 0;
  else total_int := null; r := a.rate; end if;
  bal := base;
  left_principal := base;

  for i in 1..n loop
    due := (a.start_date + (i * step))::date;
    if a.method = 'declining' and r > 0 then
      pay := base * r / (1 - power(1 + r, -n));
      intr := round(bal * r, 2);
      prin := round(pay - intr, 2);
    elsif a.method = 'declining' then
      intr := 0; prin := round(base / n, 2);
    elsif a.method = 'flat' then
      prin := round(base / n, 2);
      intr := case when total_int is not null then round(total_int / n, 2)
                   when r > 0 then round(base * r, 2) else 0 end;
    else
      prin := round(base / n, 2); intr := 0;
    end if;
    if i = n then prin := round(left_principal, 2); end if;
    if a.method = 'declining' and i = n and r > 0 then
      intr := round(bal * r, 2); prin := round(bal, 2);
    end if;
    if i = n and total_int is not null then intr := round(total_int - cum_int, 2); end if;
    cum_int := cum_int + intr;
    insert into public.schedule_items
      (agreement_id, seq, due_date, principal_due, interest_due, savings_due, amount_due)
    values (p_agreement, i, due, prin, intr, sav, prin + intr + sav);
    bal := bal - prin;
    left_principal := left_principal - prin;
  end loop;
  return n;
end
$function$;

CREATE OR REPLACE FUNCTION public.agreement_position(p_agreement uuid, p_asof date)
RETURNS TABLE(due_to_date numeric, paid_to_date numeric, outstanding_due numeric,
              next_due_date date, next_due_amount numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  ws uuid;
begin
  select a.workspace_id into ws
  from public.agreements a
  where a.id = p_agreement;

  if ws is null or not public.is_member(ws) then
    raise exception 'Agreement not found or access denied.';
  end if;

  return query
  select
    coalesce(sum(case when s.due_date <= p_asof then s.amount_due end), 0),
    coalesce(sum(s.amount_paid), 0),
    coalesce(sum(case when s.due_date <= p_asof then s.amount_due - s.amount_paid end), 0),
    (select min(s2.due_date) from public.schedule_items s2
      where s2.agreement_id = p_agreement and s2.status <> 'paid' and s2.due_date > p_asof),
    (select s3.amount_due - s3.amount_paid from public.schedule_items s3
      where s3.agreement_id = p_agreement and s3.status <> 'paid' and s3.due_date > p_asof
      order by s3.due_date limit 1)
  from public.schedule_items s
  where s.agreement_id = p_agreement;
end
$function$;

-- These RPCs are for signed-in workspace members. Anonymous execution is unnecessary
-- and unsafe for SECURITY DEFINER functions, even where internal checks exist.
REVOKE ALL ON FUNCTION public.build_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agreement_position(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_slip(uuid,text,numeric,date,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_upload(uuid,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_agreement(uuid,text,numeric,numeric,text,numeric,text,text,text,integer,date,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_payment(uuid,numeric,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_savings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_setup_figures(uuid,numeric,numeric,numeric,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.build_schedule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agreement_position(uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_slip(uuid,text,numeric,date,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_upload(uuid,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_agreement(uuid,text,numeric,numeric,text,numeric,text,text,text,integer,date,text,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,numeric,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_savings(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_setup_figures(uuid,numeric,numeric,numeric,text,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_setup_project(uuid,text,text,text,numeric,numeric,numeric,text,numeric) TO authenticated, service_role;
