export type TimelineScrobble = {
  id: string;
  externalEventKey: string;
  trackName: string;
  artistName: string;
  playedAt: string;
  playedAtUnixMs: number;
  durationMs: number | null;
  source: "fixture" | "lastfm";
};

export type TimelineLocationSample = {
  id: string;
  recordedAt: string;
  recordedAtUnixMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  source: "fixture" | "geolocation";
};

export type TimelineJoinStatus = "matched" | "partial" | "unmatched";

export type TimelineEndMethod =
  | "duration"
  | "next_track"
  | "duration_and_next_track"
  | "fallback";

export type TimelineLocationMatchMethod =
  | "inside_segment_midpoint"
  | "nearest_within_tolerance"
  | "none";

export type TimelineJoinWarning =
  | "duration_missing"
  | "fallback_end_used"
  | "next_track_gap_exceeds_max_window"
  | "no_sample_inside_segment"
  | "nearest_sample_outside_segment"
  | "location_sample_not_found"
  | "low_location_accuracy";

export type TimelineJoinConfig = {
  durationToleranceMs: number;
  fallbackDurationMs: number;
  maxTrackWindowMs: number;
  locationEdgeToleranceMs: number;
  lowAccuracyWarningThresholdM: number;
};

export type TimelineJoinResult = {
  eventId: string;
  externalEventKey: string;
  trackName: string;
  artistName: string;

  startedAt: string;
  startedAtUnixMs: number;

  estimatedEndedAt: string;
  estimatedEndedAtUnixMs: number;
  endMethod: TimelineEndMethod;

  durationMs: number | null;
  segmentDurationMs: number;

  midpointAt: string;
  midpointAtUnixMs: number;

  locationSamples: TimelineLocationSample[];
  locationSampleCount: number;

  representativeLocation: TimelineLocationSample | null;
  representativeDistanceFromMidpointMs: number | null;
  locationMatchMethod: TimelineLocationMatchMethod;

  matchStatus: TimelineJoinStatus;
  warnings: TimelineJoinWarning[];
};

export type TimelineFixtureCase = {
  id: string;
  label: string;
  purpose: string;
  expected: string;
  scrobbles: TimelineScrobble[];
  locationSamples: TimelineLocationSample[];
};

export type TimelineValidationIssueCode =
  | "invalid_timestamp"
  | "invalid_duration"
  | "invalid_coordinate"
  | "invalid_accuracy"
  | "empty_track_name"
  | "empty_artist_name"
  | "duplicate_start_time"
  | "duplicate_location_id";

export type TimelineValidationIssue = {
  inputType: "scrobble" | "location";
  inputId: string | null;
  code: TimelineValidationIssueCode;
  message: string;
  excluded: boolean;
};

export type TimelineValidationResult = {
  validScrobbles: TimelineScrobble[];
  validLocationSamples: TimelineLocationSample[];
  issues: TimelineValidationIssue[];
};
