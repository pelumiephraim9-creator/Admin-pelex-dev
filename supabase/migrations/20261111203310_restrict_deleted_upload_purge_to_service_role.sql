-- Deleted-upload purge is a scheduled maintenance function, not a client RPC.
REVOKE ALL ON FUNCTION public.purge_deleted_uploads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_uploads() TO service_role;
