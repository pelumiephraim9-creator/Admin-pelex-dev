-- Scope Business Agent knowledge, approval actions and meeting archives to one project.
begin;

alter table public.agent_actions add column if not exists project_id uuid;
alter table public.business_knowledge add column if not exists project_id uuid;
alter table public.meeting_notes add column if not exists project_id uuid;

alter table public.agent_actions alter column project_id set not null;
alter table public.business_knowledge alter column project_id set not null;
alter table public.meeting_notes alter column project_id set not null;

alter table public.agent_actions add constraint agent_actions_project_workspace_fkey
 foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict;
alter table public.business_knowledge add constraint business_knowledge_project_workspace_fkey
 foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict;
alter table public.meeting_notes add constraint meeting_notes_project_workspace_fkey
 foreign key(project_id,workspace_id) references public.business_projects(id,workspace_id) on delete restrict;

create index if not exists agent_actions_project_created_idx on public.agent_actions(project_id,created_at desc);
create index if not exists business_knowledge_project_updated_idx on public.business_knowledge(project_id,updated_at desc);
create index if not exists meeting_notes_project_created_idx on public.meeting_notes(project_id,created_at desc);

create or replace function public.request_agent_action(
 p_workspace uuid,p_project uuid,p_level integer,p_action text,p_payload jsonb default '{}'::jsonb
)
returns bigint language plpgsql security definer set search_path=public
as $$
declare aid bigint;
begin
 if not public.is_member(p_workspace) then raise exception 'Not a member of this business.';end if;
 if p_project is null or not exists(select 1 from public.business_projects where id=p_project and workspace_id=p_workspace) then
  raise exception 'Choose the project this action belongs to.';
 end if;
 if p_level=1 then return null;end if;
 if p_level not in (2,3) then raise exception 'Level must be 1, 2 or 3.';end if;
 insert into public.agent_actions(workspace_id,project_id,level,action,payload,requested_by)
 values(p_workspace,p_project,p_level,left(p_action,200),coalesce(p_payload,'{}'::jsonb),auth.uid())
 returning id into aid;
 return aid;
end;
$$;

create or replace function public.request_agent_action(
 p_workspace uuid,p_level integer,p_action text,p_payload jsonb default '{}'::jsonb
)
returns bigint language plpgsql security definer set search_path=public
as $$
declare pid uuid;n integer;
begin
 select count(*),(array_agg(id order by created_at))[1] into n,pid
 from public.business_projects where workspace_id=p_workspace;
 if n<>1 then raise exception 'Select a business project for this action. Workspace-wide approval actions are disabled when multiple projects exist.';end if;
 return public.request_agent_action(p_workspace,pid,p_level,p_action,p_payload);
end;
$$;

commit;
