-- Run against a migrated test database as postgres:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/location_samples_idempotency.sql
BEGIN;

DO $$
DECLARE
  test_user_id uuid := gen_random_uuid();
  test_session_id uuid := gen_random_uuid();
  test_sample_id text := gen_random_uuid()::text;
  point jsonb;
  inserted_count bigint;
BEGIN
  INSERT INTO auth.users (id) VALUES (test_user_id);
  INSERT INTO public.recording_sessions (id, user_id)
    VALUES (test_session_id, test_user_id);
  point := jsonb_build_object(
    'client_sample_id', test_sample_id,
    'recorded_at', '2026-09-29T00:00:00Z',
    'latitude', 35.68,
    'longitude', 139.76
  );

  SELECT count(*) INTO inserted_count
    FROM public.insert_location_samples(test_session_id, jsonb_build_array(point));
  IF inserted_count <> 1 THEN
    RAISE EXCEPTION 'First request must insert one row';
  END IF;

  SELECT count(*) INTO inserted_count
    FROM public.insert_location_samples(test_session_id, jsonb_build_array(point));
  IF inserted_count <> 0 THEN
    RAISE EXCEPTION 'Retry must not insert another row';
  END IF;

  PERFORM public.insert_location_samples(
    test_session_id, jsonb_build_array(point || '{"latitude":36}'::jsonb)
  );
  IF (SELECT latitude FROM public.location_samples
      WHERE client_sample_id = test_sample_id) <> 35.68 THEN
    RAISE EXCEPTION 'Retry must not update the original observation';
  END IF;

  point := point || jsonb_build_object('client_sample_id', gen_random_uuid()::text);
  SELECT count(*) INTO inserted_count
    FROM public.insert_location_samples(test_session_id, jsonb_build_array(point, point));
  IF inserted_count <> 1 THEN
    RAISE EXCEPTION 'Duplicates within one batch must insert only one row';
  END IF;

  point := point - 'client_sample_id';
  PERFORM public.insert_location_samples(test_session_id, jsonb_build_array(point));
  PERFORM public.insert_location_samples(test_session_id, jsonb_build_array(point));
  IF (SELECT count(*) FROM public.location_samples
      WHERE session_id = test_session_id AND client_sample_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Requests without sample IDs must retain their old insert behavior';
  END IF;

  IF (SELECT count(*) FROM public.location_samples
      WHERE session_id = test_session_id) <> 4 THEN
    RAISE EXCEPTION 'Unexpected total row count';
  END IF;

  IF has_function_privilege('anon', 'public.insert_location_samples(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.insert_location_samples(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.insert_location_samples(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC must only be executable by the server role';
  END IF;
END;
$$;

ROLLBACK;
