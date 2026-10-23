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

/** Journey関連画面向け。ログイン・研究同意・Last.fm連携の3条件を順に確認する。 */
export async function requireJourneyReadyUser(): Promise<User> {
  const user = await requireConsentedUser();

  const db = createSupabaseServiceRoleClient();
  const musicAccount = await getMusicAccount(db, user.id);
  if (!musicAccount) redirect("/settings/music");

  return user;
}
