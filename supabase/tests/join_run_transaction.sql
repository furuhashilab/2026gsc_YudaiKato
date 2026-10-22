-- Run against a migrated test database as postgres with ON_ERROR_STOP=1.
BEGIN;
DO $$
DECLARE
  uid uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  jid uuid := gen_random_uuid();
  tid uuid := gen_random_uuid();
  eid uuid := gen_random_uuid();
  run public.join_runs;
  point jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (uid);
  INSERT INTO public.recording_sessions (id, user_id) VALUES (sid, uid);
  INSERT INTO public.journeys (id, session_id, user_id, started_at, algorithm_version)
    VALUES (jid, sid, uid, now(), 'v0.1');
  INSERT INTO public.tracks (id, title, artist_name) VALUES (tid, 'Test', 'Test');
  INSERT INTO public.listening_events (id, session_id, track_id, external_event_key, started_at)
    VALUES (eid, sid, tid, eid::text, now());
  point := jsonb_build_object('listening_event_id', eid,
    'estimated_ended_at', now(), 'end_method', 'fallback', 'match_status', 'unmatched',
    'location_sample_count', 0, 'warnings', '[]'::jsonb);

  SELECT * INTO STRICT run FROM public.create_join_run_with_results(jid, 'test', '{}', jsonb_build_array(point));
  IF run.algorithm_version <> 'test' OR run.algorithm_config <> '{}'::jsonb
     OR (SELECT count(*) FROM public.join_results WHERE join_run_id = run.id AND session_id = sid) <> 1 THEN
    RAISE EXCEPTION 'Success must persist run metadata and its result';
  END IF;

  -- A valid row followed by an invalid row must leave neither a new run nor results.
  BEGIN
    PERFORM public.create_join_run_with_results(jid, 'test', '{}',
      jsonb_build_array(point, point || '{"match_status":"invalid"}'::jsonb));
    RAISE EXCEPTION 'Expected result CHECK violation';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.join_runs WHERE journey_id = jid) <> 1
     OR (SELECT count(*) FROM public.join_results WHERE session_id = sid) <> 1 THEN
    RAISE EXCEPTION 'Failed result insert must roll back the entire new run';
  END IF;

  PERFORM public.create_join_run_with_results(jid, 'test', '{}', '[]');
  IF (SELECT count(*) FROM public.join_runs WHERE journey_id = jid) <> 2 THEN
    RAISE EXCEPTION 'Empty results must still create a run';
  END IF;
  IF has_function_privilege('anon', 'public.create_join_run_with_results(uuid,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_join_run_with_results(uuid,text,jsonb,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_join_run_with_results(uuid,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC must be server-only';
  END IF;
END;
$$;
ROLLBACK;
