import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { getMusicAccount } from "@/lib/music-accounts";
import { getResearchConsent } from "@/lib/research-consents";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

/** Server Componentの先頭で呼び、未ログインなら/authへリダイレクトする。 */
export async function requireAuthenticatedUser(): Promise<User> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/auth");
  return user;
}

/** ログイン済みかつ研究同意済みであることを要求する。未同意なら/consentへリダイレクトする。 */
export async function requireConsentedUser(): Promise<User> {
  const user = await requireAuthenticatedUser();

  const db = createSupabaseServiceRoleClient();
  const consent = await getResearchConsent(db, user.id);
  if (!consent?.consented) redirect("/consent");

  return user;
}

/**
 * Journey関連画面向け。ログイン・研究同意・Last.fm連携の3条件を順に確認する。
 * 認証確認（ネットワーク往復を伴う）は1回のみ行い、互いに依存しない同意確認・
 * Last.fm連携確認はPromise.allで並列に問い合わせる。ただしリダイレクトの優先順位
 * （未ログイン→/auth、同意未完了→/consent、Last.fm未登録→/settings/music）は、
 * 判定の順序をそのままにすることで並列化前と変えない。
 */
export async function requireJourneyReadyUser(): Promise<User> {
  const user = await requireAuthenticatedUser();

  const db = createSupabaseServiceRoleClient();
  const [consent, musicAccount] = await Promise.all([
    getResearchConsent(db, user.id),
    getMusicAccount(db, user.id),
  ]);
  if (!consent?.consented) redirect("/consent");
  if (!musicAccount) redirect("/settings/music");

  return user;
}
