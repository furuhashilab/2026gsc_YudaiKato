import { getMusicAccount } from "@/lib/music-accounts";
import { requireConsentedUser } from "@/lib/route-guards";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server-client.ts";

import { MusicAccountForm } from "./music-account-form.tsx";

export default async function MusicSettingsPage() {
  const user = await requireConsentedUser();

  const db = createSupabaseServiceRoleClient();
  const musicAccount = await getMusicAccount(db, user.id);

  return (
    <main className="music-settings-page">
      <h1>Last.fmアカウント連携</h1>
      <p className="notice">
        記録したGPSログとLast.fmの再生履歴を結合するため、ご自身のLast.fmユーザー名を登録してください。
      </p>
      <p>
        ユーザー名は、Last.fmにログインした状態でプロフィールページを開いたときのURL
        （<code>https://www.last.fm/user/あなたのユーザー名</code>）で確認できます。
      </p>

      <MusicAccountForm initialUsername={musicAccount?.lastfmUsername ?? ""} />
    </main>
  );
}
