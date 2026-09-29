BEGIN;

ALTER TABLE public.location_samples
  ADD COLUMN client_sample_id text;

CREATE UNIQUE INDEX IF NOT EXISTS location_samples_client_sample_id_key
  ON public.location_samples (client_sample_id)
  WHERE client_sample_id IS NOT NULL;

-- PostgREST upsert cannot specify the predicate for a partial unique index.
-- Keep the conflict handling atomic, including duplicates within one batch.
CREATE FUNCTION public.insert_location_samples(p_session_id uuid, p_samples jsonb)
RETURNS SETOF public.location_samples
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.location_samples (
    session_id, client_sample_id, recorded_at, geolocation_recorded_at,
    position_age_at_receipt_ms, latitude, longitude, accuracy_m, speed_mps,
    heading_deg, altitude_m, visibility_state, interval_from_prev_ms
  )
  SELECT
    p_session_id, sample.client_sample_id, sample.recorded_at,
    sample.geolocation_recorded_at, sample.position_age_at_receipt_ms,
    sample.latitude, sample.longitude, sample.accuracy_m, sample.speed_mps,
    sample.heading_deg, sample.altitude_m, sample.visibility_state,
    sample.interval_from_prev_ms
  FROM jsonb_populate_recordset(NULL::public.location_samples, p_samples) AS sample
  ON CONFLICT (client_sample_id) WHERE client_sample_id IS NOT NULL DO NOTHING
  RETURNING *;
$$;

-- The API authorizes session ownership before calling this server-only RPC.
REVOKE ALL ON FUNCTION public.insert_location_samples(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_location_samples(uuid, jsonb)
  TO service_role;

COMMIT;
