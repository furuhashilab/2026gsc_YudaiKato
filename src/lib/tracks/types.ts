export type Track = {
  id: string;
  title: string;
  artistName: string;
  albumName: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type FindOrCreateTrackInput = {
  title: string;
  artistName: string;
  albumName?: string | null;
  durationMs?: number | null;
};

export type TrackExternalIdProvider =
  | "musicbrainz_recording"
  | "musicbrainz_artist"
  | "lastfm_track_url";
