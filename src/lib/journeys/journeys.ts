import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_JOURNEY_ALGORITHM_VERSION } from "./types.ts";
import type { CreateJourneyInput, Journey } from "./types.ts";

type JourneyRow = {
  id: string;
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  status: Journey["status"];
  algorithm_version: string;
  visibility: Journey["visibility"];
  title: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: JourneyRow): Journey {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    algorithmVersion: row.algorithm_version,
    visibility: row.visibility,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createJourney(
  client: SupabaseClient,
  input: CreateJourneyInput,
): Promise<Journey> {
  const { data, error } = await client
    .from("journeys")
    .insert({
      session_id: input.sessionId,
      user_id: input.userId,
      started_at: input.startedAt,
      algorithm_version: input.algorithmVersion ?? DEFAULT_JOURNEY_ALGORITHM_VERSION,
      title: input.title ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function getJourney(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<Journey | null> {
  const { data, error } = await client
    .from("journeys")
    .select()
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function listJourneys(
  client: SupabaseClient,
  userId: string,
): Promise<Journey[]> {
  const { data, error } = await client
    .from("journeys")
    .select()
    .eq("user_id", userId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
