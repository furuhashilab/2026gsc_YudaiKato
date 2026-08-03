import type { TimelineScrobble } from "./types.ts";

export type LastFmTimelineTrackInput = {
  trackName: string;
  artistName: string;
  nowPlaying: boolean;
  playedAt: string | null;
  playedAtUnix: number | null;
};

/**
 * 外部キーの比較用に、Unicode互換正規化、空白統一、小文字化を行い、
 * 区切り文字と衝突しないURLエンコード済み文字列を返す。
 */
export function normalizeExternalKeyPart(value: string) {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return encodeURIComponent(normalized);
}

export function createLastFmExternalEventKey(input: {
  username: string;
  playedAtUnixMs: number;
  artistName: string;
  trackName: string;
}) {
  const playedAtUnixSeconds = Math.trunc(input.playedAtUnixMs / 1_000);
  return [
    "lastfm",
    normalizeExternalKeyPart(input.username),
    String(playedAtUnixSeconds),
    normalizeExternalKeyPart(input.artistName),
    normalizeExternalKeyPart(input.trackName),
  ].join(":");
}

function toValidUnixMs(track: LastFmTimelineTrackInput) {
  const unixTimestampMs = track.playedAtUnix === null ? Number.NaN : track.playedAtUnix * 1_000;
  const isoTimestampMs = track.playedAt === null ? Number.NaN : Date.parse(track.playedAt);
  const timestamp = Number.isFinite(unixTimestampMs) ? unixTimestampMs : isoTimestampMs;
  return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : null;
}

/** Last.fmレスポンスを返却順に依存しないTimelineScrobbleへ変換する純粋関数。 */
export function convertLastFmTracksToTimelineScrobbles(
  items: LastFmTimelineTrackInput[],
  username: string,
) {
  return items.flatMap<TimelineScrobble>((track) => {
    if (track.nowPlaying) return [];
    const playedAtUnixMs = toValidUnixMs(track);
    if (playedAtUnixMs === null) return [];

    const externalEventKey = createLastFmExternalEventKey({
      username,
      playedAtUnixMs,
      artistName: track.artistName,
      trackName: track.trackName,
    });

    return [{
      id: externalEventKey,
      externalEventKey,
      trackName: track.trackName,
      artistName: track.artistName,
      playedAt: new Date(playedAtUnixMs).toISOString(),
      playedAtUnixMs,
      durationMs: null,
      source: "lastfm",
    }];
  });
}
