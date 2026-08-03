import type {
  TimelineFixtureCase,
  TimelineLocationSample,
  TimelineScrobble,
} from "./types.ts";

const TOKYO_STATION = { latitude: 35.681236, longitude: 139.767125 };

function unixMs(iso: string) {
  return Date.parse(iso);
}

function createScrobble(
  id: string,
  playedAtUnixMs: number,
  durationMs: number | null,
  trackName: string,
  artistName = "Fixture Artist",
): TimelineScrobble {
  return {
    id,
    externalEventKey: `fixture:${id}`,
    trackName,
    artistName,
    playedAt: new Date(playedAtUnixMs).toISOString(),
    playedAtUnixMs,
    durationMs,
    source: "fixture",
  };
}

function createLocation(
  id: string,
  recordedAtUnixMs: number,
  index: number,
  accuracyM = 12,
): TimelineLocationSample {
  return {
    id,
    recordedAt: new Date(recordedAtUnixMs).toISOString(),
    recordedAtUnixMs,
    latitude: TOKYO_STATION.latitude + index * 0.00001,
    longitude: TOKYO_STATION.longitude + index * 0.00001,
    accuracyM,
    source: "fixture",
  };
}

function createLocationRange(
  idPrefix: string,
  startedAtUnixMs: number,
  endedAtUnixMs: number,
  intervalMs = 10_000,
) {
  const samples: TimelineLocationSample[] = [];
  for (let time = startedAtUnixMs, index = 0; time <= endedAtUnixMs; time += intervalMs, index += 1) {
    samples.push(createLocation(`${idPrefix}-${index}`, time, index, index % 9 === 0 ? 125 : 12));
  }
  return samples;
}

const caseABase = unixMs("2026-04-01T00:00:00.000Z");
const caseBBase = unixMs("2026-04-02T00:00:00.000Z");
const caseCBase = unixMs("2026-04-03T00:00:00.000Z");
const caseDBase = unixMs("2026-04-04T00:00:00.000Z");
const caseEBase = unixMs("2026-04-05T00:00:00.000Z");
const caseFBase = unixMs("2026-04-06T00:00:00.000Z");
const caseGBase = unixMs("2026-04-07T00:00:00.000Z");
const caseHBase = unixMs("2026-04-08T23:59:20.000Z");

