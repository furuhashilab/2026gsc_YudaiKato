import type { SupabaseClient } from "@supabase/supabase-js";

import type { CreateRecordingSessionInput, RecordingSession } from "./types.ts";

type RecordingSessionRow = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: RecordingSession["status"];
  device_info: Record<string, unknown> | null;
  created_at: string;
};

function mapRow(row: RecordingSessionRow): RecordingSession {
  return {
    id: row.id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    deviceInfo: row.device_info,
    createdAt: row.created_at,
  };
}

export async function createRecordingSession(
  client: SupabaseClient,
  input: CreateRecordingSessionInput,
): Promise<RecordingSession> {
  const { data, error } = await client
    .from("recording_sessions")
    .insert({ user_id: input.userId, device_info: input.deviceInfo ?? null })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function getRecordingSession(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<RecordingSession | null> {
  const { data, error } = await client
    .from("recording_sessions")
    .select()
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function endRecordingSession(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<RecordingSession | null> {
  const { data, error } = await client
    .from("recording_sessions")
    .update({ ended_at: new Date().toISOString(), status: "completed" })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "recording")
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function listRecordingSessions(
  client: SupabaseClient,
  userId: string,
): Promise<RecordingSession[]> {
  const { data, error } = await client
    .from("recording_sessions")
    .select()
    .eq("user_id", userId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
