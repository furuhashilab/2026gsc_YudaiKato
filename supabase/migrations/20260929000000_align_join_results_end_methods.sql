BEGIN;

-- Preserve the distinct estimation methods emitted by TimelineEndMethod.
-- Keep the original values valid for existing rows and session-based estimates.
ALTER TABLE public.join_results
  DROP CONSTRAINT join_results_end_method_check,
  ADD CONSTRAINT join_results_end_method_check CHECK (end_method IN (
    'next_track_start',
    'duration',
    'session_end',
    'unknown',
    'next_track',
    'duration_and_next_track',
    'fallback'
  ));

COMMIT;
