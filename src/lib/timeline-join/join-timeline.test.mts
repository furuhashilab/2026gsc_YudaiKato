import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIMELINE_JOIN_CONFIG,
  joinScrobblesWithLocations,
} from "./join-timeline.ts";
import { TIMELINE_FIXTURE_CASES } from "./fixtures.ts";
import {
  convertLastFmTracksToTimelineScrobbles,
  createLastFmExternalEventKey,
} from "./lastfm-external-event-key.ts";
import type { TimelineLocationSample, TimelineScrobble } from "./types.ts";
import { validateTimelineInputs } from "./validation.ts";

const BASE = Date.parse("2026-05-01T00:00:00.000Z");

function scrobble(
  id: string,
  offsetMs: number,
  durationMs: number | null,
  trackName = id,
): TimelineScrobble {
  const playedAtUnixMs = BASE + offsetMs;
  return {
    id,
    externalEventKey: `fixture:${id}`,
    trackName,
    artistName: "Test Artist",
    playedAt: new Date(playedAtUnixMs).toISOString(),
    playedAtUnixMs,
    durationMs,
    source: "fixture",
  };
}

function location(
  id: string,
  offsetMs: number,
  accuracyM: number | null = 10,
): TimelineLocationSample {
  const recordedAtUnixMs = BASE + offsetMs;
  return {
    id,
    recordedAt: new Date(recordedAtUnixMs).toISOString(),
    recordedAtUnixMs,
    latitude: 35.68 + offsetMs / 1_000_000_000,
    longitude: 139.76 + offsetMs / 1_000_000_000,
    accuracyM,
    source: "fixture",
  };
}

test("入力を時系列順に処理し、入力配列を破壊しない", () => {
  const scrobbles = [
    scrobble("third", 360_000, 150_000),
    scrobble("first", 0, 150_000),
    scrobble("second", 180_000, 150_000),
  ];
  const locations = [
    location("third-location", 450_000),
    location("first-location", 90_000),
    location("second-location", 270_000),
  ];
  const originalScrobbleOrder = scrobbles.map((item) => item.id);
  const originalLocationOrder = locations.map((item) => item.id);

  const results = joinScrobblesWithLocations(scrobbles, locations);

  assert.deepEqual(results.map((result) => result.eventId), ["first", "second", "third"]);
  assert.deepEqual(scrobbles.map((item) => item.id), originalScrobbleOrder);
  assert.deepEqual(locations.map((item) => item.id), originalLocationOrder);
});

test("区間の中間時刻を計算し、区間内で最も近い実サンプルを選ぶ", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("middle", 0, 60_000)],
    [location("far", 10_000), location("nearest", 44_000), location("after", 80_000)],
  );

  assert.equal(results[0].segmentDurationMs, 90_000);
  assert.equal(results[0].midpointAtUnixMs, BASE + 45_000);
  assert.equal(results[0].representativeLocation?.id, "nearest");
  assert.equal(results[0].representativeDistanceFromMidpointMs, 1_000);
  assert.equal(results[0].locationMatchMethod, "inside_segment_midpoint");
  assert.equal(results[0].matchStatus, "matched");
});

test("中間時刻から同距離なら早い位置サンプルを安定して選ぶ", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("tie", 0, 60_000)],
    [location("later", 50_000), location("earlier", 40_000)],
  );

  assert.equal(results[0].midpointAtUnixMs, BASE + 45_000);
  assert.equal(results[0].representativeLocation?.id, "earlier");
});

test("区間外でも端から許容範囲内の位置サンプルならpartialにする", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("partial", 0, 60_000)],
    [location("edge", -20_000)],
  );

  assert.equal(results[0].matchStatus, "partial");
  assert.equal(results[0].locationMatchMethod, "nearest_within_tolerance");
  assert.equal(results[0].representativeLocation?.id, "edge");
  assert.ok(results[0].warnings.includes("no_sample_inside_segment"));
  assert.ok(results[0].warnings.includes("nearest_sample_outside_segment"));
});

