-- Music Walk Map / Initial research schema / 2026-09-26
-- Target: a fresh Supabase PostgreSQL database. Apply once as postgres.
-- No existing tables/policies are dropped. This file is atomic, not rerunnable.
-- Shared catalog reads mean ALL AUTHENTICATED users; anon has no access.
-- service_role bypasses RLS: the server MUST independently authorize callers.
-- No public/unlisted Journey access is enabled by this migration.
-- Consent records do not grant researchers access or gate personal recording.
-- Research export/consent withdrawal workflows require a separate implementation.
--
-- Decisions compared with the supplied design:
-- 1. session_key is reserved but CHECKed NULL until server-only credential
--    storage is introduced. Owner RLS alone would expose it to that owner's UI.
-- 2. title+artist_name is a lookup candidate, NOT proof of identical recordings.
--    No UNIQUE constraint on names; retain versions and avoid automatic merging.
-- 3. musicbrainz_artist is an association, not a unique track identifier.
-- 4. listening_events accepts confirmed scrobbles only; nowplaying stays transient.
--    UPDATE is rejected even for service_role; explicit owner DELETE remains
--    available for erasure, including cascading session/account deletion.
-- 5. join_results.session_id enables composite FKs enforcing same-session joins.
-- 6. Optional raw_payload preserves original event metadata. Keep exact original
--    names/timestamps in it; shared track metadata alone is not immutable evidence.
-- 7. GPS recorded_at is the callback/record receipt time (current test exporter).
--    geolocation_recorded_at is the device measurement time. Import both;
--    time alignment should use measurement time when present, documenting fallback.
-- 8. One Journey per session; one current result per Journey/listening event.
--    Recompute results AND update journeys.algorithm_version in one transaction.
-- 9. Global external_event_key means one scrobble belongs to one session here.
--    A scrobble spanning sessions needs an association table in a later migration.
--    Hash a canonical JSON array [user_id, provider, unix_seconds, artist, title],
--    not ambiguous delimiter concatenation; do not include session_id in the key.
-- 10. Consent is a current-state record, not a historical audit trail.
--
-- Official references:
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- https://supabase.com/docs/guides/auth/managing-user-data

BEGIN;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.music_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'lastfm' CHECK (provider = 'lastfm'),
  lastfm_username text NOT NULL CHECK (btrim(lastfm_username) <> ''),
  session_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT music_accounts_session_key_mvp CHECK (session_key IS NULL),
  UNIQUE (user_id, provider)
);

CREATE TABLE public.tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (btrim(title) <> ''),
  artist_name text NOT NULL CHECK (btrim(artist_name) <> ''),
  album_name text,
  duration_ms integer CHECK (duration_ms > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracks_name_lookup_idx ON public.tracks (artist_name, title);

CREATE TABLE public.track_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN
    ('musicbrainz_recording', 'musicbrainz_artist', 'lastfm_track_url')),
  external_id text NOT NULL CHECK (btrim(external_id) <> ''),
  UNIQUE (track_id, provider, external_id),
  CONSTRAINT external_mbid_format CHECK (
    provider = 'lastfm_track_url' OR external_id ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);
CREATE UNIQUE INDEX track_external_ids_track_identity_idx
  ON public.track_external_ids (provider, external_id)
  WHERE provider IN ('musicbrainz_recording', 'lastfm_track_url');
-- An artist MBID may occur on many tracks. Entity type must be checked at ingestion.

CREATE TABLE public.recording_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'completed', 'cancelled')),
  device_info jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((status = 'recording' AND ended_at IS NULL) OR
         (status IN ('completed', 'cancelled') AND ended_at IS NOT NULL))
);
CREATE INDEX recording_sessions_user_time_idx
  ON public.recording_sessions (user_id, started_at);

CREATE TABLE public.location_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.recording_sessions(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  geolocation_recorded_at timestamptz,
  position_age_at_receipt_ms bigint CHECK (position_age_at_receipt_ms >= 0),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m double precision CHECK (accuracy_m >= 0 AND accuracy_m < 'Infinity'::float8),
  speed_mps double precision CHECK (speed_mps >= 0 AND speed_mps < 'Infinity'::float8),
  heading_deg double precision CHECK (heading_deg >= 0 AND heading_deg < 360),
  altitude_m double precision CHECK (altitude_m > '-Infinity'::float8 AND altitude_m < 'Infinity'::float8),
  visibility_state text CHECK (visibility_state IN ('visible', 'hidden')),
  interval_from_prev_ms integer CHECK (interval_from_prev_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, session_id)
);
CREATE INDEX location_samples_session_time_idx ON public.location_samples (session_id, recorded_at);
CREATE INDEX location_samples_recorded_at_idx ON public.location_samples (recorded_at);
-- session_id is the leading column of session_time_idx; no redundant index needed.