export const TIMELINE_FIXTURE_CASES: TimelineFixtureCase[] = [
  {
    id: "A",
    label: "ケースA：正常な結合",
    purpose: "3曲と10秒間隔の位置ログを結合し、中間時刻付近の実サンプルを選ぶ。",
    expected: "3件すべて matched。",
    scrobbles: [
      createScrobble("case-a-1", caseABase, 150_000, "Morning Steps"),
      createScrobble("case-a-2", caseABase + 180_000, 150_000, "Crossing Lines"),
      createScrobble("case-a-3", caseABase + 360_000, 150_000, "Riverside Echo"),
    ],
    locationSamples: createLocationRange("case-a-location", caseABase, caseABase + 540_000),
  },
  {
    id: "B",
    label: "ケースB：位置サンプル不足",
    purpose: "2曲目の区間内を空にし、開始10秒前の位置を許容範囲から選ぶ。",
    expected: "2曲目が partial、ほか2件は matched。",
    scrobbles: [
      createScrobble("case-b-1", caseBBase, 120_000, "North Exit"),
      createScrobble("case-b-2", caseBBase + 180_000, 120_000, "Missing Corner"),
      createScrobble("case-b-3", caseBBase + 360_000, 120_000, "South Exit"),
    ],
    locationSamples: [
      createLocation("case-b-location-1", caseBBase + 60_000, 1),
      createLocation("case-b-location-edge", caseBBase + 170_000, 2),
      createLocation("case-b-location-3", caseBBase + 420_000, 3),
    ],
  },
  {
    id: "C",
    label: "ケースC：位置情報なし",
    purpose: "確定Scrobbleに対して位置サンプルが1件もない場合を確認する。",
    expected: "1件が unmatched。",
    scrobbles: [createScrobble("case-c-1", caseCBase, 180_000, "No Signal")],
    locationSamples: [],
  },
  {
    id: "D",
    label: "ケースD：同じ曲の連続再生",
    purpose: "同一曲・同一アーティストでも開始時刻とIDが異なる2イベントとして扱う。",
    expected: "同じ曲名の独立した結果が2件。",
    scrobbles: [
      createScrobble("case-d-repeat-1", caseDBase, 150_000, "Repeat Me", "Same Artist"),
      createScrobble("case-d-repeat-2", caseDBase + 180_000, 150_000, "Repeat Me", "Same Artist"),
    ],
    locationSamples: [
      createLocation("case-d-location-1", caseDBase + 90_000, 1),
      createLocation("case-d-location-2", caseDBase + 270_000, 2),
    ],
  },
  {
    id: "E",
    label: "ケースE：入力順がバラバラ",
    purpose: "Scrobbleと位置ログを逆順・混在順で渡し、Unixミリ秒で並べ直す。",
    expected: "case-e-1、2、3の時系列順で3件すべて matched。",
    scrobbles: [
      createScrobble("case-e-3", caseEBase + 360_000, 150_000, "Third Input"),
      createScrobble("case-e-1", caseEBase, 150_000, "First Input"),
      createScrobble("case-e-2", caseEBase + 180_000, 150_000, "Second Input"),
    ],
    locationSamples: [
      createLocation("case-e-location-3", caseEBase + 450_000, 3),
      createLocation("case-e-location-1", caseEBase + 90_000, 1),
      createLocation("case-e-location-2", caseEBase + 270_000, 2),
    ],
  },
  {
    id: "F",
    label: "ケースF：曲の長さが不明",
    purpose: "durationなしで、次曲がある区間と最後の曲のフォールバックを比較する。",
    expected: "endMethodが next_track と fallback。",
    scrobbles: [
      createScrobble("case-f-next", caseFBase, null, "Unknown With Next"),
      createScrobble("case-f-fallback", caseFBase + 240_000, null, "Unknown Last"),
    ],
    locationSamples: [
      createLocation("case-f-location-1", caseFBase + 120_000, 1),
      createLocation("case-f-location-2", caseFBase + 390_000, 2),
    ],
  },
  {
    id: "G",
    label: "ケースG：曲間に長い空白",
    purpose: "次曲まで65分空け、空白全体ではなく暫定フォールバック区間を使う。",
    expected: "1曲目が5分の fallback で、長い空白を曲区間に含めない。",
    scrobbles: [
      createScrobble("case-g-gap", caseGBase, null, "Before Long Gap"),
      createScrobble("case-g-after", caseGBase + 65 * 60_000, 120_000, "After Long Gap"),
    ],
    locationSamples: [
      createLocation("case-g-location-1", caseGBase + 150_000, 1),
      createLocation("case-g-location-2", caseGBase + 66 * 60_000, 2),
    ],
  },
  {
    id: "H",
    label: "ケースH：UTC日付またぎ",
    purpose: "UTC 23:59台から翌日へまたぐ区間をUnixミリ秒で処理し、JST表示も確認する。",
    expected: "UTC日付またぎ後も時系列・中間時刻・代表地点が正しい。",
    scrobbles: [
      createScrobble("case-h-before-midnight", caseHBase, 90_000, "UTC Midnight"),
      createScrobble("case-h-after-midnight", caseHBase + 120_000, 60_000, "Next UTC Day"),
    ],
    locationSamples: [
      createLocation("case-h-location-2", caseHBase + 180_000, 2),
      createLocation("case-h-location-1", caseHBase + 60_000, 1),
    ],
  },
];

export function getTimelineFixtureCase(id: string) {
  return TIMELINE_FIXTURE_CASES.find((fixture) => fixture.id === id) ?? TIMELINE_FIXTURE_CASES[0];
}
