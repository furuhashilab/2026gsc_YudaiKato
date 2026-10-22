export type JoinAlgorithmConfig = {
  maxGapMs: number;
  representativeMethod: string;
  intervalRule: string;
};

export const DEFAULT_JOIN_ALGORITHM_VERSION = "v0.1";

/**
 * joinScrobblesWithLocations()への実引数(DEFAULT_TIMELINE_JOIN_CONFIG)とは別物。
 * アルゴリズムの挙動を研究記録として要約した、保存専用のメタデータ。
 */
export const DEFAULT_JOIN_ALGORITHM_CONFIG: JoinAlgorithmConfig = {
  maxGapMs: 30_000,
  representativeMethod: "nearest_midpoint",
  intervalRule: "half-open",
};

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
