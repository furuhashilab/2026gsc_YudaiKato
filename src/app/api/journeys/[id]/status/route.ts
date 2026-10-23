import { NextResponse } from "next/server";

import { getJourney } from "@/lib/journeys";
import { getLatestJoinRunByJourney } from "@/lib/join-runs";
import { listJoinResultsByJoinRunId } from "@/lib/join-results";
import { listConfirmedListeningEventsWithTrack } from "@/lib/listening-events";
import { listLocationSamplesBySession } from "@/lib/location-samples";
import { getRecordingSession } from "@/lib/recording-sessions";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

/**
 * /journey/[id]/resultが現在の進捗を表示し、復旧（未完了処理の再実行）を判断するための状態を返す。
 * 件数はlistening_events・location_samples・join_resultsの実データから都度集計し、
 * クライアント側に一時的な状態を持たせずページ再読み込み後も同じ結果を再現できるようにする。
 */
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

    const recordingSession = await getRecordingSession(db, user.id, journey.sessionId);
    if (!recordingSession) {
      return NextResponse.json({ error: "Recording Sessionが見つかりません。" }, { status: 404 });
    }

    const [locationSamples, listeningEvents, latestJoinRun] = await Promise.all([
      listLocationSamplesBySession(db, journey.sessionId),
      listConfirmedListeningEventsWithTrack(db, journey.sessionId),
      getLatestJoinRunByJourney(db, journey.id),
    ]);
    const joinResults = latestJoinRun ? await listJoinResultsByJoinRunId(db, latestJoinRun.id) : [];

    return NextResponse.json({
      journey: { id: journey.id, startedAt: journey.startedAt, endedAt: journey.endedAt },
      recordingSession: {
        id: recordingSession.id,
        status: recordingSession.status,
        endedAt: recordingSession.endedAt,
      },
      locationSampleCount: locationSamples.length,
      listeningEventCount: listeningEvents.length,
      joinResultCount: joinResults.length,
      hasJoinRun: latestJoinRun !== null,
    });
  } catch (cause) {
    console.error("Failed to get journey status", cause);
    return NextResponse.json(
      { error: "Journeyの状態取得に失敗しました。" },
      { status: 500 },
    );
  }
}