test("位置サンプルが許容範囲にもなければunmatchedにする", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("unmatched", 0, 60_000)],
    [location("too-far", -31_000)],
  );

  assert.equal(results[0].matchStatus, "unmatched");
  assert.equal(results[0].locationMatchMethod, "none");
  assert.equal(results[0].representativeLocation, null);
  assert.ok(results[0].warnings.includes("location_sample_not_found"));
});

test("同じ曲の連続再生を開始時刻とIDが異なる別イベントとして残す", () => {
  const results = joinScrobblesWithLocations(
    [
      scrobble("repeat-1", 0, 150_000, "Same Track"),
      scrobble("repeat-2", 180_000, 150_000, "Same Track"),
    ],
    [location("first", 90_000), location("second", 270_000)],
  );

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.eventId), ["repeat-1", "repeat-2"]);
  assert.deepEqual(results.map((result) => result.trackName), ["Same Track", "Same Track"]);
});

test("duration候補が次曲より早い場合はdurationで終了する", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("duration", 0, 60_000), scrobble("next", 120_000, 60_000)],
    [],
  );

  assert.equal(results[0].estimatedEndedAtUnixMs, BASE + 90_000);
  assert.equal(results[0].endMethod, "duration");
});

test("duration候補より次曲が早い場合は次曲開始で区切る", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("overlap", 0, 180_000), scrobble("next", 120_000, 60_000)],
    [],
  );

  assert.equal(results[0].estimatedEndedAtUnixMs, BASE + 120_000);
  assert.equal(results[0].endMethod, "duration_and_next_track");
});

test("durationなしで近い次曲があればnext_track、最後ならfallbackを使う", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("with-next", 0, null), scrobble("last", 240_000, null)],
    [],
  );

  assert.equal(results[0].endMethod, "next_track");
  assert.equal(results[0].estimatedEndedAtUnixMs, BASE + 240_000);
  assert.deepEqual(results[0].warnings.slice(0, 1), ["duration_missing"]);
  assert.equal(results[1].endMethod, "fallback");
  assert.equal(results[1].segmentDurationMs, DEFAULT_TIMELINE_JOIN_CONFIG.fallbackDurationMs);
  assert.ok(results[1].warnings.includes("fallback_end_used"));
});

test("次曲までの長い空白を曲区間にせずフォールバックで制限する", () => {
  const nextOffset = DEFAULT_TIMELINE_JOIN_CONFIG.maxTrackWindowMs + 3_600_000;
  const results = joinScrobblesWithLocations(
    [scrobble("before-gap", 0, null), scrobble("after-gap", nextOffset, 60_000)],
    [],
  );

  assert.equal(results[0].endMethod, "fallback");
  assert.equal(results[0].segmentDurationMs, DEFAULT_TIMELINE_JOIN_CONFIG.fallbackDurationMs);
  assert.ok(results[0].warnings.includes("next_track_gap_exceeds_max_window"));
});

test("UTC日付またぎもUnixミリ秒を基準に処理する", () => {
  const utcStart = Date.parse("2026-05-01T23:59:20.000Z");
  const localBaseOffset = utcStart - BASE;
  const results = joinScrobblesWithLocations(
    [
      scrobble("before-midnight", localBaseOffset, 90_000),
      scrobble("after-midnight", localBaseOffset + 120_000, 60_000),
    ],
    [location("after-midnight-location", localBaseOffset + 60_000)],
  );

  assert.equal(results[0].startedAt, "2026-05-01T23:59:20.000Z");
  assert.equal(results[0].estimatedEndedAt, "2026-05-02T00:01:20.000Z");
  assert.equal(results[0].midpointAt, "2026-05-02T00:00:20.000Z");
  assert.equal(results[0].representativeLocation?.id, "after-midnight-location");
});

test("代表地点の精度が暫定閾値を超えても除外せず警告する", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("low-accuracy", 0, 60_000)],
    [location("kept", 45_000, DEFAULT_TIMELINE_JOIN_CONFIG.lowAccuracyWarningThresholdM + 1)],
  );

  assert.equal(results[0].matchStatus, "matched");
  assert.equal(results[0].representativeLocation?.id, "kept");
  assert.ok(results[0].warnings.includes("low_location_accuracy"));
});

