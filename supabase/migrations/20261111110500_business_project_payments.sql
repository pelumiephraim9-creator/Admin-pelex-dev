-- Payment provider webhooks are project-bound just like manual transactions.
begin;

alter table public.payment_connections add column if not exists project_id uuid;
alter table public.payment_events add column if not exists project_id uuid;

alter table public.payment_connections drop constraint if exists payment_connections_pkey;
alter table public.payment_connections alter column project_id set not null;
alter table public.payment_connections add constraint payment_connections_pkey primary key(workspace_id,project_id,provider);
alter table public.payment_connections add constraint payment_connections_project_workspace_fkey
 foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict;

alter table public.payment_events alter column project_id set not null;
alter table public.payment_events add constraint payment_events_project_workspace_fkey
 foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict;
create index if not exists payment_events_project_date_idx on public.payment_events(project_id,paid_at desc);

create or replace function public.ingest_payment(
 p_token text,p_provider text,p_event_id text,p_event_type text,p_amount numeric,
 p_currency text,p_customer text,p_paid_at timestamptz,p_raw jsonb
)
returns text language plpgsql security definer set search_path=public
as $$
declare c public.payment_connections; cur text; st text:='ledgered';
begin
 select * into c from public.payment_connections
 where webhook_token=p_token and active and provider=p_provider;
 if not found then return 'unknown_token';end if;
 select upper(currency) into cur from public.business_projects
 where id=c.project_id and workspace_id=c.workspace_id;
 if cur is null then return 'unknown_project';end if;
 if exists(select 1 from public.payment_events where provider=p_provider and event_id=p_event_id) then return 'duplicate';end if;
 if p_amount is null or p_amount<=0 then st:='ignored';end if;
 if p_currency is not null and upper(p_currency)<>cur then st:='currency_mismatch';end if;
 insert into public.payment_events(workspace_id,project_id,provider,event_id,event_type,amount,currency,customer,paid_at,status,raw)
 values(c.workspace_id,c.project_id,p_provider,p_event_id,p_event_type,p_amount,cur,p_customer,p_paid_at,st,p_raw);
 if st='ledgered' then
  insert into public.ledger_entries(workspace_id,project_id,upload_id,entry_date,entry_type,amount,currency,party,due_date,kind,category,created_by)
  values(c.workspace_id,c.project_id,null,coalesce(p_paid_at::date,current_date),'sale',p_amount,cur,p_customer,null,'income',
   'Payment provider: '||p_provider,c.connected_by);
 end if;
 return st;
end;
$$;

commit;
