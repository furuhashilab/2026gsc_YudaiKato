"use client";

import { useCallback, useMemo, useState } from "react";

import {
  convertLastFmTracksToTimelineScrobbles,
  DEFAULT_TIMELINE_JOIN_CONFIG,
  getTimelineFixtureCase,
  joinScrobblesWithLocations,
  TIMELINE_FIXTURE_CASES,
  validateTimelineInputs,
} from "@/lib/timeline-join";
import type {
  TimelineJoinConfig,
  TimelineJoinResult,
  TimelineLocationSample,
  TimelineScrobble,
} from "@/lib/timeline-join";

type DataSourceMode = "fixture" | "live";

type LastFmRecentTrack = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  nowPlaying: boolean;
  playedAt: string | null;
  playedAtUnix: number | null;
  lastFmUrl: string | null;
  mbid: string | null;
};

type LastFmResponse = {
  fetchedAt: string;
  username: string;
  items: LastFmRecentTrack[];
};

type ApiError = {
  error?: string;
  lastFmError?: { code: number | null; message: string };
};

const CONFIG_FIELDS: Array<{
  key: keyof TimelineJoinConfig;
  label: string;
  description: string;
}> = [
  {
    key: "durationToleranceMs",
    label: "durationToleranceMs",
    description: "楽曲時間へ加える暫定猶予",
  },
  {
    key: "fallbackDurationMs",
    label: "fallbackDurationMs",
    description: "終了根拠がない場合の暫定区間",
  },
  {
    key: "maxTrackWindowMs",
    label: "maxTrackWindowMs",
    description: "次曲を終了根拠にできる最大間隔",
  },
  {
    key: "locationEdgeToleranceMs",
    label: "locationEdgeToleranceMs",
    description: "区間外位置を許容する端からの距離",
  },
  {
    key: "lowAccuracyWarningThresholdM",
    label: "lowAccuracyWarningThresholdM",
    description: "位置精度警告を付ける暫定閾値",
  },
];

const JAPAN_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function configToInputs(config: TimelineJoinConfig) {
  return Object.fromEntries(
    CONFIG_FIELDS.map(({ key }) => [key, String(config[key])]),
  ) as Record<keyof TimelineJoinConfig, string>;
}

function DualTime({ unixMs }: { unixMs: number }) {
  const date = new Date(unixMs);
  if (!Number.isFinite(unixMs) || !Number.isFinite(date.getTime())) {
    return <span className="dual-time"><span>無効な時刻</span></span>;
  }
  return (
    <span className="dual-time">
      <time dateTime={date.toISOString()}>UTC {date.toISOString()}</time>
      <small>JST {JAPAN_TIME_FORMATTER.format(date)}</small>
    </span>
  );
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  return `${milliseconds.toLocaleString("ja-JP")} ms (${(milliseconds / 60_000).toFixed(2)}分)`;
}

function filenameTimestamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function getTimeBounds<T>(items: T[], getTime: (item: T) => number) {
  const times = items
    .map(getTime)
    .filter((value) => Number.isFinite(value) && Number.isFinite(new Date(value).getTime()));
  if (times.length === 0) return null;
  return { first: Math.min(...times), last: Math.max(...times) };
}

function summarize(results: TimelineJoinResult[]) {
  return results.reduce(
    (summary, result) => ({ ...summary, [result.matchStatus]: summary[result.matchStatus] + 1 }),
    { matched: 0, partial: 0, unmatched: 0 },
  );
}

function generateDummyLocations(
  scrobbles: TimelineScrobble[],
  config: TimelineJoinConfig,
) {
  const segments = joinScrobblesWithLocations(scrobbles, [], config);
  const timestamps = new Set<number>();
  for (const segment of segments) {
    for (
      let time = segment.startedAtUnixMs;
      time < segment.estimatedEndedAtUnixMs;
      time += 10_000
    ) {
      timestamps.add(time);
    }
  }

  return [...timestamps]
    .sort((left, right) => left - right)
    .map<TimelineLocationSample>((recordedAtUnixMs, index) => ({
      id: `live-dummy-location-${recordedAtUnixMs}`,
      recordedAt: new Date(recordedAtUnixMs).toISOString(),
      recordedAtUnixMs,
      latitude: 35.681236 + index * 0.00001,
      longitude: 139.767125 + index * 0.00001,
      accuracyM: index % 11 === 0 ? 120 : 15,
      source: "fixture",
    }));
}

