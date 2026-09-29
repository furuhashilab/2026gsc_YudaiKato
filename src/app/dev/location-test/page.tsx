"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LocationTestLog = {
  id: string;
  sampleId: string;
  sessionId: string;
  recordedAt: string;
  recordedAtUnixMs: number;
  geolocationTimestampMs: number;
  geolocationRecordedAt: string;
  positionAgeAtReceiptMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM: number | null;
  altitudeAccuracyM: number | null;
  headingDeg: number | null;
  speedMps: number | null;
  visibilityState: DocumentVisibilityState;
  intervalFromPreviousMs: number | null;
};

type LocationTestEvent = {
  occurredAt: string;
  type:
    | "recording_started"
    | "recording_stopped"
    | "visibility_changed"
    | "position_received"
    | "position_saved"
    | "position_skipped"
    | "geolocation_error";
  detail?: string;
};

type LatestPosition = Omit<LocationTestLog, "id" | "sampleId" | "sessionId" | "intervalFromPreviousMs">;

const MIN_SAVE_INTERVAL_MS = 10_000;
const MAX_RENDERED_LOGS = 200;
const MAX_EVENTS = 1_000;
const MAX_RENDERED_EVENTS = 200;
const GEOLOCATION_ERROR_CODE = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
} as const;
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

function createId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "—";
}

