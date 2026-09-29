import { NextResponse } from "next/server";

import { endRecordingSession, getRecordingSession } from "@/lib/recording-sessions";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

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
    const recordingSession = await getRecordingSession(db, user.id, id);
    if (!recordingSession) {
      return NextResponse.json({ error: "Recording Sessionが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ recordingSession });
  } catch (cause) {
    console.error("Failed to get recording session", cause);
    return NextResponse.json(
      { error: "Recording Sessionの取得に失敗しました。" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const recordingSession = await getRecordingSession(db, user.id, id);
    if (!recordingSession) {
      return NextResponse.json({ error: "Recording Sessionが見つかりません。" }, { status: 404 });
    }
    if (recordingSession.status !== "recording") {
      return NextResponse.json(
        { error: "Recording Sessionはすでに終了しています。" },
        { status: 409 },
      );
    }

    const updated = await endRecordingSession(db, user.id, id);
    if (!updated) {
      return NextResponse.json(
        { error: "Recording Sessionの終了に失敗しました。" },
        { status: 409 },
      );
    }
    return NextResponse.json({ recordingSession: updated });
  } catch (cause) {
    console.error("Failed to end recording session", cause);
    return NextResponse.json(
      { error: "Recording Sessionの終了に失敗しました。" },
      { status: 500 },
    );
  }
}
