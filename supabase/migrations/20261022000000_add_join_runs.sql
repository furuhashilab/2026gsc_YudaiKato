-- Music Walk Map / Introduce join_runs, repoint join_results at it / 2026-10-22
-- Each POST /api/journeys/[id]/join call creates one join_runs row (one execution
-- of joinScrobblesWithLocations with its algorithm_version/config snapshot) and a
-- batch of join_results rows scoped to that run. Previous runs are kept, not
-- overwritten, so join_results no longer maps 1:1 onto journeys.id.
--
-- join_results.algorithm_version/config_snapshot are dropped: that information now
-- lives once on join_runs instead of being duplicated per result row.
-- join_results.session_id is kept and still enforces, via composite FKs, that
-- listening_event_id/representative_location_id belong to the same recording
-- session; join_runs does not carry session_id, so matching join_run_id's journey
-- to that session is an application-level invariant enforced by the API route
-- (it derives session_id from the same journey it creates the run for).

BEGIN;

CREATE TABLE public.join_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  algorithm_version text NOT NULL CHECK (btrim(algorithm_version) <> ''),
  algorithm_config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX join_runs_journey_idx ON public.join_runs (journey_id);

ALTER TABLE public.join_results
  ADD COLUMN join_run_id uuid REFERENCES public.join_runs(id) ON DELETE CASCADE;

-- Two-step NOT NULL: this project has no production data yet, but keeping the
-- column nullable until backfilled is the only way this statement generalizes
-- if that ever stops being true.
ALTER TABLE public.join_results
  ALTER COLUMN join_run_id SET NOT NULL;

-- Dropping journey_id also drops its composite FK to journeys and the
-- UNIQUE(journey_id, listening_event_id) constraint that referenced it;
-- dropping algorithm_version also drops its own CHECK constraint.
ALTER TABLE public.join_results
  DROP COLUMN journey_id,
  DROP COLUMN algorithm_version,
  DROP COLUMN config_snapshot;

ALTER TABLE public.join_results
  ADD CONSTRAINT join_results_join_run_id_listening_event_id_key
    UNIQUE (join_run_id, listening_event_id);
-- The composite UNIQUE index above already serves join_run_id lookups.

DROP TRIGGER mwm_join_results_identity ON public.join_results;
CREATE TRIGGER mwm_join_results_identity BEFORE UPDATE ON public.join_results
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'session_id', 'join_run_id', 'listening_event_id');

ALTER TABLE public.join_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.join_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.join_runs TO service_role;
GRANT SELECT ON TABLE public.join_runs TO authenticated;
CREATE POLICY join_runs_select_own ON public.join_runs
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.journeys AS j
    WHERE j.id = join_runs.journey_id AND j.user_id = (SELECT auth.uid())));
-- INSERT/UPDATE/DELETE are server-only (service_role); the join API route
-- authorizes the journey owner before calling createJoinRun().

COMMENT ON TABLE public.join_runs IS
  'One row per joinScrobblesWithLocations() execution for a journey: algorithm_version and a research-record algorithm_config snapshot, not the literal TimelineJoinConfig argument.';

COMMIT;
