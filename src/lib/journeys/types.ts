export type JourneyStatus = "draft" | "completed";
export type JourneyVisibility = "private" | "unlisted" | "public";

export const DEFAULT_JOURNEY_ALGORITHM_VERSION = "v0.1";

export type Journey = {
  id: string;
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  status: JourneyStatus;
  algorithmVersion: string;
  visibility: JourneyVisibility;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJourneyInput = {
  userId: string;
  sessionId: string;
  startedAt: string;
  algorithmVersion?: string;
  title?: string | null;
};
