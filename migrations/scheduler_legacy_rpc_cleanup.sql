-- Pelex scheduler legacy RPC cleanup
-- Verified main/jobs/scheduled_tasks.js uses only the V2 RPCs.
-- Safe to apply after confirming the Render service is running the main
-- deployment that loads jobs/scheduled_tasks.js.
-- Does not alter scheduled_tasks rows, RLS, policies, or V2 function bodies.

REVOKE EXECUTE ON FUNCTION public.claim_due_scheduled_tasks(integer, integer)
  FROM service_role;

REVOKE EXECUTE ON FUNCTION public.complete_scheduled_task(uuid, text, timestamp with time zone)
  FROM service_role;

REVOKE EXECUTE ON FUNCTION public.fail_scheduled_task(uuid, text, integer, integer)
  FROM service_role;

-- Explicitly retain backend access to the V2 worker RPCs.
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_tasks_v2(integer, integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.complete_scheduled_task_v2(uuid, uuid, text, timestamp with time zone, boolean)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.fail_scheduled_task_v2(uuid, uuid, text, integer, integer)
  TO service_role;
