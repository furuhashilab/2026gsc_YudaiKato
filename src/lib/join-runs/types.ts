import { DEFAULT_TIMELINE_JOIN_CONFIG } from "../timeline-join/join-timeline.ts";
import type { TimelineJoinConfig } from "../timeline-join/types.ts";

export type JoinAlgorithmConfig = TimelineJoinConfig;

export const DEFAULT_JOIN_ALGORITHM_VERSION = "v0.1";

/** 結合処理に実際に渡す設定値を、そのまま保存する。 */
export const DEFAULT_JOIN_ALGORITHM_CONFIG: JoinAlgorithmConfig =
  DEFAULT_TIMELINE_JOIN_CONFIG;

export type JoinRun = {
  id: string;
  journeyId: string;
  algorithmVersion: string;
  algorithmConfig: JoinAlgorithmConfig;
  createdAt: string;
};

export type CreateJoinRunInput = {
  journeyId: string;
  algorithmVersion?: string;
  algorithmConfig?: JoinAlgorithmConfig;
};