export default function TimelineJoinTestPage() {
  const [mode, setMode] = useState<DataSourceMode>("fixture");
  const [selectedCaseId, setSelectedCaseId] = useState("A");
  const [configInputs, setConfigInputs] = useState(() => configToInputs(DEFAULT_TIMELINE_JOIN_CONFIG));
  const [appliedConfig, setAppliedConfig] = useState<TimelineJoinConfig>(DEFAULT_TIMELINE_JOIN_CONFIG);
  const [configError, setConfigError] = useState<string | null>(null);
  const [liveScrobbles, setLiveScrobbles] = useState<TimelineScrobble[]>([]);
  const [liveLocations, setLiveLocations] = useState<TimelineLocationSample[]>([]);
  const [liveFetchedAt, setLiveFetchedAt] = useState<string | null>(null);
  const [liveUsername, setLiveUsername] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const selectedFixture = getTimelineFixtureCase(selectedCaseId);
  const scrobbles = mode === "fixture" ? selectedFixture.scrobbles : liveScrobbles;
  const locationSamples = mode === "fixture" ? selectedFixture.locationSamples : liveLocations;
  const results = useMemo(
    () => joinScrobblesWithLocations(scrobbles, locationSamples, appliedConfig),
    [appliedConfig, locationSamples, scrobbles],
  );
  const validation = useMemo(
    () => validateTimelineInputs(scrobbles, locationSamples),
    [locationSamples, scrobbles],
  );
  const invalidInputCount = useMemo(() => new Set(
    validation.issues.map((issue) => `${issue.inputType}:${issue.inputId ?? "unknown"}`),
  ).size, [validation.issues]);
  const summary = useMemo(() => summarize(results), [results]);
  const scrobbleBounds = getTimeBounds(scrobbles, (item) => item.playedAtUnixMs);
  const locationBounds = getTimeBounds(locationSamples, (item) => item.recordedAtUnixMs);

  const fetchLiveScrobbles = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const response = await fetch("/api/lastfm/recent", { cache: "no-store" });
      const body = (await response.json()) as LastFmResponse | ApiError;
      if (!response.ok || !("items" in body)) {
        const apiError: ApiError = "items" in body ? {} : body;
        const detail = apiError.lastFmError
          ? ` Last.fm ${apiError.lastFmError.code ?? "HTTP"}: ${apiError.lastFmError.message}`
          : "";
        throw new Error(`${apiError.error ?? "Last.fm API取得に失敗しました。"}${detail}`);
      }

      const confirmedScrobbles = convertLastFmTracksToTimelineScrobbles(body.items, body.username);
      setLiveScrobbles(confirmedScrobbles);
      setLiveLocations([]);
      setLiveFetchedAt(body.fetchedAt);
      setLiveUsername(body.username);
      if (confirmedScrobbles.length === 0) {
        setLiveError("date.utsまたはISO時刻を持つ確定Scrobbleがありませんでした。");
      }
    } catch (cause) {
      setLiveError(cause instanceof Error ? cause.message : "予期しない取得エラーが発生しました。");
    } finally {
      setLiveLoading(false);
    }
  }, []);

  function applyConfig() {
    const nextConfig = { ...DEFAULT_TIMELINE_JOIN_CONFIG };
    for (const { key, label } of CONFIG_FIELDS) {
      const value = Number(configInputs[key]);
      if (!Number.isFinite(value) || value < 0) {
        setConfigError(`${label} は0以上の数値にしてください。`);
        return;
      }
      nextConfig[key] = value;
    }
    setAppliedConfig(nextConfig);
    setConfigError(null);
  }

  function resetConfig() {
    setConfigInputs(configToInputs(DEFAULT_TIMELINE_JOIN_CONFIG));
    setAppliedConfig(DEFAULT_TIMELINE_JOIN_CONFIG);
    setConfigError(null);
  }

  function saveJson() {
    const exportedAt = new Date();
    const payload = {
      exportedAt: exportedAt.toISOString(),
      selectedCase: mode === "fixture" ? selectedFixture.id : "live_lastfm",
      dataSourceMode: mode,
      config: appliedConfig,
      scrobbles,
      locationSamples,
      validation,
      results,
      summary,
    };
    download(
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
      `timeline-join-${filenameTimestamp(exportedAt)}.json`,
    );
  }

  function saveCsv() {
    const headers = [
      "event_id",
      "external_event_key",
      "track_name",
      "artist_name",
      "started_at",
      "estimated_ended_at",
      "end_method",
      "duration_ms",
      "segment_duration_ms",
      "midpoint_at",
      "location_sample_count",
      "representative_recorded_at",
      "representative_latitude",
      "representative_longitude",
      "representative_accuracy_m",
      "representative_distance_from_midpoint_ms",
      "location_match_method",
      "match_status",
      "warnings",
    ];
    const rows = results.map((result) => [
      result.eventId,
      result.externalEventKey,
      result.trackName,
      result.artistName,
      result.startedAt,
      result.estimatedEndedAt,
      result.endMethod,
      result.durationMs,
      result.segmentDurationMs,
      result.midpointAt,
      result.locationSampleCount,
      result.representativeLocation?.recordedAt ?? null,
      result.representativeLocation?.latitude ?? null,
      result.representativeLocation?.longitude ?? null,
      result.representativeLocation?.accuracyM ?? null,
      result.representativeDistanceFromMidpointMs,
      result.locationMatchMethod,
      result.matchStatus,
      result.warnings.join("|"),
    ].map(csvCell).join(","));
    const exportedAt = new Date();
    download(
      `\uFEFF${[headers.join(","), ...rows].join("\r\n")}`,
      "text/csv;charset=utf-8",
      `timeline-join-${filenameTimestamp(exportedAt)}.csv`,
    );
  }

  return (
    <main className="timeline-join-test">
      <header className="timeline-heading">
        <div>
          <p className="eyebrow">Recorded Spot core logic validation</p>
          <h1>Scrobble・位置ログ時刻結合検証</h1>
          <p>内部計算はUnixミリ秒のみを使用し、表示ではUTCと日本時間を併記します。</p>
        </div>
        <div className="export-actions">
          <button type="button" onClick={saveJson} disabled={!results.length}>JSON保存</button>
          <button type="button" onClick={saveCsv} disabled={!results.length}>CSV保存（UTF-8 BOM）</button>
        </div>
      </header>

      <section className="timeline-panel" aria-labelledby="data-source-heading">
        <div className="section-heading">
          <div><p className="section-number">01</p><h2 id="data-source-heading">入力データ</h2></div>
          <div className="mode-switch" role="group" aria-label="データソース">
            <button
              type="button"
              className={mode === "fixture" ? "is-active" : ""}
              aria-pressed={mode === "fixture"}
              onClick={() => setMode("fixture")}
            >Fixtureモード</button>
            <button
              type="button"
              className={mode === "live" ? "is-active" : ""}
              aria-pressed={mode === "live"}
              onClick={() => setMode("live")}
            >Live Last.fmモード</button>
          </div>
        </div>

        {mode === "fixture" ? (
          <div className="fixture-picker">
            <label htmlFor="fixture-case">検証ケース
              <select
                id="fixture-case"
                value={selectedCaseId}
                onChange={(event) => setSelectedCaseId(event.target.value)}
              >
                {TIMELINE_FIXTURE_CASES.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>{fixture.label}</option>
                ))}
              </select>
            </label>
            <div className="fixture-description">
              <strong>{selectedFixture.purpose}</strong>
              <span>期待結果：{selectedFixture.expected}</span>
            </div>
          </div>
        ) : (
          <div className="live-controls">
            <div className="actions">
              <button type="button" onClick={() => void fetchLiveScrobbles()} disabled={liveLoading}>
                {liveLoading ? "取得中…" : "確定Scrobbleを取得"}
              </button>
              <button
                type="button"
                onClick={() => setLiveLocations(generateDummyLocations(liveScrobbles, appliedConfig))}
                disabled={!liveScrobbles.length}
              >10秒間隔のダミー位置ログを生成</button>
            </div>
            <p className="summary">
              nowPlaying=trueを除外し、Unix秒またはISO時刻を持つ項目だけを使用します。
              {liveUsername ? ` ユーザー: ${liveUsername}` : ""}
              {liveFetchedAt ? ` / 取得: ${new Date(liveFetchedAt).toISOString()}` : ""}
            </p>
            {liveError && <p className="error" role="alert">{liveError}</p>}
          </div>
        )}

        <div className="input-summary-grid">
          <article>
            <span>Scrobble</span><strong>{scrobbles.length}件</strong>
            <small>最初 {scrobbleBounds ? new Date(scrobbleBounds.first).toISOString() : "—"}</small>
            <small>最後 {scrobbleBounds ? new Date(scrobbleBounds.last).toISOString() : "—"}</small>
          </article>
          <article>
            <span>位置サンプル</span><strong>{locationSamples.length}件</strong>
            <small>最初 {locationBounds ? new Date(locationBounds.first).toISOString() : "—"}</small>
            <small>最後 {locationBounds ? new Date(locationBounds.last).toISOString() : "—"}</small>
          </article>
          <article className={validation.issues.length ? "validation-has-issues" : "validation-ok"}>
            <span>不正データ</span><strong>{invalidInputCount}件</strong>
            <small>validation issue {validation.issues.length}件</small>
            <small>有効Scrobble {validation.validScrobbles.length}件</small>
            <small>有効位置サンプル {validation.validLocationSamples.length}件</small>
          </article>
        </div>

        <details open={validation.issues.length > 0}>
          <summary>入力検証issue（{validation.issues.length}件）</summary>
          {validation.issues.length === 0 ? <p className="validation-empty">結合対象から除外された入力はありません。</p> : (
            <div className="table-wrap"><table><thead><tr><th>入力種別</th><th>issue code</th><th>入力ID</th><th>メッセージ</th><th>扱い</th></tr></thead><tbody>
              {validation.issues.map((issue, index) => <tr key={`${issue.inputType}-${issue.inputId}-${issue.code}-${index}`}><td>{issue.inputType}</td><td><code>{issue.code}</code></td><td><code>{issue.inputId ?? "—"}</code></td><td>{issue.message}</td><td>{issue.excluded ? "結合対象から除外" : "継続利用"}</td></tr>)}
            </tbody></table></div>
          )}
        </details>

        <details>
          <summary>Scrobble一覧（入力順）</summary>
          <div className="table-wrap"><table><thead><tr><th>ID</th><th>externalEventKey</th><th>曲</th><th>アーティスト</th><th>開始時刻</th><th>duration</th><th>source</th></tr></thead><tbody>
            {scrobbles.map((item, index) => <tr key={`${item.id}-${index}`}><td><code>{item.id}</code></td><td><code>{item.externalEventKey}</code></td><td>{item.trackName}</td><td>{item.artistName}</td><td><DualTime unixMs={item.playedAtUnixMs} /></td><td>{formatDuration(item.durationMs)}</td><td>{item.source}</td></tr>)}
          </tbody></table></div>
        </details>

        <details>
          <summary>位置サンプル一覧（入力順）</summary>
          <div className="table-wrap"><table><thead><tr><th>ID</th><th>記録時刻</th><th>緯度</th><th>経度</th><th>精度(m)</th><th>source</th></tr></thead><tbody>
            {locationSamples.map((item, index) => <tr key={`${item.id}-${index}`}><td><code>{item.id}</code></td><td><DualTime unixMs={item.recordedAtUnixMs} /></td><td>{item.latitude.toFixed(7)}</td><td>{item.longitude.toFixed(7)}</td><td>{item.accuracyM ?? "—"}</td><td>{item.source}</td></tr>)}
          </tbody></table></div>
        </details>
      </section>

      <section className="timeline-panel" aria-labelledby="config-heading">
        <div className="section-heading"><div><p className="section-number">02</p><h2 id="config-heading">暫定設定値</h2></div><p>すべて技術検証用で、最終研究仕様ではありません。</p></div>
        <div className="config-grid">
          {CONFIG_FIELDS.map((field) => (
            <label key={field.key} htmlFor={field.key}>{field.label}
              <input
                id={field.key}
                type="number"
                min="0"
                step="1000"
                value={configInputs[field.key]}
                onChange={(event) => setConfigInputs((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))}
              />
              <small>{field.description}</small>
            </label>
          ))}
        </div>
        <div className="actions">
          <button type="button" onClick={applyConfig}>再計算</button>
          <button type="button" onClick={resetConfig}>初期値へ戻す</button>
        </div>
        {configError && <p className="error" role="alert">{configError}</p>}
      </section>

      <section className="timeline-panel" aria-labelledby="result-heading">
        <div className="section-heading"><div><p className="section-number">03</p><h2 id="result-heading">結合結果</h2></div><p>{results.length}イベントを開始時刻順に処理</p></div>
        <div className="join-summary" aria-label="ステータス集計">
          <div className="status-matched"><span>matched</span><strong>{summary.matched}</strong></div>
          <div className="status-partial"><span>partial</span><strong>{summary.partial}</strong></div>
          <div className="status-unmatched"><span>unmatched</span><strong>{summary.unmatched}</strong></div>
        </div>

        {results.length === 0 ? <p className="empty-state">結合対象の確定Scrobbleがありません。</p> : (
          <div className="result-list">
            {results.map((result, index) => (
              <article className={`result-card result-${result.matchStatus}`} key={`${result.eventId}-${index}`}>
                <div className="result-card-heading">
                  <div><p>EVENT {String(index + 1).padStart(2, "0")} / <code>{result.eventId}</code></p><h3>{result.trackName}</h3><span>{result.artistName}</span></div>
                  <strong className={`status-badge status-${result.matchStatus}`}>{result.matchStatus}</strong>
                </div>
                <dl className="result-grid">
                  <div><dt>externalEventKey</dt><dd><code>{result.externalEventKey}</code></dd></div>
                  <div><dt>開始時刻</dt><dd><DualTime unixMs={result.startedAtUnixMs} /></dd></div>
                  <div><dt>推定終了時刻</dt><dd><DualTime unixMs={result.estimatedEndedAtUnixMs} /></dd></div>
                  <div><dt>終了決定方法</dt><dd><code>{result.endMethod}</code></dd></div>
                  <div><dt>曲区間の長さ</dt><dd>{formatDuration(result.segmentDurationMs)}</dd></div>
                  <div><dt>楽曲duration</dt><dd>{formatDuration(result.durationMs)}</dd></div>
                  <div><dt>中間時刻</dt><dd><DualTime unixMs={result.midpointAtUnixMs} /></dd></div>
                  <div><dt>区間内位置サンプル</dt><dd>{result.locationSampleCount}件</dd></div>
                  <div><dt>位置選択方法</dt><dd><code>{result.locationMatchMethod}</code></dd></div>
                  <div><dt>代表地点</dt><dd>{result.representativeLocation ? `${result.representativeLocation.latitude.toFixed(7)}, ${result.representativeLocation.longitude.toFixed(7)} / 精度 ${result.representativeLocation.accuracyM ?? "—"}m` : "なし"}</dd></div>
                  <div><dt>代表地点の時刻</dt><dd>{result.representativeLocation ? <DualTime unixMs={result.representativeLocation.recordedAtUnixMs} /> : "—"}</dd></div>
                  <div><dt>中間時刻との差</dt><dd>{result.representativeDistanceFromMidpointMs === null ? "—" : `${result.representativeDistanceFromMidpointMs.toLocaleString("ja-JP")} ms`}</dd></div>
                  <div><dt>警告</dt><dd className="warning-list">{result.warnings.length ? result.warnings.map((warning) => <code key={warning}>{warning}</code>) : <span>なし</span>}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
