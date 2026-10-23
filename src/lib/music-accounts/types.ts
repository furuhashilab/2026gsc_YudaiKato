export type MusicAccountProvider = "lastfm";

export type MusicAccount = {
  id: string;
  userId: string;
  provider: MusicAccountProvider;
  lastfmUsername: string;
  createdAt: string;
};
