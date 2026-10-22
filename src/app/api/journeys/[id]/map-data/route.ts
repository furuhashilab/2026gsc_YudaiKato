import { NextResponse } from "next/server";

import { getJourney } from "@/lib/journeys";
import { listJoinResultsByJoinRunId } from "@/lib/join-results";
import type { JoinResult } from "@/lib/join-results";
import { getLatestJoinRunByJourney } from "@/lib/join-runs";
import { listConfirmedListeningEventsWithTrack } from "@/lib/listening-events";
import type { ListeningEventWithTrack } from "@/lib/listening-events";
import { listLocationSamplesBySession } from "@/lib/location-samples";
import type { LocationSample } from "@/lib/location-samples";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

/** GPSトラックを分割する間隔。連続する位置サンプルの時刻差がこれ以上なら別系列として扱う。 */
const GPS_TRACK_GAP_MS = 60_000;

type GeoJsonPosition = [number, number];

type SegmentGeometry =
  | { type: "Point"; coordinates: GeoJsonPosition }
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | null;

type SegmentProperties = {
  joinResultId: string;
  trackName: string;
  artistName: string;
  startedAt: string;
  estimatedEndedAt: string;
  matchStatus: string;
};

type SegmentFeature = {
  type: "Feature";
  geometry: SegmentGeometry;
  properties: SegmentProperties;
};

type GpsTrackGeometry =
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | { type: "MultiLineString"; coordinates: GeoJsonPosition[][] };

type GpsTrackFeatureCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: GpsTrackGeometry; properties: Record<string, never> }[];
};

function toPosition(sample: LocationSample): GeoJsonPosition {
  return [sample.longitude, sample.latitude];
}

/** 時刻差がGPS_TRACK_GAP_MS以上の箇所で系列を分割し、2点未満しかない孤立系列は捨てる。 */
function buildGpsTrack(samples: LocationSample[]): GpsTrackFeatureCollection {
  const runs: LocationSample[][] = [];
  for (const sample of samples) {
    const currentRun = runs[runs.length - 1];
    const previous = currentRun?.[currentRun.length - 1];
    const gapMs = previous
      ? new Date(sample.recordedAt).getTime() - new Date(previous.recordedAt).getTime()
      : null;
    if (!currentRun || (gapMs !== null && gapMs >= GPS_TRACK_GAP_MS)) {
      runs.push([sample]);
    } else {
      currentRun.push(sample);
    }
  }

  const lines = runs.filter((run) => run.length >= 2).map((run) => run.map(toPosition));
  if (lines.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const geometry: GpsTrackGeometry = lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };

  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties: {} }],
  };
}

/** 曲区間[event.startedAt, joinResult.estimatedEndedAt)に含まれる位置サンプルからFeatureを組み立てる。 */
function buildSegmentFeature(
  joinResult: JoinResult,
  event: ListeningEventWithTrack,
  samplesInRange: LocationSample[],
): SegmentFeature {
  const properties: SegmentProperties = {
    joinResultId: joinResult.id,
    trackName: event.trackName,
    artistName: event.artistName,
    startedAt: event.startedAt,
    estimatedEndedAt: joinResult.estimatedEndedAt,
    matchStatus: joinResult.matchStatus,
  };

  if (samplesInRange.length === 0) {
    return { type: "Feature", geometry: null, properties };
  }
  if (samplesInRange.length === 1) {
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: toPosition(samplesInRange[0]) },
      properties,
    };
  }
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: samplesInRange.map(toPosition) },
    properties,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const { id } = await params;
  const db = createSupabaseServiceRoleClient();

  try {
    const journey = await getJourney(db, user.id, id);
    if (!journey) {
      return NextResponse.json({ error: "Journeyが見つかりません。" }, { status: 404 });
    }

    const [locationSamples, listeningEvents, joinRun] = await Promise.all([
      listLocationSamplesBySession(db, journey.sessionId),
      listConfirmedListeningEventsWithTrack(db, journey.sessionId),
      getLatestJoinRunByJourney(db, journey.id),
    ]);

    const joinResults = joinRun ? await listJoinResultsByJoinRunId(db, joinRun.id) : [];
    const eventsById = new Map(listeningEvents.map((event) => [event.id, event]));

    const segments = joinResults.flatMap((joinResult) => {
      const event = eventsById.get(joinResult.listeningEventId);
      if (!event) return [];

      const startedAtMs = new Date(event.startedAt).getTime();
      const estimatedEndedAtMs = new Date(joinResult.estimatedEndedAt).getTime();
      const samplesInRange = locationSamples.filter((sample) => {
        const recordedAtMs = new Date(sample.recordedAt).getTime();
        return recordedAtMs >= startedAtMs && recordedAtMs < estimatedEndedAtMs;
      });

      return [{
        joinResultId: joinResult.id,
        trackName: event.trackName,
        artistName: event.artistName,
        startedAt: event.startedAt,
        estimatedEndedAt: joinResult.estimatedEndedAt,
        matchStatus: joinResult.matchStatus,
        geoJson: buildSegmentFeature(joinResult, event, samplesInRange),
      }];
    });

    return NextResponse.json({
      journey: {
        id: journey.id,
        startedAt: journey.startedAt,
        endedAt: journey.endedAt,
      },
      gpsTrack: buildGpsTrack(locationSamples),
      segments,
    });
  } catch (cause) {
    console.error("Failed to build journey map data", cause);
    return NextResponse.json(
      { error: "Journeyの地図データ取得に失敗しました。" },
      { status: 500 },
    );
  }
}
