import type { SupabaseClient } from "@supabase/supabase-js";

import type { CreateListeningEventInput, ListeningEvent } from "./types.ts";

type ListeningEventRow = {
  id: string;
  session_id: string;
  track_id: string;
  external_event_key: string;
  started_at: string;
  source: ListeningEvent["source"];
  status: ListeningEvent["status"];
  raw_payload: Record<string, unknown> | null;
  created_at: string;
};

function mapRow(row: ListeningEventRow): ListeningEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    trackId: row.track_id,
    externalEventKey: row.external_event_key,
    startedAt: row.started_at,
    source: row.source,
    status: row.status,
    rawPayload: row.raw_payload,
    createdAt: row.created_at,
  };
}

/**
 * external_event_keyの単純UNIQUE制約にON CONFLICT DO NOTHINGで重複を防ぐ。
 * listening_eventsはUPDATE禁止(append-only)のため、ここでも常にupsert+ignoreDuplicatesのみを使う。
 * 新規挿入された行のみが返る。
 */
export async function createListeningEvents(
  client: SupabaseClient,
  inputs: CreateListeningEventInput[],
): Promise<ListeningEvent[]> {
  if (inputs.length === 0) return [];

  const { data, error } = await client
    .from("listening_events")
    .upsert(
      inputs.map((input) => ({
        session_id: input.sessionId,
        track_id: input.trackId,
        external_event_key: input.externalEventKey,
        started_at: input.startedAt,
        raw_payload: input.rawPayload ?? null,
      })),
      { onConflict: "external_event_key", ignoreDuplicates: true },
    )
    .select();
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
