"use client";

import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Popup, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * maplibre-gl v6はWorkerをimport.meta.url相対で解決するが、Turbopackでは
 * そのURLが正しくバンドル・配信されずtext/htmlが返る。postinstallで
 * public/へコピーした同梱Workerを直接指定して回避する。
 */
setWorkerUrl("/maplibre-gl-worker.mjs");

type GeoJsonPosition = [number, number];

type SegmentGeometry =
  | { type: "Point"; coordinates: GeoJsonPosition }
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | null;

type SegmentProperties = {
  joinResultId: string;
  trackName: string;
  artistName: string;
  startedAt: string;
  estimatedEndedAt: string;
  matchStatus: string;
};

type SegmentFeature = {
  type: "Feature";
  geometry: SegmentGeometry;
  properties: SegmentProperties;
};

type Segment = SegmentProperties & { geoJson: SegmentFeature };

type GpsTrackGeometry =
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | { type: "MultiLineString"; coordinates: GeoJsonPosition[][] };

type GpsTrackFeatureCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: GpsTrackGeometry; properties: Record<string, never> }[];
};

type MapDataResponse = {
  journey: { id: string; startedAt: string; endedAt: string | null };
  gpsTrack: GpsTrackFeatureCollection;
  segments: Segment[];
};

/**
 * tile.openstreetmap.orgはVercel環境からのCORSを許可していないため、
 * CORS対応済みのOpenFreeMapが配信するベクタースタイルを利用する。
 * attributionはこのスタイルのsourcesに含まれており、デフォルトで有効な
 * AttributionControlがそこから自動的に表示する。
 */
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const DEFAULT_CENTER: GeoJsonPosition = [139.7671, 35.6812];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "—";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function geometryCoordinates(geometry: SegmentGeometry | GpsTrackGeometry | null): GeoJsonPosition[] {
  if (!geometry) return [];
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  return geometry.coordinates.flat();
}

type Props = { journeyId: string };

export function JourneyMapView({ journeyId }: Props) {
  const [data, setData] = useState<MapDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/journeys/${journeyId}/map-data`, { cache: "no-store" });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : `地図データの取得に失敗しました（HTTP ${response.status}）。`;
          throw new Error(message);
        }
        if (!cancelled) setData(body as MapDataResponse);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "予期しないエラーが発生しました。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [journeyId]);

  useEffect(() => {
    if (!data || !containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 11,
    });

    map.on("load", () => {
      map.addSource("gps-track", { type: "geojson", data: data.gpsTrack });
      map.addLayer({
        id: "gps-track-line",
        type: "line",
        source: "gps-track",
        paint: { "line-color": "#9aa4b2", "line-width": 3 },
      });

      const segmentFeatures = data.segments
        .map((segment) => segment.geoJson)
        .filter((feature) => feature.geometry !== null);
      map.addSource("segments", {
        type: "geojson",
        data: { type: "FeatureCollection", features: segmentFeatures },
      });
      map.addLayer({
        id: "segments-line",
        type: "line",
        source: "segments",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-width": 4,
          "line-color": [
            "match", ["get", "matchStatus"],
            "matched", "#248354",
            "partial", "#c08a00",
            "unmatched", "#c43a3a",
            "#526071",
          ],
        },
      });
      map.addLayer({
        id: "segments-point",
        type: "circle",
        source: "segments",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match", ["get", "matchStatus"],
            "matched", "#248354",
            "partial", "#c08a00",
            "unmatched", "#c43a3a",
            "#526071",
          ],
        },
      });
      // 可視の線・円は細くクリックしづらいため、当たり判定専用の透明なレイヤーを重ねる。
      map.addLayer({
        id: "segments-line-hitarea",
        type: "line",
        source: "segments",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-width": 20, "line-opacity": 0 },
      });
      map.addLayer({
        id: "segments-point-hitarea",
        type: "circle",
        source: "segments",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 14, "circle-opacity": 0 },
      });

      const bounds = new LngLatBounds();
      let hasPoint = false;
      for (const feature of data.gpsTrack.features) {
        for (const position of geometryCoordinates(feature.geometry)) {
          bounds.extend(position);
          hasPoint = true;
        }
      }
      for (const segment of data.segments) {
        for (const position of geometryCoordinates(segment.geoJson.geometry)) {
          bounds.extend(position);
          hasPoint = true;
        }
      }
      if (hasPoint) {
        map.fitBounds(bounds, { padding: 32, maxZoom: 17, duration: 0 });
      }

      const segmentLayers = ["segments-line-hitarea", "segments-point-hitarea"];
      for (const layerId of segmentLayers) {
        map.on("click", layerId, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const properties = feature.properties as SegmentProperties;
          new Popup({ closeButton: true })
            .setLngLat(event.lngLat)
            .setHTML(
              `<strong>${escapeHtml(properties.trackName)}</strong><br>` +
                `${escapeHtml(properties.artistName)}<br>` +
                `${formatDate(properties.startedAt)} 〜 ${formatDate(properties.estimatedEndedAt)}<br>` +
                `状態: ${escapeHtml(properties.matchStatus)}`,
            )
            .addTo(map);
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    return () => {
      map.remove();
    };
  }, [data]);

  return (
    <>
      {loading && <p className="summary">読み込み中…</p>}
      {error && <p className="error" role="alert"><strong>エラー:</strong> {error}</p>}

      {data && (
        <>
          <section className="status-grid" aria-label="Journey情報">
            <div><strong>開始時刻</strong><span>{formatDate(data.journey.startedAt)}</span></div>
            <div><strong>終了時刻</strong><span>{formatDate(data.journey.endedAt)}</span></div>
            <div><strong>曲区間数</strong><span>{data.segments.length}件</span></div>
          </section>

          {data.segments.length === 0 && (
            <p className="notice">
              結合結果がありません（未結合、または結合結果が0件です）。GPS経路のみ表示しています。
            </p>
          )}
          {data.gpsTrack.features.length === 0 && (
            <p className="notice">表示できるGPSログがありません。</p>
          )}

          <section>
            <div ref={containerRef} className="map-canvas" />
          </section>

          {data.segments.length > 0 && (
            <section>
              <h2>曲区間一覧</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>曲</th>
                      <th>アーティスト</th>
                      <th>開始時刻</th>
                      <th>推定終了時刻</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.segments.map((segment) => (
                      <tr key={segment.joinResultId}>
                        <td>{segment.trackName}</td>
                        <td>{segment.artistName}</td>
                        <td>{formatDate(segment.startedAt)}</td>
                        <td>{formatDate(segment.estimatedEndedAt)}</td>
                        <td>
                          <span className={`status-badge status-${segment.matchStatus}`}>
                            {segment.matchStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
