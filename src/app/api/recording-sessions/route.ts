import { NextResponse } from "next/server";

import {
  createRecordingSession,
  listRecordingSessions,
} from "@/lib/recording-sessions";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const items = await listRecordingSessions(db, user.id);
    return NextResponse.json({ items });
  } catch (cause) {
    console.error("Failed to list recording sessions", cause);
    return NextResponse.json(
      { error: "Recording Sessionの取得に失敗しました。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const deviceInfo =
    body && typeof body === "object" && "deviceInfo" in body
      ? (body as { deviceInfo?: Record<string, unknown> | null }).deviceInfo ?? null
      : null;

  const db = createSupabaseServiceRoleClient();
  try {
    const recordingSession = await createRecordingSession(db, {
      userId: user.id,
      deviceInfo,
    });
    return NextResponse.json({ recordingSession }, { status: 201 });
  } catch (cause) {
    console.error("Failed to create recording session", cause);
    return NextResponse.json(
      { error: "Recording Sessionの作成に失敗しました。" },
      { status: 500 },
    );
  }
}
