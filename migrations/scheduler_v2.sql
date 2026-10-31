-- Pelex shared scheduler v2: apply only after checking scheduled_tasks schema/RPCs.
begin;
alter table public.scheduled_tasks add column if not exists claim_token uuid;
create index if not exists scheduled_tasks_claim_scan_idx on public.scheduled_tasks(active,status,next_run,locked_until);
create or replace function public.claim_due_scheduled_tasks_v2(p_limit integer default 3,p_lock_seconds integer default 300) returns setof public.scheduled_tasks language plpgsql security definer set search_path=public as $$
begin
 if p_limit is null or p_limit<1 then p_limit:=1; end if; if p_limit>20 then p_limit:=20; end if;
 if p_lock_seconds is null or p_lock_seconds<60 then p_lock_seconds:=300; end if; if p_lock_seconds>1800 then p_lock_seconds:=1800; end if;
 return query with picked as(select st.id from public.scheduled_tasks st where st.active=true and st.next_run<=clock_timestamp() and st.status in('scheduled','running') and(st.locked_until is null or st.locked_until<clock_timestamp()) order by st.next_run asc for update skip locked limit p_limit),
 claimed as(update public.scheduled_tasks st set status='running',locked_until=clock_timestamp()+make_interval(secs=>p_lock_seconds),claim_token=gen_random_uuid(),last_run=clock_timestamp(),attempts=coalesce(st.attempts,0)+1 from picked where st.id=picked.id returning st.*) select * from claimed;
end $$;
create or replace function public.complete_scheduled_task_v2(p_task_id uuid,p_claim_token uuid,p_result text,p_next_run timestamptz,p_delivery_confirmed boolean default false) returns boolean language plpgsql security definer set search_path=public as $$ declare changed integer; begin
update public.scheduled_tasks set last_result=left(coalesce(p_result,''),20000),delivered_at=case when p_delivery_confirmed then clock_timestamp() else delivered_at end,status=case when p_next_run is null then 'closed' else 'scheduled' end,next_run=p_next_run,locked_until=null,claim_token=null,last_error=null,attempts=0 where id=p_task_id and status='running' and claim_token=p_claim_token;
get diagnostics changed=row_count; return changed=1; end $$;
create or replace function public.fail_scheduled_task_v2(p_task_id uuid,p_claim_token uuid,p_error text,p_max_attempts integer default 3,p_retry_seconds integer default 300) returns boolean language plpgsql security definer set search_path=public as $$ declare changed integer; begin
update public.scheduled_tasks set last_error=left(coalesce(p_error,'Unknown scheduler error'),2000),status=case when coalesce(attempts,0)>=greatest(1,coalesce(p_max_attempts,3)) then 'closed' else 'scheduled' end,next_run=case when coalesce(attempts,0)>=greatest(1,coalesce(p_max_attempts,3)) then next_run else clock_timestamp()+make_interval(secs=>greatest(60,least(3600,coalesce(p_retry_seconds,300)))) end,locked_until=null,claim_token=null where id=p_task_id and status='running' and claim_token=p_claim_token;
get diagnostics changed=row_count; return changed=1; end $$;
commit;
