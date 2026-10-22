import type { CreateJoinResultInput } from "../join-results/types.ts";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_JOIN_ALGORITHM_CONFIG,
  DEFAULT_JOIN_ALGORITHM_VERSION,
} from "./types.ts";
import type { CreateJoinRunInput, JoinAlgorithmConfig, JoinRun } from "./types.ts";

type JoinRunRow = {
  id: string;
  journey_id: string;
  algorithm_version: string;
  algorithm_config: JoinAlgorithmConfig;
  created_at: string;
};

function mapRow(row: JoinRunRow): JoinRun {
  return {
    id: row.id,
    journeyId: row.journey_id,
    algorithmVersion: row.algorithm_version,
    algorithmConfig: row.algorithm_config,
    createdAt: row.created_at,
  };
}

export async function createJoinRun(
  client: SupabaseClient,
  input: CreateJoinRunInput,
): Promise<JoinRun> {
  const { data, error } = await client
    .from("join_runs")
    .insert({
      journey_id: input.journeyId,
      algorithm_version: input.algorithmVersion ?? DEFAULT_JOIN_ALGORITHM_VERSION,
      algorithm_config: input.algorithmConfig ?? DEFAULT_JOIN_ALGORITHM_CONFIG,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Save the run and its results in one PostgreSQL transaction. */
export async function createJoinRunWithResults(
  client: SupabaseClient,
  input: CreateJoinRunInput,
  results: Omit<CreateJoinResultInput, "joinRunId" | "sessionId">[],
): Promise<JoinRun> {
  const { data, error } = await client.rpc("create_join_run_with_results", {
    p_journey_id: input.journeyId,
    p_algorithm_version: input.algorithmVersion ?? DEFAULT_JOIN_ALGORITHM_VERSION,
    p_algorithm_config: input.algorithmConfig ?? DEFAULT_JOIN_ALGORITHM_CONFIG,
    p_results: results.map((result) => ({
      listening_event_id: result.listeningEventId,
      representative_location_id: result.representativeLocationId ?? null,
      estimated_ended_at: result.estimatedEndedAt,
      end_method: result.endMethod,
      match_status: result.matchStatus,
      location_sample_count: result.locationSampleCount,
      warnings: result.warnings,
    })),
  }).single();
  if (error) throw error;
  return mapRow(data as JoinRunRow);
}