test("曲境界ちょうどの位置サンプルを次の曲だけに所属させる", () => {
  const boundaryLocation = location("boundary", 180_000);
  const results = joinScrobblesWithLocations(
    [scrobble("track-a", 0, 150_000), scrobble("track-b", 180_000, 150_000)],
    [boundaryLocation],
  );

  assert.equal(results[0].estimatedEndedAtUnixMs, BASE + 180_000);
  assert.deepEqual(results[0].locationSamples, []);
  assert.equal(results[0].representativeLocation, null);
  assert.deepEqual(results[1].locationSamples.map((sample) => sample.id), ["boundary"]);
  assert.equal(
    results.flatMap((result) => result.locationSamples).filter((sample) => sample.id === "boundary").length,
    1,
  );
});

test("半開区間は開始時刻を含み終了時刻を含まない", () => {
  const results = joinScrobblesWithLocations(
    [scrobble("half-open", 0, 60_000)],
    [location("at-start", 0), location("at-end", 90_000)],
  );

  assert.deepEqual(results[0].locationSamples.map((sample) => sample.id), ["at-start"]);
  assert.equal(results[0].representativeLocation?.id, "at-start");
});

test("Last.fm変換後のexternalEventKeyはAPI返却順に依存しない", () => {
  const target = {
    trackName: "Stable Track",
    artistName: "Stable Artist",
    nowPlaying: false,
    playedAt: new Date(BASE).toISOString(),
    playedAtUnix: BASE / 1_000,
  };
  const other = {
    ...target,
    trackName: "Other Track",
    playedAtUnix: BASE / 1_000 + 60,
    playedAt: new Date(BASE + 60_000).toISOString(),
  };
  const firstOrder = convertLastFmTracksToTimelineScrobbles([target, other], "listener");
  const secondOrder = convertLastFmTracksToTimelineScrobbles([other, target], "listener");

  const firstKey = firstOrder.find((item) => item.trackName === target.trackName)?.externalEventKey;
  const secondKey = secondOrder.find((item) => item.trackName === target.trackName)?.externalEventKey;
  assert.equal(firstKey, secondKey);
  assert.equal(firstOrder[0].id, firstOrder[0].externalEventKey);
});

test("externalEventKeyはUnicode・空白・大文字小文字を正規化する", () => {
  const common = { username: " Listener ", playedAtUnixMs: BASE };
  const first = createLastFmExternalEventKey({
    ...common,
    artistName: " Artist Name ",
    trackName: " Track Name ",
  });
  const second = createLastFmExternalEventKey({
    ...common,
    artistName: "artist   name",
    trackName: "track   name",
  });
  const third = createLastFmExternalEventKey({
    ...common,
    artistName: "ＡＲＴＩＳＴ　ＮＡＭＥ",
    trackName: "ＴＲＡＣＫ　ＮＡＭＥ",
  });

  assert.equal(first, second);
  assert.equal(second, third);
});

test("ユーザー・開始時刻・アーティスト・曲のいずれかが異なれば別externalEventKeyになる", () => {
  const input = {
    username: "listener",
    playedAtUnixMs: BASE,
    artistName: "Artist",
    trackName: "Track",
  };
  const keys = [
    createLastFmExternalEventKey(input),
    createLastFmExternalEventKey({ ...input, username: "another-listener" }),
    createLastFmExternalEventKey({ ...input, playedAtUnixMs: BASE + 1_000 }),
    createLastFmExternalEventKey({ ...input, artistName: "Another Artist" }),
    createLastFmExternalEventKey({ ...input, trackName: "Another Track" }),
  ];

  assert.equal(new Set(keys).size, keys.length);
});

test("NaNのScrobble時刻をinvalid_timestampとして除外し結合を継続する", () => {
  const invalid = { ...scrobble("nan-time", 0, 60_000), playedAtUnixMs: Number.NaN };
  const validation = validateTimelineInputs([invalid], []);

  assert.doesNotThrow(() => joinScrobblesWithLocations([invalid], []));
  assert.deepEqual(joinScrobblesWithLocations([invalid], []), []);
  assert.ok(validation.issues.some((issue) => issue.code === "invalid_timestamp"));
});

