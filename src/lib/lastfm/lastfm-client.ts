import type { FetchConfirmedScrobblesInput, LastFmScrobble } from "./types.ts";

type LastFmTrack = {
  name: string;
  mbid?: string;
  url?: string;
  artist: { "#text": string };
  album?: { "#text": string };
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
};

type LastFmSuccess = {
  recenttracks: {
    track: LastFmTrack[];
    "@attr": { page: string; totalPages: string };
  };
};
type LastFmError = { error: number; message: string };

const LASTFM_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";
const PAGE_LIMIT = "200";

function isLastFmError(value: LastFmSuccess | LastFmError): value is LastFmError {
  return "error" in value;
}

function toValidPlayedAtUnix(track: LastFmTrack): number | null {
  if (track["@attr"]?.nowplaying === "true") return null;
  const uts = track.date?.uts ? Number(track.date.uts) : null;
  return uts !== null && Number.isFinite(uts) ? uts : null;
}

async function fetchPage(
  input: FetchConfirmedScrobblesInput,
  page: number,
): Promise<LastFmSuccess["recenttracks"]> {
  const params = new URLSearchParams({
    method: "user.getRecentTracks",
    api_key: input.apiKey,
    user: input.username,
    from: String(input.fromUnix),
    to: String(input.toUnix),
    page: String(page),
    limit: PAGE_LIMIT,
    format: "json",
    extended: "0",
  });

  const response = await fetch(`${LASTFM_ENDPOINT}?${params.toString()}`, {
    cache: "no-store",
  });
  const body = (await response.json()) as LastFmSuccess | LastFmError;

  if (!response.ok || isLastFmError(body)) {
    const lastFmError = isLastFmError(body)
      ? { code: body.error, message: body.message }
      : { code: null, message: `Last.fm API が HTTP ${response.status} を返しました。` };
    throw new Error(
      `Last.fm APIからScrobbleを取得できませんでした: ${JSON.stringify(lastFmError)}`,
    );
  }

  return body.recenttracks;
}

/** 指定範囲の確定Scrobbleを全ページ取得する。nowplaying中のトラックとタイムスタンプ不明なトラックは除外する。 */
export async function fetchConfirmedScrobbles(
  input: FetchConfirmedScrobblesInput,
): Promise<LastFmScrobble[]> {
  const scrobbles: LastFmScrobble[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const recenttracks = await fetchPage(input, page);
    totalPages = Number(recenttracks["@attr"]?.totalPages) || 1;

    for (const track of recenttracks.track) {
      const playedAtUnix = toValidPlayedAtUnix(track);
      if (playedAtUnix === null) continue;

      scrobbles.push({
        trackName: track.name,
        artistName: track.artist["#text"],
        albumName: track.album?.["#text"] || null,
        playedAt: new Date(playedAtUnix * 1000).toISOString(),
        playedAtUnix,
        lastFmUrl: track.url || null,
        mbid: track.mbid || null,
        raw: track,
      });
    }

    page += 1;
  } while (page <= totalPages);

  return scrobbles;
}
