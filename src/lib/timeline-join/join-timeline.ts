import type {
  TimelineEndMethod,
  TimelineJoinConfig,
  TimelineJoinResult,
  TimelineJoinWarning,
  TimelineLocationSample,
  TimelineScrobble,
} from "./types.ts";
import { validateTimelineInputs } from "./validation.ts";

/**
 * 技術検証用の暫定値。実GPSログでの評価後に変更する前提であり、
 * Recorded Spotの確定仕様を表す値ではない。
 */
export const DEFAULT_TIMELINE_JOIN_CONFIG: TimelineJoinConfig = {
  durationToleranceMs: 30_000,
  fallbackDurationMs: 5 * 60_000,
  maxTrackWindowMs: 30 * 60_000,
  locationEdgeToleranceMs: 30_000,
  lowAccuracyWarningThresholdM: 100,
};

type EndEstimate = {
  endedAtUnixMs: number;
  method: TimelineEndMethod;
  warnings: TimelineJoinWarning[];
};

function compareScrobbles(left: TimelineScrobble, right: TimelineScrobble) {
  return left.playedAtUnixMs - right.playedAtUnixMs
    || left.id.localeCompare(right.id)
    || left.artistName.localeCompare(right.artistName)
    || left.trackName.localeCompare(right.trackName);
}

function compareLocations(left: TimelineLocationSample, right: TimelineLocationSample) {
  return left.recordedAtUnixMs - right.recordedAtUnixMs || left.id.localeCompare(right.id);
}

function isRepresentableTimestamp(value: number) {
  return Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function estimateEnd(
  scrobble: TimelineScrobble,
  nextScrobble: TimelineScrobble | undefined,
  config: TimelineJoinConfig,
): EndEstimate {
  const startedAtUnixMs = scrobble.playedAtUnixMs;
  const hasDuration = scrobble.durationMs !== null
    && Number.isFinite(scrobble.durationMs)
    && scrobble.durationMs > 0;

  if (hasDuration) {
    const durationEnd = startedAtUnixMs + scrobble.durationMs! + config.durationToleranceMs;
    if (!nextScrobble || durationEnd < nextScrobble.playedAtUnixMs) {
      return { endedAtUnixMs: durationEnd, method: "duration", warnings: [] };
    }

    return {
      endedAtUnixMs: nextScrobble.playedAtUnixMs,
      method: "duration_and_next_track",
      warnings: [],
    };
  }

  const warnings: TimelineJoinWarning[] = ["duration_missing"];
  if (nextScrobble) {
    const gapToNextTrackMs = nextScrobble.playedAtUnixMs - startedAtUnixMs;
    if (gapToNextTrackMs <= config.maxTrackWindowMs) {
      return {
        endedAtUnixMs: nextScrobble.playedAtUnixMs,
        method: "next_track",
        warnings,
      };
    }
    warnings.push("next_track_gap_exceeds_max_window");
  }

  // フォールバックは検証用。設定が逆転しても最大曲区間を超えないよう上限をかける。
  const fallbackWindowMs = Math.min(config.fallbackDurationMs, config.maxTrackWindowMs);
  warnings.push("fallback_end_used");
  return {
    endedAtUnixMs: startedAtUnixMs + fallbackWindowMs,
    method: "fallback",
    warnings,
  };
}

function nearestToTimestamp(
  samples: TimelineLocationSample[],
  targetUnixMs: number,
): TimelineLocationSample | null {
  let selected: TimelineLocationSample | null = null;

  for (const sample of samples) {
    if (!selected) {
      selected = sample;
      continue;
    }

    const selectedDistance = Math.abs(selected.recordedAtUnixMs - targetUnixMs);
    const candidateDistance = Math.abs(sample.recordedAtUnixMs - targetUnixMs);
    if (
      candidateDistance < selectedDistance
      || (candidateDistance === selectedDistance && compareLocations(sample, selected) < 0)
    ) {
      selected = sample;
    }
  }

  return selected;
}

function distanceFromSegmentEdge(
  sample: TimelineLocationSample,
  startedAtUnixMs: number,
  endedAtUnixMs: number,
) {
  if (sample.recordedAtUnixMs < startedAtUnixMs) {
    return startedAtUnixMs - sample.recordedAtUnixMs;
  }
  if (sample.recordedAtUnixMs > endedAtUnixMs) {
    return sample.recordedAtUnixMs - endedAtUnixMs;
  }
  return 0;
}

function nearestOutsideSegment(
  samples: TimelineLocationSample[],
  startedAtUnixMs: number,
  endedAtUnixMs: number,
): { sample: TimelineLocationSample; edgeDistanceMs: number } | null {
  let selected: TimelineLocationSample | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    // 半開区間の終了境界は、区間外の許容補完でも前曲へ再利用しない。
    if (sample.recordedAtUnixMs === endedAtUnixMs) continue;
    const candidateDistance = distanceFromSegmentEdge(sample, startedAtUnixMs, endedAtUnixMs);
    if (
      candidateDistance < selectedDistance
      || (
        candidateDistance === selectedDistance
        && selected
        && compareLocations(sample, selected) < 0
      )
    ) {
      selected = sample;
      selectedDistance = candidateDistance;
    }
  }

  return selected ? { sample: selected, edgeDistanceMs: selectedDistance } : null;
}

