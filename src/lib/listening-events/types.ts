export type ListeningEvent = {
  id: string;
  sessionId: string;
  trackId: string;
  externalEventKey: string;
  startedAt: string;
  source: "lastfm_scrobble";
  status: "confirmed";
  rawPayload: Record<string, unknown> | null;
  createdAt: string;
};

export type CreateListeningEventInput = {
  sessionId: string;
  trackId: string;
  externalEventKey: string;
  startedAt: string;
  rawPayload?: Record<string, unknown> | null;
};
