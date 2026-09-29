import type { SupabaseClient } from "@supabase/supabase-js";

import type { FindOrCreateTrackInput, Track, TrackExternalIdProvider } from "./types.ts";

type TrackRow = {
  id: string;
  title: string;
  artist_name: string;
  album_name: string | null;
  duration_ms: number | null;
  created_at: string;
};

function mapRow(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    albumName: row.album_name,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

/**
 * title+artist_nameはUNIQUE制約がなく重複行を許容する設計のため、
 * .maybeSingle()は使わず先頭の1件のみを取得する。
 */
export async function findTrackByTitleArtist(
  client: SupabaseClient,
  title: string,
  artistName: string,
): Promise<Track | null> {
  const { data, error } = await client
    .from("tracks")
    .select()
    .eq("title", title)
    .eq("artist_name", artistName)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? mapRow(data[0]) : null;
}

export async function createTrack(
  client: SupabaseClient,
  input: FindOrCreateTrackInput,
): Promise<Track> {
  const { data, error } = await client
    .from("tracks")
    .insert({
      title: input.title,
      artist_name: input.artistName,
      album_name: input.albumName ?? null,
      duration_ms: input.durationMs ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function findOrCreateTrack(
  client: SupabaseClient,
  input: FindOrCreateTrackInput,
): Promise<Track> {
  const existing = await findTrackByTitleArtist(client, input.title, input.artistName);
  if (existing) return existing;
  return createTrack(client, input);
}

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

/**
 * 外部ID(mbid等)のベストエフォート保存。既に同じ外部IDが存在する場合(一意制約違反)や
 * 形式不正(CHECK制約違反)は無視してskippedを返す。専用RPCは使わない軽量方式。
 */
export async function addTrackExternalId(
  client: SupabaseClient,
  trackId: string,
  provider: TrackExternalIdProvider,
  externalId: string,
): Promise<"inserted" | "skipped"> {
  const { error } = await client
    .from("track_external_ids")
    .insert({ track_id: trackId, provider, external_id: externalId });
  if (!error) return "inserted";
  if (error.code === UNIQUE_VIOLATION || error.code === CHECK_VIOLATION) return "skipped";
  throw error;
}
