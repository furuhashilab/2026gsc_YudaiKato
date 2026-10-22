import type {
  TimelineEndMethod,
  TimelineJoinStatus,
  TimelineJoinWarning,
} from "@/lib/timeline-join";

export type JoinResult = {
  id: string;
  sessionId: string;
  joinRunId: string;
  listeningEventId: string;
  representativeLocationId: string | null;
  estimatedEndedAt: string;
  endMethod: TimelineEndMethod;
  matchStatus: TimelineJoinStatus;
  locationSampleCount: number;
  warnings: TimelineJoinWarning[];
  createdAt: string;
};

export type CreateJoinResultInput = {
  sessionId: string;
  joinRunId: string;
  listeningEventId: string;
  representativeLocationId?: string | null;
  estimatedEndedAt: string;
  endMethod: TimelineEndMethod;
  matchStatus: TimelineJoinStatus;
  locationSampleCount: number;
  warnings: TimelineJoinWarning[];
};
