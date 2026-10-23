import { NextResponse } from "next/server";

import { getMusicAccount } from "@/lib/music-accounts";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

export type LastFmRecentTrack = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  nowPlaying: boolean;
  playedAt: string | null;
  playedAtUnix: number | null;
  lastFmUrl: string | null;
  mbid: string | null;
};

type LastFmTrack = {
  name: string;
  mbid?: string;
  url?: string;
  artist: { "#text": string };
  album?: { "#text": string };
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
};

type LastFmSuccess = { recenttracks: { track: LastFmTrack[] } };
type LastFmError = { error: number; message: string };

const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";

function isLastFmError(value: LastFmSuccess | LastFmError): value is LastFmError {
  return "error" in value;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const apiKey = process.env.LASTFM_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "環境変数 LASTFM_API_KEY が設定されていません。" },
      { status: 500 },
    );
  }

  const db = createSupabaseServiceRoleClient();
  let username: string;
  try {
    const musicAccount = await getMusicAccount(db, user.id);
    if (!musicAccount) {
      return NextResponse.json(
        { error: "Last.fmユーザー名が登録されていません。/settings/music から登録してください。" },
        { status: 409 },
      );
    }
    username = musicAccount.lastfmUsername;
  } catch (cause) {
    console.error("Failed to get music account", cause);
    return NextResponse.json(
      { error: "Last.fmアカウント情報の取得に失敗しました。" },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    method: "user.getRecentTracks",
    api_key: apiKey,
    user: username,
    limit: "50",
    format: "json",
    extended: "0",
  });

  try {
    const response = await fetch(`${LASTFM_ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as LastFmSuccess | LastFmError;

    if (!response.ok || isLastFmError(body)) {
      const lastFmError = isLastFmError(body)
        ? { code: body.error, message: body.message }
        : { code: null, message: `Last.fm API が HTTP ${response.status} を返しました。` };
      return NextResponse.json(
        { error: "Last.fm APIから視聴履歴を取得できませんでした。", lastFmError },
        { status: 502 },
      );
    }

    const items: LastFmRecentTrack[] = body.recenttracks.track.map((track) => {
      const playedAtUnix = track.date?.uts ? Number(track.date.uts) : null;
      const hasValidTimestamp = playedAtUnix !== null && Number.isFinite(playedAtUnix);

      return {
        trackName: track.name,
        artistName: track.artist["#text"],
        albumName: track.album?.["#text"] || null,
        nowPlaying: track["@attr"]?.nowplaying === "true",
        playedAt: hasValidTimestamp ? new Date(playedAtUnix * 1000).toISOString() : null,
        playedAtUnix: hasValidTimestamp ? playedAtUnix : null,
        lastFmUrl: track.url || null,
        mbid: track.mbid || null,
      };
    });

    return NextResponse.json({ fetchedAt: new Date().toISOString(), username, items });
  } catch (cause) {
    console.error("Last.fm recent tracks request failed", cause);
    return NextResponse.json(
      { error: "Last.fm APIとの通信またはレスポンスの解析に失敗しました。" },
      { status: 502 },
    );
  }
}