test("有限でも日時表現範囲外の時刻をinvalid_timestampとして除外する", () => {
  const invalid = { ...scrobble("out-of-range-time", 0, 60_000), playedAtUnixMs: 1e20 };
  const validation = validateTimelineInputs([invalid], []);

  assert.ok(validation.issues.some((issue) => issue.code === "invalid_timestamp"));
  assert.doesNotThrow(() => joinScrobblesWithLocations([invalid], []));
  assert.deepEqual(joinScrobblesWithLocations([invalid], []), []);
});

test("正負InfinityのScrobble時刻をinvalid_timestampとして除外する", () => {
  for (const [id, timestamp] of [["positive-infinity", Infinity], ["negative-infinity", -Infinity]] as const) {
    const invalid = { ...scrobble(id, 0, 60_000), playedAtUnixMs: timestamp };
    const validation = validateTimelineInputs([invalid], []);
    assert.equal(validation.validScrobbles.length, 0);
    assert.ok(validation.issues.some((issue) => issue.code === "invalid_timestamp"));
    assert.doesNotThrow(() => joinScrobblesWithLocations([invalid], []));
  }
});

test("非有限の位置時刻をinvalid_timestampとして除外する", () => {
  const invalidLocations = [
    { ...location("location-nan-time", 0), recordedAtUnixMs: Number.NaN },
    { ...location("location-infinite-time", 1_000), recordedAtUnixMs: Infinity },
  ];
  const validation = validateTimelineInputs([], invalidLocations);

  assert.equal(validation.validLocationSamples.length, 0);
  assert.equal(
    validation.issues.filter((issue) => issue.code === "invalid_timestamp").length,
    invalidLocations.length,
  );
  assert.doesNotThrow(() => joinScrobblesWithLocations([], invalidLocations));
});

test("0・負数・NaN・Infinity・日時範囲超過のdurationをinvalid_durationとして除外する", () => {
  const invalidDurations = [0, -1_000, Number.NaN, Infinity, Number.MAX_VALUE];
  for (const [index, durationMs] of invalidDurations.entries()) {
    const invalid = scrobble(`invalid-duration-${index}`, index * 1_000, durationMs);
    const validation = validateTimelineInputs([invalid], []);
    assert.equal(validation.validScrobbles.length, 0);
    assert.ok(validation.issues.some((issue) => issue.code === "invalid_duration"));
  }
});

test("空の曲名とアーティスト名を検出して除外する", () => {
  const emptyTrack = { ...scrobble("empty-track", 0, 60_000), trackName: "   " };
  const emptyArtist = { ...scrobble("empty-artist", 120_000, 60_000), artistName: "\t" };
  const validation = validateTimelineInputs([emptyTrack, emptyArtist], []);

  assert.equal(validation.validScrobbles.length, 0);
  assert.ok(validation.issues.some((issue) => issue.code === "empty_track_name"));
  assert.ok(validation.issues.some((issue) => issue.code === "empty_artist_name"));
});

test("範囲外・非有限の緯度経度をinvalid_coordinateとして除外する", () => {
  const invalidLocations = [
    { ...location("lat-high", 0), latitude: 91 },
    { ...location("lat-low", 1_000), latitude: -91 },
    { ...location("lng-high", 2_000), longitude: 181 },
    { ...location("lng-low", 3_000), longitude: -181 },
    { ...location("lat-nan", 4_000), latitude: Number.NaN },
    { ...location("lng-infinity", 5_000), longitude: Infinity },
  ];
  const validation = validateTimelineInputs([], invalidLocations);

  assert.equal(validation.validLocationSamples.length, 0);
  assert.equal(
    validation.issues.filter((issue) => issue.code === "invalid_coordinate").length,
    invalidLocations.length,
  );
});

test("負数・非有限のaccuracyをinvalid_accuracyとして除外する", () => {
  const invalidLocations = [
    location("negative-accuracy", 0, -1),
    location("nan-accuracy", 1_000, Number.NaN),
    location("infinite-accuracy", 2_000, Infinity),
  ];
  const validation = validateTimelineInputs([], invalidLocations);

  assert.equal(validation.validLocationSamples.length, 0);
  assert.equal(
    validation.issues.filter((issue) => issue.code === "invalid_accuracy").length,
    invalidLocations.length,
  );
});