/**
 * 確定Scrobbleと位置サンプルをUnixミリ秒で結合する純粋関数。
 * 入力配列を変更せず、ブラウザAPI・React・DOM・ネットワークへ依存しない。
 */
export function joinScrobblesWithLocations(
  scrobbles: TimelineScrobble[],
  locationSamples: TimelineLocationSample[],
  config: TimelineJoinConfig = DEFAULT_TIMELINE_JOIN_CONFIG,
): TimelineJoinResult[] {
  const validation = validateTimelineInputs(scrobbles, locationSamples);
  const sortedScrobbles = [...validation.validScrobbles].sort(compareScrobbles);
  const sortedLocations = [...validation.validLocationSamples].sort(compareLocations);

  return sortedScrobbles.flatMap<TimelineJoinResult>((scrobble, index) => {
    const nextScrobble = sortedScrobbles[index + 1];
    const end = estimateEnd(scrobble, nextScrobble, config);
    const startedAtUnixMs = scrobble.playedAtUnixMs;
    const estimatedEndedAtUnixMs = Math.max(startedAtUnixMs, end.endedAtUnixMs);
    const segmentDurationMs = estimatedEndedAtUnixMs - startedAtUnixMs;
    const midpointAtUnixMs = startedAtUnixMs + segmentDurationMs / 2;
    if (
      !isRepresentableTimestamp(estimatedEndedAtUnixMs)
      || !isRepresentableTimestamp(midpointAtUnixMs)
    ) {
      return [];
    }
    const insideSamples = sortedLocations.filter((sample) => (
      sample.recordedAtUnixMs >= startedAtUnixMs
      && sample.recordedAtUnixMs < estimatedEndedAtUnixMs
    ));

    const warnings = [...end.warnings];
    let representativeLocation: TimelineLocationSample | null = null;
    let locationMatchMethod: TimelineJoinResult["locationMatchMethod"] = "none";
    let matchStatus: TimelineJoinResult["matchStatus"] = "unmatched";

    if (insideSamples.length > 0) {
      representativeLocation = nearestToTimestamp(insideSamples, midpointAtUnixMs);
      locationMatchMethod = "inside_segment_midpoint";
      matchStatus = "matched";
    } else {
      warnings.push("no_sample_inside_segment");
      const outside = nearestOutsideSegment(
        sortedLocations,
        startedAtUnixMs,
        estimatedEndedAtUnixMs,
      );
      if (outside && outside.edgeDistanceMs <= config.locationEdgeToleranceMs) {
        representativeLocation = outside.sample;
        locationMatchMethod = "nearest_within_tolerance";
        matchStatus = "partial";
        warnings.push("nearest_sample_outside_segment");
      } else {
        warnings.push("location_sample_not_found");
      }
    }

    if (
      representativeLocation?.accuracyM !== null
      && representativeLocation?.accuracyM !== undefined
      && representativeLocation.accuracyM > config.lowAccuracyWarningThresholdM
    ) {
      warnings.push("low_location_accuracy");
    }

    return [{
      eventId: scrobble.id,
      externalEventKey: scrobble.externalEventKey,
      trackName: scrobble.trackName,
      artistName: scrobble.artistName,
      startedAt: new Date(startedAtUnixMs).toISOString(),
      startedAtUnixMs,
      estimatedEndedAt: new Date(estimatedEndedAtUnixMs).toISOString(),
      estimatedEndedAtUnixMs,
      endMethod: end.method,
      durationMs: scrobble.durationMs,
      segmentDurationMs,
      midpointAt: new Date(midpointAtUnixMs).toISOString(),
      midpointAtUnixMs,
      locationSamples: insideSamples,
      locationSampleCount: insideSamples.length,
      representativeLocation,
      representativeDistanceFromMidpointMs: representativeLocation
        ? Math.abs(representativeLocation.recordedAtUnixMs - midpointAtUnixMs)
        : null,
      locationMatchMethod,
      matchStatus,
      warnings,
    }];
  });
}