function formatNumber(value: number | null | undefined, digits = 2) {
  return value == null ? "—" : value.toFixed(digits);
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
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

function geolocationErrorName(code: number) {
  switch (code) {
    case GEOLOCATION_ERROR_CODE.PERMISSION_DENIED:
      return "PERMISSION_DENIED";
    case GEOLOCATION_ERROR_CODE.POSITION_UNAVAILABLE:
      return "POSITION_UNAVAILABLE";
    case GEOLOCATION_ERROR_CODE.TIMEOUT:
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
}

export default function LocationTestPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [isSecureContext, setIsSecureContext] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestPosition | null>(null);
  const [lastReceivedAtMs, setLastReceivedAtMs] = useState<number | null>(null);
  const [receiveIntervalMs, setReceiveIntervalMs] = useState<number | null>(null);
  const [logs, setLogs] = useState<LocationTestLog[]>([]);
  const [events, setEvents] = useState<LocationTestEvent[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [visibilityState, setVisibilityState] = useState<DocumentVisibilityState>("visible");
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const watchGenerationRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const lastSavedMonotonicRef = useRef<number | null>(null);
  const lastReceivedAtRef = useRef<number | null>(null);
  const recordingRef = useRef(false);

  const addEvent = useCallback((type: LocationTestEvent["type"], detail?: string) => {
    setEvents((current) => {
      const next = [...current, { occurredAt: new Date().toISOString(), type, detail }];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  const stopWatch = useCallback((recordEvent: boolean) => {
    // clearWatch後に配送済みコールバックが到着しても、新しいセッションへ混入させない。
    watchGenerationRef.current += 1;
    const watchId = watchIdRef.current;
    watchIdRef.current = null;
    try {
      if (watchId !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
    } finally {
      if (recordingRef.current) {
        recordingRef.current = false;
        setRecording(false);
        const stopped = new Date().toISOString();
        setStoppedAt(stopped);
        if (recordEvent) addEvent("recording_stopped", `session=${sessionIdRef.current ?? "unknown"}`);
      }
    }
  }, [addEvent]);

  const handlePosition = useCallback((position: GeolocationPosition, generation: number) => {
    if (generation !== watchGenerationRef.current || !recordingRef.current || !sessionIdRef.current) return;

    const receivedAtMs = Date.now();
    const receivedAtMonotonicMs = performance.now();
    const receivedAt = new Date(receivedAtMs).toISOString();
    const positionTimestampMs = position.timestamp;
    const currentVisibilityState = document.visibilityState;
    const intervalFromPreviousReceive = lastReceivedAtRef.current === null
      ? null
      : receivedAtMs - lastReceivedAtRef.current;
    lastReceivedAtRef.current = receivedAtMs;
    setLastReceivedAtMs(receivedAtMs);
    setReceiveIntervalMs(intervalFromPreviousReceive);

    const currentPosition: LatestPosition = {
      recordedAt: receivedAt,
      recordedAtUnixMs: receivedAtMs,
      geolocationTimestampMs: positionTimestampMs,
      geolocationRecordedAt: new Date(positionTimestampMs).toISOString(),
      positionAgeAtReceiptMs: receivedAtMs - positionTimestampMs,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy,
      altitudeM: position.coords.altitude,
      altitudeAccuracyM: position.coords.altitudeAccuracy,
      headingDeg: position.coords.heading,
      speedMps: position.coords.speed,
      visibilityState: currentVisibilityState,
    };
    setLatest(currentPosition);
    setVisibilityState(currentVisibilityState);
    setError(null);
    addEvent("position_received", `accuracy=${position.coords.accuracy.toFixed(1)}m`);

    const intervalFromPreviousSave = lastSavedMonotonicRef.current === null
      ? null
      : receivedAtMonotonicMs - lastSavedMonotonicRef.current;
    if (intervalFromPreviousSave !== null && intervalFromPreviousSave < MIN_SAVE_INTERVAL_MS) {
      setSkippedCount((count) => count + 1);
      addEvent("position_skipped", `前回保存から${(intervalFromPreviousSave / 1_000).toFixed(2)}秒`);
      return;
    }

    const sampleId = crypto.randomUUID();
    const log: LocationTestLog = {
      id: sampleId,
      sampleId,
      sessionId: sessionIdRef.current,
      ...currentPosition,
      intervalFromPreviousMs: intervalFromPreviousSave,
    };
    lastSavedMonotonicRef.current = receivedAtMonotonicMs;
    setLogs((current) => [...current, log]);
    addEvent("position_saved", `保存件数を追加・visibility=${currentVisibilityState}`);
  }, [addEvent]);

  const handleGeolocationError = useCallback((positionError: GeolocationPositionError) => {
    const name = geolocationErrorName(positionError.code);
    const guidance = positionError.code === GEOLOCATION_ERROR_CODE.PERMISSION_DENIED
      ? "ブラウザのサイト設定で位置情報を許可してから再度開始してください。"
      : positionError.code === GEOLOCATION_ERROR_CODE.POSITION_UNAVAILABLE
        ? "GPSを有効にし、屋外など測位しやすい場所で再試行してください。"
        : positionError.code === GEOLOCATION_ERROR_CODE.TIMEOUT
          ? "20秒以内に測位できませんでした。watchは継続して次の更新を待ちます。"
          : "不明な位置情報エラーです。";
    const message = `${name}: ${positionError.message || guidance} ${guidance}`;
    setError(message);
    addEvent("geolocation_error", message);
    if (positionError.code === GEOLOCATION_ERROR_CODE.PERMISSION_DENIED) stopWatch(true);
  }, [addEvent, stopWatch]);

  const startRecording = useCallback(() => {
    stopWatch(false);
    if (!window.isSecureContext) {
      const message = "LAN内IPへのHTTP接続では位置情報を利用できません。HTTPSでこのページを開いてください。";
      setError(message);
      addEvent("geolocation_error", message);
      return;
    }
    if (!("geolocation" in navigator)) {
      const message = "このブラウザはGeolocation APIに対応していません。";
      setError(message);
      addEvent("geolocation_error", message);
      return;
    }

    const newSessionId = createId();
    const generation = watchGenerationRef.current;
    const start = new Date().toISOString();
    sessionIdRef.current = newSessionId;
    lastSavedMonotonicRef.current = null;
    lastReceivedAtRef.current = null;
    recordingRef.current = true;
    setSessionId(newSessionId);
    setStartedAt(start);
    setStoppedAt(null);
    setRecording(true);
    setLatest(null);
    setLastReceivedAtMs(null);
    setReceiveIntervalMs(null);
    setSkippedCount(0);
    setError(null);
    addEvent("recording_started", `session=${newSessionId}`);

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => handlePosition(position, generation),
        (positionError) => {
          if (generation === watchGenerationRef.current) handleGeolocationError(positionError);
        },
        WATCH_OPTIONS,
      );
    } catch (cause) {
      const message = `watch開始中の例外: ${cause instanceof Error ? cause.message : String(cause)}`;
      setError(message);
      addEvent("geolocation_error", message);
      stopWatch(true);
    }
  }, [addEvent, handleGeolocationError, handlePosition, stopWatch]);

  useEffect(() => {
    const initialSyncId = window.setTimeout(() => {
      setNow(new Date());
      setIsSecureContext(window.isSecureContext);
      setVisibilityState(document.visibilityState);
    }, 0);
    const clockId = window.setInterval(() => setNow(new Date()), 1_000);
    const handleVisibilityChange = () => {
      setVisibilityState(document.visibilityState);
      addEvent("visibility_changed", document.visibilityState);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(initialSyncId);
      window.clearInterval(clockId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopWatch(false);
    };
  }, [addEvent, stopWatch]);

  function clearLogs() {
    setLogs([]);
    setEvents([]);
    setSkippedCount(0);
    lastSavedMonotonicRef.current = null;
  }

  function saveJson() {
    const exportedAt = new Date();
    const payload = {
      exportedAt: exportedAt.toISOString(),
      sessionId,
      startedAt,
      stoppedAt,
      minSaveIntervalMs: MIN_SAVE_INTERVAL_MS,
      userAgent: navigator.userAgent,
      locationLogs: logs,
      events,
    };
    download(
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
      `location-test-${filenameTimestamp(exportedAt)}.json`,
    );
  }

  function saveCsv() {
    const headers = [
      "client_sample_id", "session_id", "received_at", "received_at_unix_ms", "geolocation_recorded_at",
      "geolocation_timestamp_ms", "position_age_at_receipt_ms", "latitude", "longitude",
      "accuracy_m", "altitude_m", "altitude_accuracy_m", "heading_deg", "speed_mps",
      "visibility_state", "interval_from_previous_ms",
    ];
    const rows = logs.map((log) => [
      log.sampleId, log.sessionId, log.recordedAt, log.recordedAtUnixMs, log.geolocationRecordedAt,
      log.geolocationTimestampMs, log.positionAgeAtReceiptMs, log.latitude, log.longitude,
      log.accuracyM, log.altitudeM, log.altitudeAccuracyM, log.headingDeg, log.speedMps,
      log.visibilityState, log.intervalFromPreviousMs,
    ].map(csvCell).join(","));
    const exportedAt = new Date();
    download(
      `\uFEFF${[headers.join(","), ...rows].join("\r\n")}`,
      "text/csv;charset=utf-8",
      `location-test-${filenameTimestamp(exportedAt)}.csv`,
    );
  }

  const elapsedMs = startedAt
    ? (stoppedAt && !recording
      ? new Date(stoppedAt).getTime()
      : now?.getTime() ?? new Date(startedAt).getTime()) - new Date(startedAt).getTime()
    : 0;
  const insecureContext = isSecureContext === false;
  const renderedLogs = logs.slice(-MAX_RENDERED_LOGS);
  const renderedEvents = events.slice(-MAX_RENDERED_EVENTS).reverse();

  return (
    <main className="location-test">
      <h1>位置情報・バックグラウンド挙動検証</h1>
      <p className="notice">位置情報の利用許可が必要です。スマートフォンではHTTPS（またはlocalhost）で開いてください。ブラウザのバックグラウンド移行や画面ロック中の継続取得は保証されません。</p>
      {insecureContext && <p className="error" role="alert"><strong>非セキュア接続:</strong> LAN内IPへのHTTP接続では位置情報を利用できません。HTTPSの開発用URLで開いてください。</p>}

      <section className={`recording-panel ${recording ? "is-recording" : ""}`} aria-live="polite">
        <span className="recording-indicator" aria-hidden="true" />
        <strong>{recording ? "記録中（位置更新を待機しています）" : "停止中"}</strong>
      </section>

      <section className="status-grid" aria-label="記録状態">
        <div><strong>現在時刻</strong><span>{now ? now.toLocaleString("ja-JP") : "—"}</span></div>
        <div><strong>記録状態</strong><span>{recording ? "記録中" : "停止中"}</span></div>
        <div><strong>記録開始時刻</strong><span>{formatDate(startedAt)}</span></div>
        <div><strong>記録経過時間</strong><span>{formatDuration(elapsedMs)}</span></div>
        <div><strong>保存件数</strong><span>{logs.length}件</span></div>
        <div><strong>スキップ件数</strong><span>{skippedCount}件</span></div>
        <div><strong>最終取得時刻</strong><span>{lastReceivedAtMs ? new Date(lastReceivedAtMs).toLocaleString("ja-JP") : "—"}</span></div>
        <div><strong>前回取得からの間隔</strong><span>{receiveIntervalMs === null ? "—" : `${(receiveIntervalMs / 1_000).toFixed(2)}秒`}</span></div>
        <div><strong>document.visibilityState</strong><span>{visibilityState}</span></div>
        <div><strong>保存間隔</strong><span>{MIN_SAVE_INTERVAL_MS / 1_000}秒以上</span></div>
      </section>

      <div className="actions">
        <button type="button" onClick={startRecording}>{recording ? "記録を再開始" : "記録開始"}</button>
        <button type="button" onClick={() => stopWatch(true)} disabled={!recording}>記録停止</button>
        <button type="button" onClick={clearLogs} disabled={!logs.length && !events.length}>ログクリア</button>
        <button type="button" onClick={saveJson} disabled={!logs.length && !events.length}>JSON保存</button>
        <button type="button" onClick={saveCsv} disabled={!logs.length}>CSV保存</button>
      </div>

      {!logs.length && !events.length && <p className="summary">JSON／CSV保存は、位置ログまたはイベントが記録されると利用できます。</p>}

      {error && <p className="error" role="alert"><strong>Geolocationエラー:</strong> {error}</p>}

      <section>
        <h2>現在の最新位置（受信値）</h2>
        <div className="status-grid latest-position">
          <div><strong>緯度</strong><span>{formatNumber(latest?.latitude, 7)}</span></div>
          <div><strong>経度</strong><span>{formatNumber(latest?.longitude, 7)}</span></div>
          <div><strong>GPS精度</strong><span>{latest ? `${formatNumber(latest.accuracyM, 1)} m` : "—"}</span></div>
          <div><strong>速度</strong><span>{latest?.speedMps == null ? "—" : `${formatNumber(latest.speedMps)} m/s`}</span></div>
          <div><strong>方角</strong><span>{latest?.headingDeg == null ? "—" : `${formatNumber(latest.headingDeg, 1)}°`}</span></div>
          <div><strong>高度</strong><span>{latest?.altitudeM == null ? "—" : `${formatNumber(latest.altitudeM, 1)} m`}</span></div>
          <div><strong>高度精度</strong><span>{latest?.altitudeAccuracyM == null ? "—" : `${formatNumber(latest.altitudeAccuracyM, 1)} m`}</span></div>
          <div><strong>位置情報の測位時刻</strong><span>{latest ? formatDate(latest.geolocationRecordedAt) : "—"}</span></div>
          <div><strong>コールバック受信時刻</strong><span>{latest ? formatDate(latest.recordedAt) : "—"}</span></div>
          <div><strong>受信時の位置情報の古さ</strong><span>{latest ? `${latest.positionAgeAtReceiptMs.toFixed(0)} ms` : "—"}</span></div>
          <div><strong>取得時の画面状態</strong><span>{latest?.visibilityState ?? "—"}</span></div>
        </div>
      </section>

      <section>
        <h2>保存済み位置ログ（全{logs.length}件・直近{renderedLogs.length}件を古い順に表示）</h2>
        <div className="table-wrap"><table><thead><tr><th>保存時刻</th><th>保存間隔</th><th>画面状態</th><th>緯度</th><th>経度</th><th>精度(m)</th><th>速度(m/s)</th><th>方角(°)</th><th>高度(m)</th></tr></thead><tbody>
          {renderedLogs.map((log) => <tr key={log.id}><td>{formatDate(log.recordedAt)}</td><td>{log.intervalFromPreviousMs === null ? "初回" : `${(log.intervalFromPreviousMs / 1_000).toFixed(2)}秒`}</td><td>{log.visibilityState}</td><td>{log.latitude.toFixed(7)}</td><td>{log.longitude.toFixed(7)}</td><td>{log.accuracyM.toFixed(1)}</td><td>{formatNumber(log.speedMps)}</td><td>{formatNumber(log.headingDeg, 1)}</td><td>{formatNumber(log.altitudeM, 1)}</td></tr>)}
        </tbody></table></div>
      </section>

      <section>
        <h2>イベント履歴（保持{events.length}件・直近{renderedEvents.length}件を最新順に表示）</h2>
        <div className="table-wrap"><table><thead><tr><th>発生時刻</th><th>種別</th><th>詳細</th></tr></thead><tbody>
          {renderedEvents.map((event, index) => <tr className={`event-${event.type}`} key={`${event.occurredAt}-${event.type}-${index}`}><td>{formatDate(event.occurredAt)}</td><td>{event.type}</td><td>{event.detail ?? "—"}</td></tr>)}
        </tbody></table></div>
      </section>
    </main>
  );
}
