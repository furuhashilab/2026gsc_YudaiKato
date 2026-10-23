export const CURRENT_RESEARCH_CONSENT_VERSION = "v1";

export type ResearchConsent = {
  id: string;
  userId: string;
  consented: boolean;
  consentedAt: string | null;
  version: string;
  createdAt: string;
};