CREATE TABLE public.listening_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.recording_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks(id),
  external_event_key text NOT NULL UNIQUE CHECK (btrim(external_event_key) <> ''),
  started_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'lastfm_scrobble' CHECK (source = 'lastfm_scrobble'),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, session_id)
);
CREATE INDEX listening_events_session_time_idx ON public.listening_events (session_id, started_at);
CREATE INDEX listening_events_started_at_idx ON public.listening_events (started_at);
CREATE INDEX listening_events_track_idx ON public.listening_events (track_id);
-- UNIQUE(external_event_key) creates the required unique index automatically.
-- Re-import: INSERT ... ON CONFLICT (external_event_key) DO NOTHING, never UPDATE.

CREATE TABLE public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  algorithm_version text NOT NULL CHECK (btrim(algorithm_version) <> ''),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, session_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES public.recording_sessions(id, user_id) ON DELETE CASCADE,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (status <> 'completed' OR ended_at IS NOT NULL)
);
CREATE INDEX journeys_user_time_idx ON public.journeys (user_id, started_at);

CREATE TABLE public.join_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  listening_event_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  representative_location_id uuid,
  estimated_ended_at timestamptz,
  end_method text NOT NULL CHECK (end_method IN
    ('next_track_start', 'duration', 'session_end', 'unknown')),
  match_status text NOT NULL CHECK (match_status IN ('matched', 'partial', 'unmatched')),
  location_sample_count integer NOT NULL DEFAULT 0 CHECK (location_sample_count >= 0),
  algorithm_version text NOT NULL CHECK (btrim(algorithm_version) <> ''),
  config_snapshot jsonb,
  warnings jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, listening_event_id),
  FOREIGN KEY (journey_id, session_id)
    REFERENCES public.journeys(id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (listening_event_id, session_id)
    REFERENCES public.listening_events(id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (representative_location_id, session_id)
    REFERENCES public.location_samples(id, session_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((end_method = 'unknown' AND estimated_ended_at IS NULL) OR
         (end_method <> 'unknown' AND estimated_ended_at IS NOT NULL)),
  CHECK (representative_location_id IS NULL OR location_sample_count > 0)
);
CREATE INDEX join_results_listening_event_idx ON public.join_results (listening_event_id);
CREATE INDEX join_results_session_idx ON public.join_results (session_id);
CREATE INDEX join_results_location_idx ON public.join_results (representative_location_id);
-- The composite UNIQUE index already serves journey_id lookups.
-- Delete/recompute referencing results before deleting individual GPS samples.

CREATE TABLE public.research_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  consented boolean NOT NULL DEFAULT false,
  consented_at timestamptz,
  version text NOT NULL CHECK (btrim(version) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT consented OR consented_at IS NOT NULL)
);

-- Reject reassignment of ownership/identity: moving a parent would otherwise
-- silently transfer access to all of its child rows. Normal metadata updates work.
CREATE FUNCTION public.mwm_guard_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION 'Immutable identity column: %', col USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.mwm_reject_listening_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'listening_events is append-only; recompute join_results instead'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER mwm_listening_no_update BEFORE UPDATE ON public.listening_events
  FOR EACH ROW EXECUTE FUNCTION public.mwm_reject_listening_update();

CREATE FUNCTION public.mwm_touch_journey() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER mwm_journeys_updated BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.mwm_touch_journey();

-- Auth trigger uses a fixed empty search_path and fully qualified relations.
CREATE FUNCTION public.mwm_handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name',
          NEW.raw_user_meta_data ->> 'avatar_url');
  RETURN NEW;
END;
$$;
CREATE TRIGGER mwm_on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mwm_handle_new_user();
-- Backfill Auth users who existed before this migration.
INSERT INTO public.profiles (id, display_name, avatar_url)
SELECT id, raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'avatar_url'
FROM auth.users ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON FUNCTION public.mwm_guard_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mwm_reject_listening_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mwm_touch_journey() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mwm_handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mwm_profiles_identity BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id');
CREATE TRIGGER mwm_music_accounts_identity BEFORE UPDATE ON public.music_accounts
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'user_id', 'provider');
CREATE TRIGGER mwm_recording_sessions_identity BEFORE UPDATE ON public.recording_sessions
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'user_id');
CREATE TRIGGER mwm_location_samples_identity BEFORE UPDATE ON public.location_samples
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'session_id');
CREATE TRIGGER mwm_journeys_identity BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'session_id', 'user_id');
CREATE TRIGGER mwm_join_results_identity BEFORE UPDATE ON public.join_results
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'session_id', 'journey_id', 'listening_event_id');
CREATE TRIGGER mwm_research_consents_identity BEFORE UPDATE ON public.research_consents
  FOR EACH ROW EXECUTE FUNCTION public.mwm_guard_identity('id', 'user_id');

