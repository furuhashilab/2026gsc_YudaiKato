import type { SupabaseClient } from "@supabase/supabase-js";

import type { MusicAccount } from "./types.ts";

type MusicAccountRow = {
  id: string;
  user_id: string;
  provider: MusicAccount["provider"];
  lastfm_username: string;
  created_at: string;
};

function mapRow(row: MusicAccountRow): MusicAccount {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    lastfmUsername: row.lastfm_username,
    createdAt: row.created_at,
  };
}

export async function getMusicAccount(
  client: SupabaseClient,
  userId: string,
): Promise<MusicAccount | null> {
  const { data, error } = await client
    .from("music_accounts")
    .select()
    .eq("user_id", userId)
    .eq("provider", "lastfm")
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** 未登録なら新規作成し、登録済みならlastfm_usernameを上書きする。 */
export async function upsertLastFmUsername(
  client: SupabaseClient,
  userId: string,
  lastfmUsername: string,
): Promise<MusicAccount> {
  const { data, error } = await client
    .from("music_accounts")
    .upsert(
      { user_id: userId, provider: "lastfm", lastfm_username: lastfmUsername },
      { onConflict: "user_id,provider" },
    )
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}
