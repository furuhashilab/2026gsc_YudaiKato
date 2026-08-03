"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type LastFmTestLog = {
  fetchedAt: string;
  visibilityState: string;
  trackName: string;
  artistName: string;
  nowPlaying: boolean;
  playedAt: string | null;
  playedAtUnix: number | null;
};

const POLLING_INTERVAL_MS = 15_000;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "—";
}

function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | boolean | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export default function LastFmTestPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<LastFmResponse | null>(null);
  const [logs, setLogs] = useState<LastFmTestLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const inFlightRef = useRef(false);

  const fetchRecentTracks = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRequesting(true);

    try {
      const response = await fetch("/api/lastfm/recent", { cache: "no-store" });
      const body = (await response.json()) as LastFmResponse | ApiError;
      if (!response.ok || !("items" in body)) {
        const apiError: ApiError = "items" in body ? {} : body;
        const detail = apiError.lastFmError
          ? ` Last.fm ${apiError.lastFmError.code ?? "HTTP"}: ${apiError.lastFmError.message}`
          : "";
        throw new Error(`${apiError.error ?? "API取得に失敗しました。"}${detail}`);
      }

      const visibilityState = document.visibilityState;
      const newLogs = body.items.map<LastFmTestLog>((track) => ({
        fetchedAt: body.fetchedAt,
        visibilityState,
        trackName: track.trackName,
        artistName: track.artistName,
        nowPlaying: track.nowPlaying,
        playedAt: track.playedAt,
        playedAtUnix: track.playedAtUnix,
      }));
      setData(body);
      setLogs((current) => [...newLogs, ...current]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
    } finally {
      inFlightRef.current = false;
      setRequesting(false);
    }
  }, []);

  useEffect(() => {
    const initialClockId = window.setTimeout(() => setNow(new Date()), 0);
    const clockId = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initialClockId);
      window.clearInterval(clockId);
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    const initialId = window.setTimeout(() => void fetchRecentTracks(), 0);
    const pollingId = window.setInterval(() => void fetchRecentTracks(), POLLING_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(pollingId);
    };
  }, [fetchRecentTracks, polling]);

  const nowPlaying = data?.items.find((track) => track.nowPlaying) ?? null;
  const scrobbles = data?.items.filter((track) => !track.nowPlaying && track.playedAt) ?? [];

  function saveJson() {
    download(JSON.stringify(logs, null, 2), "application/json;charset=utf-8", "lastfm-test-log.json");
  }

  function saveCsv() {
    const headers: (keyof LastFmTestLog)[] = ["fetchedAt", "visibilityState", "trackName", "artistName", "nowPlaying", "playedAt", "playedAtUnix"];
    const rows = [headers.map(csvCell).join(","), ...logs.map((log) => headers.map((key) => csvCell(log[key])).join(","))];
    download(`\uFEFF${rows.join("\r\n")}`, "text/csv;charset=utf-8", "lastfm-test-log.csv");
  }

  return (
    <main className="lastfm-test">
      <h1>Last.fm 視聴履歴検証</h1>
      <section className="status-grid" aria-label="取得状態">
        <div><strong>現在時刻</strong><span>{now ? now.toLocaleString("ja-JP") : "—"}</span></div>
        <div><strong>最終API取得時刻</strong><span>{formatDate(data?.fetchedAt ?? null)}</span></div>
        <div><strong>ポーリング状態</strong><span>{polling ? `有効（15秒間隔）${requesting ? "・取得中" : ""}` : "停止中"}</span></div>
        <div><strong>Last.fmユーザー</strong><span>{data?.username ?? "—"}</span></div>
      </section>

      <div className="actions">
        <button type="button" onClick={() => setPolling((value) => !value)}>{polling ? "ポーリング停止" : "ポーリング再開"}</button>
        <button type="button" onClick={() => void fetchRecentTracks()} disabled={requesting}>今すぐ取得</button>
      </div>

      {error && <p className="error" role="alert"><strong>APIエラー:</strong> {error}</p>}

      <section className="now-playing-panel">
        <h2>現在再生中</h2>
        {nowPlaying ? <p><strong>{nowPlaying.trackName}</strong> — {nowPlaying.artistName}<br /><span>nowplaying=true（再生開始時刻はLast.fm APIから返されません）</span></p> : <p>再生中の曲は検出されていません。</p>}
      </section>

      <section>
        <h2>最近の確定Scrobble</h2>
        <ol className="tracks">
          {scrobbles.map((track, index) => <li className="track" key={`${track.playedAtUnix}-${track.trackName}-${index}`}><div><strong>{track.trackName}</strong><p>{track.artistName}{track.albumName ? ` — ${track.albumName}` : ""}</p></div><div><small>再生開始時刻</small><br /><time dateTime={track.playedAt ?? undefined}>{formatDate(track.playedAt)}</time></div></li>)}
        </ol>
      </section>

      <section>
        <div className="log-heading"><h2>検証ログ（{logs.length}件・最新順）</h2><div className="actions"><button type="button" onClick={() => setLogs([])} disabled={!logs.length}>クリア</button><button type="button" onClick={saveJson} disabled={!logs.length}>JSONとして保存</button><button type="button" onClick={saveCsv} disabled={!logs.length}>CSVとして保存</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>API取得時刻</th><th>画面状態</th><th>曲</th><th>アーティスト</th><th>状態</th><th>再生開始時刻</th><th>Unix秒</th></tr></thead><tbody>{logs.map((log, index) => <tr key={`${log.fetchedAt}-${log.playedAtUnix}-${index}`}><td>{formatDate(log.fetchedAt)}</td><td>{log.visibilityState}</td><td>{log.trackName}</td><td>{log.artistName}</td><td>{log.nowPlaying ? "再生中" : "確定"}</td><td>{formatDate(log.playedAt)}</td><td>{log.playedAtUnix ?? "—"}</td></tr>)}</tbody></table></div>
      </section>
    </main>
  );
}