-- Explicit grants plus RLS: no reliance on project default privileges.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_delete_own ON public.profiles
  FOR DELETE TO authenticated USING (id = (SELECT auth.uid()));

ALTER TABLE public.music_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.music_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_accounts TO authenticated;
CREATE POLICY music_accounts_select_own ON public.music_accounts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY music_accounts_insert_own ON public.music_accounts
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY music_accounts_update_own ON public.music_accounts
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY music_accounts_delete_own ON public.music_accounts
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tracks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tracks TO service_role;
GRANT SELECT ON TABLE public.tracks TO authenticated;
CREATE POLICY tracks_read ON public.tracks
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.track_external_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.track_external_ids FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.track_external_ids TO service_role;
GRANT SELECT ON TABLE public.track_external_ids TO authenticated;
CREATE POLICY track_external_ids_read ON public.track_external_ids
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.recording_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recording_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.recording_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recording_sessions TO authenticated;
CREATE POLICY recording_sessions_select_own ON public.recording_sessions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY recording_sessions_insert_own ON public.recording_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY recording_sessions_update_own ON public.recording_sessions
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY recording_sessions_delete_own ON public.recording_sessions
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

ALTER TABLE public.location_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.location_samples FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.location_samples TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.location_samples TO authenticated;
CREATE POLICY location_samples_select_own ON public.location_samples
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = location_samples.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY location_samples_insert_own ON public.location_samples
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = location_samples.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY location_samples_update_own ON public.location_samples
  FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = location_samples.session_id AND s.user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = location_samples.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY location_samples_delete_own ON public.location_samples
  FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = location_samples.session_id AND s.user_id = (SELECT auth.uid())));

ALTER TABLE public.listening_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.listening_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.listening_events TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.listening_events TO authenticated;
CREATE POLICY listening_events_select_own ON public.listening_events
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = listening_events.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY listening_events_insert_own ON public.listening_events
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = listening_events.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY listening_events_delete_own ON public.listening_events
  FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = listening_events.session_id AND s.user_id = (SELECT auth.uid())));

ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.journeys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.journeys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.journeys TO authenticated;
CREATE POLICY journeys_select_own ON public.journeys
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY journeys_insert_own ON public.journeys
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY journeys_update_own ON public.journeys
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY journeys_delete_own ON public.journeys
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

ALTER TABLE public.join_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.join_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.join_results TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.join_results TO authenticated;
CREATE POLICY join_results_select_own ON public.join_results
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = join_results.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY join_results_insert_own ON public.join_results
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = join_results.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY join_results_update_own ON public.join_results
  FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = join_results.session_id AND s.user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = join_results.session_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY join_results_delete_own ON public.join_results
  FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.recording_sessions AS s
    WHERE s.id = join_results.session_id AND s.user_id = (SELECT auth.uid())));

ALTER TABLE public.research_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.research_consents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.research_consents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.research_consents TO authenticated;
CREATE POLICY research_consents_select_own ON public.research_consents
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY research_consents_insert_own ON public.research_consents
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY research_consents_update_own ON public.research_consents
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY research_consents_delete_own ON public.research_consents
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

COMMENT ON COLUMN public.music_accounts.session_key IS
  'Reserved: must be NULL in MVP. Introduce server-only secret storage before enabling Last.fm authentication.';
COMMENT ON TABLE public.track_external_ids IS
  'External identifiers: recording/URL identify tracks; artist IDs are many-track associations.';
COMMENT ON TABLE public.listening_events IS
  'Confirmed input facts. UPDATE forbidden; owner erasure allowed. No inferred end times here.';
COMMENT ON COLUMN public.listening_events.raw_payload IS
  'Original Last.fm event object, including original title/artist/timestamp; never include API secrets.';
COMMENT ON COLUMN public.journeys.visibility IS
  'Metadata only: every Journey remains owner-only under current RLS, even public/unlisted.';
COMMENT ON TABLE public.research_consents IS
  'Current consent state only. Does not grant researcher access; historical consent needs a later audit table.';

COMMIT;
