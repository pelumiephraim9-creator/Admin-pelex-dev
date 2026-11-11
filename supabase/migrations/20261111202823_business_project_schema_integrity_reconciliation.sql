-- Reconcile and assert the already-deployed multi-project Business Agent baseline.
-- The project foundation predates complete migration tracking. This migration does not
-- recreate or delete business data; it verifies the live contract and closes one nullable FK gap.

-- Composite (project_id, workspace_id) foreign keys do not protect rows if either
-- component is NULL. Make the payment-event workspace mandatory as well.
ALTER TABLE public.payment_events ALTER COLUMN workspace_id SET NOT NULL;

DO $$
DECLARE
  t text;
  required_tables text[] := ARRAY[
    'ledger_entries','uploads','agreements','business_project_records',
    'devices','pairing_codes','agent_actions','business_knowledge',
    'meeting_notes','payment_connections','payment_events'
  ];
BEGIN
  FOREACH t IN ARRAY required_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Business project baseline missing required table public.%', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='project_id' AND is_nullable='NO'
    ) THEN
      RAISE EXCEPTION 'Business project baseline requires public.%.project_id NOT NULL', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='workspace_id' AND is_nullable='NO'
    ) THEN
      RAISE EXCEPTION 'Business project baseline requires public.%.workspace_id NOT NULL', t;
    END IF;
  END LOOP;

  IF to_regprocedure('public.business_list_transactions(uuid,uuid,date,date,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Project-scoped transaction listing RPC is missing.';
  END IF;
  IF to_regprocedure('public.business_project_dashboard_summary(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Project-specific dashboard summary RPC is missing.';
  END IF;
  IF to_regprocedure('public.business_add_project_record(uuid,uuid,text,text,date,numeric,text,numeric,numeric,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Project-scoped operational record RPC is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ledger_entries'::regclass
      AND conname='ledger_entries_project_workspace_fkey'
  ) THEN
    RAISE EXCEPTION 'Ledger project/workspace composite foreign key is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.business_project_records'::regclass
      AND conname='business_project_records_project_workspace_fkey'
  ) THEN
    RAISE EXCEPTION 'Operational-record project/workspace composite foreign key is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid='public.business_project_records'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Operational-record row-level security is not enabled.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='business_project_records'
      AND policyname='business_project_records_read'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='business_project_records'
      AND policyname='business_project_records_write'
  ) THEN
    RAISE EXCEPTION 'Operational-record member/edit policies are missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_types) THEN
    RAISE EXCEPTION 'Business type catalogue is empty.';
  END IF;
END;
$$;
