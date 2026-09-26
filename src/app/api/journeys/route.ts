import { NextResponse } from "next/server";

import { createJourney, listJourneys } from "@/lib/journeys";
import { getRecordingSession } from "@/lib/recording-sessions";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const items = await listJourneys(db, user.id);
    return NextResponse.json({ items });
  } catch (cause) {
    console.error("Failed to list journeys", cause);
    return NextResponse.json({ error: "Journeyの取得に失敗しました。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    sessionId?: string;
    startedAt?: string;
    algorithmVersion?: string;
    title?: string | null;
  } | null;

  if (!body?.sessionId) {
    return NextResponse.json({ error: "sessionIdは必須です。" }, { status: 400 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const recordingSession = await getRecordingSession(db, user.id, body.sessionId);
    if (!recordingSession) {
      return NextResponse.json({ error: "Recording Sessionが見つかりません。" }, { status: 404 });
    }

    const journey = await createJourney(db, {
      userId: user.id,
      sessionId: recordingSession.id,
      startedAt: body.startedAt ?? recordingSession.startedAt,
      algorithmVersion: body.algorithmVersion,
      title: body.title,
    });
    return NextResponse.json({ journey }, { status: 201 });
  } catch (cause) {
    console.error("Failed to create journey", cause);
    return NextResponse.json({ error: "Journeyの作成に失敗しました。" }, { status: 500 });
  }
}
