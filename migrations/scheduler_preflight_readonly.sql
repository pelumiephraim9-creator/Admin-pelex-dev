-- PELEX SCHEDULER: READ-ONLY DATABASE PREFLIGHT
-- Run this first in Supabase SQL Editor and send the complete results back.
-- This script does not create, alter, update, or delete anything.

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('scheduled_tasks', 'scheduled_task_runs', 'bot_plans', 'businesses')
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('scheduled_tasks', 'scheduled_task_runs')
order by tablename, indexname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_due_scheduled_tasks_v2',
    'complete_scheduled_task_v2',
    'fail_scheduled_task_v2',
    'scheduler_claim',
    'scheduler_complete',
    'scheduler_fail',
    'scheduler_recover'
  )
order by p.proname;

select
  table_name,
  constraint_name,
  constraint_type
from information_schema.table_constraints
where table_schema = 'public'
  and table_name in ('scheduled_tasks', 'scheduled_task_runs')
order by table_name, constraint_name;
