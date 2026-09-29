import type { SupabaseClient } from "@supabase/supabase-js";

import type { CreateLocationSampleInput, LocationSample } from "./types.ts";

type LocationSampleRow = {
  id: string;
  session_id: string;
  recorded_at: string;
  geolocation_recorded_at: string | null;
  position_age_at_receipt_ms: number | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  altitude_m: number | null;
  visibility_state: LocationSample["visibilityState"];
  interval_from_prev_ms: number | null;
  created_at: string;
};

function mapRow(row: LocationSampleRow): LocationSample {
  return {
    id: row.id,
    sessionId: row.session_id,
    recordedAt: row.recorded_at,
    geolocationRecordedAt: row.geolocation_recorded_at,
    positionAgeAtReceiptMs: row.position_age_at_receipt_ms,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyM: row.accuracy_m,
    speedMps: row.speed_mps,
    headingDeg: row.heading_deg,
    altitudeM: row.altitude_m,
    visibilityState: row.visibility_state,
    intervalFromPrevMs: row.interval_from_prev_ms,
    createdAt: row.created_at,
  };
}

export async function createLocationSamples(
  client: SupabaseClient,
  sessionId: string,
  inputs: CreateLocationSampleInput[],
): Promise<LocationSample[]> {
  const { data, error } = await client
    .from("location_samples")
    .insert(
      inputs.map((input) => ({
        session_id: sessionId,
        recorded_at: input.recordedAt,
        geolocation_recorded_at: input.geolocationRecordedAt ?? null,
        position_age_at_receipt_ms: input.positionAgeAtReceiptMs ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy_m: input.accuracyM ?? null,
        speed_mps: input.speedMps ?? null,
        heading_deg: input.headingDeg ?? null,
        altitude_m: input.altitudeM ?? null,
        visibility_state: input.visibilityState ?? null,
        interval_from_prev_ms: input.intervalFromPrevMs ?? null,
      })),
    )
    .select();
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
