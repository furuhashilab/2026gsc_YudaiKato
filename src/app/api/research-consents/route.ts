import { NextResponse } from "next/server";

import { getResearchConsent, recordResearchConsent } from "@/lib/research-consents";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const researchConsent = await getResearchConsent(db, user.id);
    return NextResponse.json({ researchConsent });
  } catch (cause) {
    console.error("Failed to get research consent", cause);
    return NextResponse.json(
      { error: "研究同意状態の取得に失敗しました。" },
      { status: 500 },
    );
  }
}

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const researchConsent = await recordResearchConsent(db, user.id);
    return NextResponse.json({ researchConsent }, { status: 201 });
  } catch (cause) {
    console.error("Failed to record research consent", cause);
    return NextResponse.json(
      { error: "研究同意の保存に失敗しました。" },
      { status: 500 },
    );
  }
}
