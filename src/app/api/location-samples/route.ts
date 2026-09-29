import { NextResponse } from "next/server";

import { createLocationSamples } from "@/lib/location-samples";
import type { CreateLocationSampleInput } from "@/lib/location-samples";
import { getRecordingSession } from "@/lib/recording-sessions";
import { createSupabaseServiceRoleClient, getAuthenticatedUser } from "@/lib/supabase/server-client.ts";

type RawSample = {
  sampleId?: unknown;
  recordedAt?: unknown;
  geolocationRecordedAt?: unknown;
  positionAgeAtReceiptMs?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracyM?: unknown;
  speedMps?: unknown;
  headingDeg?: unknown;
  altitudeM?: unknown;
  visibilityState?: unknown;
  intervalFromPrevMs?: unknown;
};

function parseSample(raw: RawSample): CreateLocationSampleInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.sampleId !== undefined && (
    typeof raw.sampleId !== "string" || !raw.sampleId.trim()
  )) return null;
  if (typeof raw.recordedAt !== "string") return null;
  if (typeof raw.latitude !== "number") return null;
  if (typeof raw.longitude !== "number") return null;

  return {
    sampleId: raw.sampleId,
    recordedAt: raw.recordedAt,
    geolocationRecordedAt:
      typeof raw.geolocationRecordedAt === "string" ? raw.geolocationRecordedAt : null,
    positionAgeAtReceiptMs:
      typeof raw.positionAgeAtReceiptMs === "number" ? raw.positionAgeAtReceiptMs : null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    accuracyM: typeof raw.accuracyM === "number" ? raw.accuracyM : null,
    speedMps: typeof raw.speedMps === "number" ? raw.speedMps : null,
    headingDeg: typeof raw.headingDeg === "number" ? raw.headingDeg : null,
    altitudeM: typeof raw.altitudeM === "number" ? raw.altitudeM : null,
    visibilityState:
      raw.visibilityState === "visible" || raw.visibilityState === "hidden"
        ? raw.visibilityState
        : null,
    intervalFromPrevMs:
      typeof raw.intervalFromPrevMs === "number" ? raw.intervalFromPrevMs : null,
  };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sessionId =
    body && typeof body === "object" && typeof (body as { sessionId?: unknown }).sessionId === "string"
      ? (body as { sessionId: string }).sessionId
      : null;
  const rawSamples =
    body && typeof body === "object" && Array.isArray((body as { samples?: unknown }).samples)
      ? ((body as { samples: unknown[] }).samples as RawSample[])
      : null;

  if (!sessionId || !rawSamples || rawSamples.length === 0) {
    return NextResponse.json(
      { error: "sessionIdと空でないsamplesの配列が必要です。" },
      { status: 400 },
    );
  }

  const samples: CreateLocationSampleInput[] = [];
  for (const raw of rawSamples) {
    const sample = parseSample(raw);
    if (!sample) {
      return NextResponse.json(
        { error: "samplesの各要素にはrecordedAt, latitude, longitudeが必要です。sampleIdは省略するか空でない文字列を指定してください。" },
        { status: 400 },
      );
    }
    samples.push(sample);
  }

  const db = createSupabaseServiceRoleClient();
  try {
    const recordingSession = await getRecordingSession(db, user.id, sessionId);
    if (!recordingSession) {
      return NextResponse.json({ error: "Recording Sessionが見つかりません。" }, { status: 404 });
    }
    if (recordingSession.status !== "recording") {
      return NextResponse.json(
        { error: "終了したRecording SessionにはGPSログを保存できません。" },
        { status: 409 },
      );
    }

    const locationSamples = await createLocationSamples(db, sessionId, samples);
    return NextResponse.json({ locationSamples }, { status: 201 });
  } catch (cause) {
    console.error("Failed to create location samples", cause);
    return NextResponse.json(
      { error: "GPSログの保存に失敗しました。" },
      { status: 500 },
    );
  }
}
