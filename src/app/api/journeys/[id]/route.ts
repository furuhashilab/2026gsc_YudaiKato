import { NextResponse } from "next/server";

import { getJourney } from "@/lib/journeys";
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
    const journey = await getJourney(db, user.id, id);
    if (!journey) {
      return NextResponse.json({ error: "Journeyが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ journey });
  } catch (cause) {
    console.error("Failed to get journey", cause);
    return NextResponse.json({ error: "Journeyの取得に失敗しました。" }, { status: 500 });
  }
}
