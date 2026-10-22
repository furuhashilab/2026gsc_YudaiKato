import { NextResponse } from "next/server";

import { getJourney } from "@/lib/journeys";
import {
  createJoinRunWithResults,
  DEFAULT_JOIN_ALGORITHM_CONFIG,
  DEFAULT_JOIN_ALGORITHM_VERSION,
} from "@/lib/join-runs";
import { listConfirmedListeningEventsWithTrack } from "@/lib/listening-events";
import type { ListeningEventWithTrack } from "@/lib/listening-events";
import { listLocationSamplesBySession } from "@/lib/location-samples";
import type { LocationSample } from "@/lib/location-samples";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";
import { joinScrobblesWithLocations } from "@/lib/timeline-join";
import type { TimelineLocationSample, TimelineScrobble } from "@/lib/timeline-join";

function toTimelineScrobble(event: ListeningEventWithTrack): TimelineScrobble {
  return {
    id: event.id,
    externalEventKey: event.externalEventKey,
    trackName: event.trackName,
    artistName: event.artistName,
    playedAt: event.startedAt,
    playedAtUnixMs: Date.parse(event.startedAt),
    durationMs: null,
    source: "lastfm",
  };
}

function toTimelineLocationSample(sample: LocationSample): TimelineLocationSample {
  return {
    id: sample.id,
    recordedAt: sample.recordedAt,
    recordedAtUnixMs: Date.parse(sample.recordedAt),
    latitude: sample.latitude,
    longitude: sample.longitude,
    accuracyM: sample.accuracyM,
    source: "geolocation",
  };
}

export async function POST(
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

    const [locationSamples, listeningEvents] = await Promise.all([
      listLocationSamplesBySession(db, journey.sessionId),
      listConfirmedListeningEventsWithTrack(db, journey.sessionId),
    ]);

    const scrobbles = listeningEvents.map(toTimelineScrobble);
    const timelineLocationSamples = locationSamples.map(toTimelineLocationSample);
    const results = joinScrobblesWithLocations(scrobbles, timelineLocationSamples);

    const joinRun = await createJoinRunWithResults(
      db,
      {
        journeyId: journey.id,
        algorithmVersion: DEFAULT_JOIN_ALGORITHM_VERSION,
        algorithmConfig: DEFAULT_JOIN_ALGORITHM_CONFIG,
      },
      results.map((result) => ({
        listeningEventId: result.eventId,
        representativeLocationId: null,
        estimatedEndedAt: result.estimatedEndedAt,
        endMethod: result.endMethod,
        matchStatus: result.matchStatus,
        locationSampleCount: result.locationSampleCount,
        warnings: result.warnings,
      })),
    );

    return NextResponse.json(
      {
        joinRunId: joinRun.id,
        algorithmVersion: joinRun.algorithmVersion,
        listeningEventCount: listeningEvents.length,
        locationSampleCount: locationSamples.length,
        joinedCount: results.length,
      },
      { status: 201 },
    );
  } catch (cause) {
    console.error("Failed to join timeline for journey", cause);
    return NextResponse.json(
      { error: "Journeyの結合処理に失敗しました。" },
      { status: 500 },
    );
  }
}
