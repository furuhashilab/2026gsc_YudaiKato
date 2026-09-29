import { NextResponse } from "next/server";

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server-client.ts";

// サインアップ確認メール／マジックリンクのURLから遷移してくるコールバック。
// codeをセッションに交換し、Cookieへ書き込んでからリダイレクトする。
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/";

  try {
    const url = new URL(next, origin);
    // @始まりの値を拒否し、検証済みURLのパスだけを遷移先に使う。
    next = url.origin === origin && !next.trimStart().startsWith("@")
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    next = "/";
  }

  if (code) {
    const supabase = await createSupabaseRouteHandlerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=auth_callback_failed`);
}
