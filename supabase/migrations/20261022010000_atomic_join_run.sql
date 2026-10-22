BEGIN;

-- Both inserts belong to the RPC transaction. Any result error rolls back the run.
CREATE FUNCTION public.create_join_run_with_results(
  p_journey_id uuid,
  p_algorithm_version text,
  p_algorithm_config jsonb,
  p_results jsonb
)
RETURNS SETOF public.join_runs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  saved_run public.join_runs;
  journey_session_id uuid;
BEGIN
  SELECT session_id INTO STRICT journey_session_id
    FROM public.journeys WHERE id = p_journey_id;

  INSERT INTO public.join_runs (journey_id, algorithm_version, algorithm_config)
    VALUES (p_journey_id, p_algorithm_version, p_algorithm_config)
    RETURNING * INTO saved_run;

  INSERT INTO public.join_results (
    session_id, join_run_id, listening_event_id, representative_location_id,
    estimated_ended_at, end_method, match_status, location_sample_count, warnings
  )
  SELECT journey_session_id, saved_run.id, result.listening_event_id,
    result.representative_location_id, result.estimated_ended_at, result.end_method,
    result.match_status, result.location_sample_count, result.warnings
  FROM jsonb_populate_recordset(NULL::public.join_results, p_results) AS result;

  RETURN NEXT saved_run;
END;
$$;

-- The API checks journey ownership before invoking this server-only function.
REVOKE ALL ON FUNCTION public.create_join_run_with_results(uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_join_run_with_results(uuid, text, jsonb, jsonb)
  TO service_role;

COMMIT;
