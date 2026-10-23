import type { SupabaseClient } from "@supabase/supabase-js";

import { CURRENT_RESEARCH_CONSENT_VERSION } from "./types.ts";
import type { ResearchConsent } from "./types.ts";

type ResearchConsentRow = {
  id: string;
  user_id: string;
  consented: boolean;
  consented_at: string | null;
  version: string;
  created_at: string;
};

function mapRow(row: ResearchConsentRow): ResearchConsent {
  return {
    id: row.id,
    userId: row.user_id,
    consented: row.consented,
    consentedAt: row.consented_at,
    version: row.version,
    createdAt: row.created_at,
  };
}

export async function getResearchConsent(
  client: SupabaseClient,
  userId: string,
): Promise<ResearchConsent | null> {
  const { data, error } = await client
    .from("research_consents")
    .select()
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** 現行版（CURRENT_RESEARCH_CONSENT_VERSION）への同意として現在状態を記録する。過去の同意履歴は保持しない。 */
export async function recordResearchConsent(
  client: SupabaseClient,
  userId: string,
): Promise<ResearchConsent> {
  const { data, error } = await client
    .from("research_consents")
    .upsert(
      {
        user_id: userId,
        consented: true,
        consented_at: new Date().toISOString(),
        version: CURRENT_RESEARCH_CONSENT_VERSION,
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}
