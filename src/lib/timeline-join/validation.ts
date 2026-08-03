import type {
  TimelineLocationSample,
  TimelineScrobble,
  TimelineValidationIssue,
  TimelineValidationResult,
} from "./types.ts";

function inputId(value: { id: string }) {
  return value.id.trim() ? value.id : null;
}

function isRepresentableTimestamp(value: number) {
  return Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
}

function compareDuplicateScrobbleCandidates(left: TimelineScrobble, right: TimelineScrobble) {
  return left.externalEventKey.localeCompare(right.externalEventKey)
    || left.id.localeCompare(right.id)
    || left.artistName.localeCompare(right.artistName)
    || left.trackName.localeCompare(right.trackName)
    || String(left.durationMs).localeCompare(String(right.durationMs))
    || left.source.localeCompare(right.source)
    || left.playedAt.localeCompare(right.playedAt);
}

function compareDuplicateLocationCandidates(
  left: TimelineLocationSample,
  right: TimelineLocationSample,
) {
  return left.recordedAtUnixMs - right.recordedAtUnixMs
    || left.latitude - right.latitude
    || left.longitude - right.longitude
    || String(left.accuracyM).localeCompare(String(right.accuracyM))
    || left.recordedAt.localeCompare(right.recordedAt)
    || left.source.localeCompare(right.source);
}

export function validateTimelineInputs(
  scrobbles: TimelineScrobble[],
  locationSamples: TimelineLocationSample[],
): TimelineValidationResult {
  const issues: TimelineValidationIssue[] = [];
  const invalidScrobbleIndexes = new Set<number>();
  const invalidLocationIndexes = new Set<number>();

  scrobbles.forEach((scrobble, index) => {
    const id = inputId(scrobble);
    const addIssue = (issue: Omit<TimelineValidationIssue, "inputType" | "inputId" | "excluded">) => {
      issues.push({ inputType: "scrobble", inputId: id, excluded: true, ...issue });
      invalidScrobbleIndexes.add(index);
    };

    if (!isRepresentableTimestamp(scrobble.playedAtUnixMs)) {
      addIssue({ code: "invalid_timestamp", message: "再生開始時刻が有効なUnixミリ秒ではありません。" });
    }
    if (
      scrobble.durationMs !== null
      && (
        !Number.isFinite(scrobble.durationMs)
        || scrobble.durationMs <= 0
        || (
          isRepresentableTimestamp(scrobble.playedAtUnixMs)
          && !isRepresentableTimestamp(scrobble.playedAtUnixMs + scrobble.durationMs)
        )
      )
    ) {
      addIssue({ code: "invalid_duration", message: "durationMsはnullまたは正の有限数である必要があります。" });
    }
    if (!scrobble.trackName.trim()) {
      addIssue({ code: "empty_track_name", message: "曲名が空です。" });
    }
    if (!scrobble.artistName.trim()) {
      addIssue({ code: "empty_artist_name", message: "アーティスト名が空です。" });
    }
  });

  const candidatesByStartTime = new Map<number, Array<{ item: TimelineScrobble; index: number }>>();
  scrobbles.forEach((item, index) => {
    if (invalidScrobbleIndexes.has(index)) return;
    const candidates = candidatesByStartTime.get(item.playedAtUnixMs) ?? [];
    candidates.push({ item, index });
    candidatesByStartTime.set(item.playedAtUnixMs, candidates);
  });

  for (const [, candidates] of [...candidatesByStartTime].sort(([left], [right]) => left - right)) {
    if (candidates.length < 2) continue;
    const sortedCandidates = [...candidates].sort((left, right) => (
      compareDuplicateScrobbleCandidates(left.item, right.item)
    ));
    const retained = sortedCandidates[0];
    for (const duplicate of sortedCandidates.slice(1)) {
      invalidScrobbleIndexes.add(duplicate.index);
      issues.push({
        inputType: "scrobble",
        inputId: inputId(duplicate.item),
        code: "duplicate_start_time",
        message: `同一開始時刻の競合です。externalEventKey順で ${retained.item.id} を残しました。`,
        excluded: true,
      });
    }
  }

  locationSamples.forEach((sample, index) => {
    const id = inputId(sample);
    const addIssue = (issue: Omit<TimelineValidationIssue, "inputType" | "inputId" | "excluded">) => {
      issues.push({ inputType: "location", inputId: id, excluded: true, ...issue });
      invalidLocationIndexes.add(index);
    };

    if (!isRepresentableTimestamp(sample.recordedAtUnixMs)) {
      addIssue({ code: "invalid_timestamp", message: "位置記録時刻が有効なUnixミリ秒ではありません。" });
    }
    if (
      !Number.isFinite(sample.latitude)
      || sample.latitude < -90
      || sample.latitude > 90
      || !Number.isFinite(sample.longitude)
      || sample.longitude < -180
      || sample.longitude > 180
    ) {
      addIssue({ code: "invalid_coordinate", message: "緯度または経度が有効範囲外です。" });
    }
    if (
      sample.accuracyM !== null
      && (!Number.isFinite(sample.accuracyM) || sample.accuracyM < 0)
    ) {
      addIssue({ code: "invalid_accuracy", message: "accuracyMはnullまたは0以上の有限数である必要があります。" });
    }
  });

  const candidatesByLocationId = new Map<string, Array<{ item: TimelineLocationSample; index: number }>>();
  locationSamples.forEach((item, index) => {
    if (invalidLocationIndexes.has(index)) return;
    const candidates = candidatesByLocationId.get(item.id) ?? [];
    candidates.push({ item, index });
    candidatesByLocationId.set(item.id, candidates);
  });

  for (const [id, candidates] of [...candidatesByLocationId].sort(([left], [right]) => left.localeCompare(right))) {
    if (candidates.length < 2) continue;
    const sortedCandidates = [...candidates].sort((left, right) => (
      compareDuplicateLocationCandidates(left.item, right.item)
    ));
    const retained = sortedCandidates[0];
    for (const duplicate of sortedCandidates.slice(1)) {
      invalidLocationIndexes.add(duplicate.index);
      issues.push({
        inputType: "location",
        inputId: inputId(duplicate.item),
        code: "duplicate_location_id",
        message: `位置IDが重複しています。時刻・座標順で ${retained.item.recordedAt} のサンプルを残しました（ID: ${id}）。`,
        excluded: true,
      });
    }
  }

  return {
    validScrobbles: scrobbles.filter((_, index) => !invalidScrobbleIndexes.has(index)),
    validLocationSamples: locationSamples.filter((_, index) => !invalidLocationIndexes.has(index)),
    issues,
  };
}
