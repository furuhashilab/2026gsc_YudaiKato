import { NextResponse } from "next/server";

import { getMusicAccount, upsertLastFmUsername } from "@/lib/music-accounts";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const musicAccount = await getMusicAccount(db, user.id);
    return NextResponse.json({ musicAccount });
  } catch (cause) {
    console.error("Failed to get music account", cause);
    return NextResponse.json(
      { error: "Last.fmアカウント情報の取得に失敗しました。" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { lastfmUsername?: unknown } | null;
  const lastfmUsername = typeof body?.lastfmUsername === "string" ? body.lastfmUsername.trim() : "";
  if (!lastfmUsername) {
    return NextResponse.json({ error: "lastfmUsernameは必須です。" }, { status: 400 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const musicAccount = await upsertLastFmUsername(db, user.id, lastfmUsername);
    return NextResponse.json({ musicAccount });
  } catch (cause) {
    console.error("Failed to save music account", cause);
    return NextResponse.json(
      { error: "Last.fmアカウントの保存に失敗しました。" },
      { status: 500 },
    );
  }
}