test("同一開始時刻はexternalEventKey順の1件だけを残し0ms区間を生成しない", () => {
  const laterKey = { ...scrobble("event-z", 0, 60_000), externalEventKey: "fixture:z" };
  const earlierKey = { ...scrobble("event-a", 0, 60_000), externalEventKey: "fixture:a" };

  for (const inputs of [[laterKey, earlierKey], [earlierKey, laterKey]]) {
    const validation = validateTimelineInputs(inputs, []);
    const results = joinScrobblesWithLocations(inputs, []);
    assert.deepEqual(validation.validScrobbles.map((item) => item.id), ["event-a"]);
    assert.ok(validation.issues.some((issue) => issue.code === "duplicate_start_time"));
    assert.deepEqual(results.map((result) => result.eventId), ["event-a"]);
    assert.ok(results.every((result) => result.segmentDurationMs > 0));
  }
});

test("重複した位置IDは時刻・座標順の1件だけを残す", () => {
  const later = location("duplicate-location", 20_000);
  const earlier = location("duplicate-location", 10_000);
  const validation = validateTimelineInputs([], [later, earlier]);

  assert.deepEqual(
    validation.validLocationSamples.map((sample) => sample.recordedAtUnixMs),
    [earlier.recordedAtUnixMs],
  );
  assert.ok(validation.issues.some((issue) => issue.code === "duplicate_location_id"));
});

test("入力検証と結合は不正入力を含む元配列を変更しない", () => {
  const scrobbles = [
    scrobble("valid", 0, 60_000),
    { ...scrobble("invalid", 120_000, 60_000), durationMs: -1 },
  ];
  const locations = [location("later", 40_000), location("earlier", 20_000)];
  const scrobbleOrder = scrobbles.map((item) => item.id);
  const locationOrder = locations.map((item) => item.id);

  validateTimelineInputs(scrobbles, locations);
  joinScrobblesWithLocations(scrobbles, locations);

  assert.deepEqual(scrobbles.map((item) => item.id), scrobbleOrder);
  assert.deepEqual(locations.map((item) => item.id), locationOrder);
  assert.equal(scrobbles[1].durationMs, -1);
});

test("Fixture A〜Hの期待件数と主要終了方法を維持する", () => {
  const expectedSummaries = {
    A: { matched: 3, partial: 0, unmatched: 0 },
    B: { matched: 2, partial: 1, unmatched: 0 },
    C: { matched: 0, partial: 0, unmatched: 1 },
    D: { matched: 2, partial: 0, unmatched: 0 },
    E: { matched: 3, partial: 0, unmatched: 0 },
    F: { matched: 2, partial: 0, unmatched: 0 },
    G: { matched: 2, partial: 0, unmatched: 0 },
    H: { matched: 2, partial: 0, unmatched: 0 },
  } as const;

  for (const fixture of TIMELINE_FIXTURE_CASES) {
    const validation = validateTimelineInputs(fixture.scrobbles, fixture.locationSamples);
    const results = joinScrobblesWithLocations(fixture.scrobbles, fixture.locationSamples);
    const summary = results.reduce(
      (counts, result) => ({ ...counts, [result.matchStatus]: counts[result.matchStatus] + 1 }),
      { matched: 0, partial: 0, unmatched: 0 },
    );
    assert.equal(validation.issues.length, 0, `Fixture ${fixture.id} validation`);
    assert.deepEqual(summary, expectedSummaries[fixture.id as keyof typeof expectedSummaries]);
  }

  const fixtureF = TIMELINE_FIXTURE_CASES.find((fixture) => fixture.id === "F")!;
  const fixtureG = TIMELINE_FIXTURE_CASES.find((fixture) => fixture.id === "G")!;
  assert.deepEqual(
    joinScrobblesWithLocations(fixtureF.scrobbles, fixtureF.locationSamples).map((result) => result.endMethod),
    ["next_track", "fallback"],
  );
  assert.equal(
    joinScrobblesWithLocations(fixtureG.scrobbles, fixtureG.locationSamples)[0].segmentDurationMs,
    DEFAULT_TIMELINE_JOIN_CONFIG.fallbackDurationMs,
  );
});
