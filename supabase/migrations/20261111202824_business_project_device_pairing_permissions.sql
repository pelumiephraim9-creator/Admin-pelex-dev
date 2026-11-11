-- Pairing codes are created by signed-in business owners.
-- The device redeem and ingest endpoints remain anonymous by design and require one-time
-- pairing codes or per-device bearer tokens; code creation must never be anonymous.
REVOKE ALL ON FUNCTION public.create_pairing_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pairing_code(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_pairing_code(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pairing_code(uuid,uuid) TO authenticated, service_role;
