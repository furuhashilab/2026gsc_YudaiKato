import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  TimelineEndMethod,
  TimelineJoinStatus,
  TimelineJoinWarning,
} from "@/lib/timeline-join";

import type { CreateJoinResultInput, JoinResult } from "./types.ts";

type JoinResultRow = {
  id: string;
  session_id: string;
  join_run_id: string;
  listening_event_id: string;
  representative_location_id: string | null;
  estimated_ended_at: string;
  end_method: TimelineEndMethod;
  match_status: TimelineJoinStatus;
  location_sample_count: number;
  warnings: TimelineJoinWarning[] | null;
  created_at: string;
};

function mapRow(row: JoinResultRow): JoinResult {
  return {
    id: row.id,
    sessionId: row.session_id,
    joinRunId: row.join_run_id,
    listeningEventId: row.listening_event_id,
    representativeLocationId: row.representative_location_id,
    estimatedEndedAt: row.estimated_ended_at,
    endMethod: row.end_method,
    matchStatus: row.match_status,
    locationSampleCount: row.location_sample_count,
    warnings: row.warnings ?? [],
    createdAt: row.created_at,
  };
}

export async function listJoinResultsByJoinRunId(
  client: SupabaseClient,
  joinRunId: string,
): Promise<JoinResult[]> {
  const { data, error } = await client
    .from("join_results")
    .select()
    .eq("join_run_id", joinRunId);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/**
 * 1回のjoin runに属する全行をまとめて挿入する。join_run_idは常に新規runのIDのため、
 * (join_run_id, listening_event_id)の衝突は発生せず、常に通常のinsertでよい。
 */
export async function createJoinResults(
  client: SupabaseClient,
  inputs: CreateJoinResultInput[],
): Promise<JoinResult[]> {
  if (inputs.length === 0) return [];

  const { data, error } = await client
    .from("join_results")
    .insert(
      inputs.map((input) => ({
        session_id: input.sessionId,
        join_run_id: input.joinRunId,
        listening_event_id: input.listeningEventId,
        representative_location_id: input.representativeLocationId ?? null,
        estimated_ended_at: input.estimatedEndedAt,
        end_method: input.endMethod,
        match_status: input.matchStatus,
        location_sample_count: input.locationSampleCount,
        warnings: input.warnings,
      })),
    )
    .select();
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
