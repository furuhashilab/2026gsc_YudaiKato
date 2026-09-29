export type LastFmScrobble = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  playedAt: string;
  playedAtUnix: number;
  lastFmUrl: string | null;
  mbid: string | null;
  raw: unknown;
};

export type FetchConfirmedScrobblesInput = {
  apiKey: string;
  username: string;
  fromUnix: number;
  toUnix: number;
};
