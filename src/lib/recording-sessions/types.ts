export type RecordingSessionStatus = "recording" | "completed" | "cancelled";

export type RecordingSession = {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  status: RecordingSessionStatus;
  deviceInfo: Record<string, unknown> | null;
  createdAt: string;
};

export type CreateRecordingSessionInput = {
  userId: string;
  deviceInfo?: Record<string, unknown> | null;
};
