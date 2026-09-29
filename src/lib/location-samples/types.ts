export type LocationSampleVisibilityState = "visible" | "hidden";

export type LocationSample = {
  id: string;
  sampleId: string | null;
  sessionId: string;
  recordedAt: string;
  geolocationRecordedAt: string | null;
  positionAgeAtReceiptMs: number | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  visibilityState: LocationSampleVisibilityState | null;
  intervalFromPrevMs: number | null;
  createdAt: string;
};

export type CreateLocationSampleInput = {
  sampleId?: string;
  recordedAt: string;
  geolocationRecordedAt?: string | null;
  positionAgeAtReceiptMs?: number | null;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  altitudeM?: number | null;
  visibilityState?: LocationSampleVisibilityState | null;
  intervalFromPrevMs?: number | null;
};
