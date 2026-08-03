# Scrobble・位置ログ結合ロジック検証

## 背景

モバイル実機の位置情報検証は、端末からアクセスできるHTTPS環境の準備が必要なため一時保留している。今回は実GPSを待たず、Last.fmの確定Scrobbleとダミー位置ログを時刻で結合し、Recorded Spot候補を作る中核アルゴリズムが成立するかを先に検証する。

検証ページは `/dev/timeline-join-test`。既存の `/dev/lastfm-test`、`/dev/location-test`、`/api/lastfm/recent` はそのまま利用できる。

実GPSログを取得できた後も、各データを `TimelineLocationSample` へ変換し、UI・ブラウザAPI・ネットワークから独立した `joinScrobblesWithLocations()` へ渡す。結合結果はデータベースへ保存せず、ページ上での確認とJSON／CSVダウンロードだけに使う。

## 入力と時刻の扱い

- `TimelineScrobble.playedAt` と `TimelineLocationSample.recordedAt` は確認・出力用のISO 8601文字列とする。
- ソート、比較、区間、中間時刻、許容範囲の計算は `playedAtUnixMs` / `recordedAtUnixMs` のUnixミリ秒だけを使う。
- Last.fm Liveモードでは `nowPlaying=true` を除外し、`playedAtUnix` または有効なISO時刻を持つ確定Scrobbleだけを変換する。APIキーは既存APIルートのサーバー側だけで使う。
- 同じ曲名・アーティストでも、開始時刻とイベントIDが異なれば別イベントとして残す。曲名による重複排除は行わない。
- 入力配列はコピーしてからソートし、呼び出し元の配列を変更しない。
- 画面ではUTCのISO時刻と `Asia/Tokyo` の日本時間を併記する。日本時間へ変換してから計算することはない。

## 結合ルール

### Scrobbleの開始と終了時刻

開始時刻は確定Scrobbleの `playedAtUnixMs` とする。入力順に関係なく開始時刻の昇順へ並べる。同一ミリ秒のScrobbleが複数ある場合は入力競合として検出し、`externalEventKey` などによる決定的な順序で1件だけを残す。

durationがあり次曲もある場合は、`開始 + durationMs + durationToleranceMs` と次曲の開始時刻の早い方を終了時刻にする。duration候補の方が早ければ `duration`、次曲で区切った場合は `duration_and_next_track` とする。durationがあり次曲がなければduration候補をそのまま使う。

durationがなく次曲があり、その間隔が `maxTrackWindowMs` 以下なら次曲の開始を終了時刻として `next_track` とする。間隔が上限を超える場合は空白全体を曲区間にせず、技術検証用の `fallbackDurationMs` を使って `fallback` とする。durationも次曲もない場合も同じフォールバックを使う。フォールバックは `maxTrackWindowMs` を超えないよう制限する。

durationがない結果には `duration_missing`、フォールバックには必ず `fallback_end_used`、長い次曲間隔を無視した場合は `next_track_gap_exceeds_max_window` を警告として残す。

### 曲区間と代表地点

曲区間は、開始を含み終了を含まない半開区間として扱う。

```text
[startedAt, estimatedEndedAt)
```

終了時刻を決めた後、`開始時刻 <= recordedAtUnixMs < 終了時刻` を満たす位置サンプルを抽出する。前曲の終了と次曲の開始が同じ場合、その時刻ちょうどのサンプルは次曲だけに所属する。最後の曲も同じ規則とし、終了時刻と一致する位置を区間内サンプルへ特別に含めない。境界位置の二重利用を防ぐため、終了時刻と完全一致するサンプルは前曲の区間外許容補完にも使用しない。

区間の中間時刻は `開始 + (終了 - 開始) / 2` とする。

区間内サンプルがある場合は、中間時刻との差の絶対値が最小の実サンプル1件を代表地点にする。緯度・経度の平均は使わない。同距離の候補が複数ある場合は、より早い記録時刻を選び、時刻も同じなら位置サンプルIDの昇順で決める。この結果は `inside_segment_midpoint` / `matched` とする。

区間内サンプルがない場合は、開始端より前または終了端より後にある全サンプルから、区間端までの距離が最小のものを探す。距離が `locationEdgeToleranceMs` 以下なら代表地点として `nearest_within_tolerance` / `partial` とし、`no_sample_inside_segment` と `nearest_sample_outside_segment` を付ける。

許容範囲にもサンプルがなければ代表地点を `null`、方法を `none`、状態を `unmatched` とし、`no_sample_inside_segment` と `location_sample_not_found` を付ける。

`accuracyM` は今回の結合対象から除外する条件にしない。代表地点の精度値が暫定閾値を超えた場合だけ `low_location_accuracy` を付け、後から評価できるようにする。

## externalEventKey

Live Last.fmモードでは、APIの返却順や配列indexに依存しない `externalEventKey` を次の要素から生成する。

```text
lastfm:<username>:<playedAtUnixSeconds>:<normalizedArtist>:<normalizedTrack>
```

ユーザー名、アーティスト名、曲名はUnicode NFKC正規化、前後空白除去、連続空白の1文字化、小文字化を行い、区切り文字と衝突しないようURLエンコードする。再生時刻はLast.fmのUnix秒へ揃える。同じユーザー、開始時刻、アーティスト、曲からは、API取得時刻や配列順が変わっても同じキーが得られる。

Fixtureでは `fixture:<fixture-id>` を使用する。Supabase保存フェーズでは、次の組み合わせを一意制約または一意インデックスの候補とする。

```text
user_id, provider, external_event_key
```

## 入力検証

`validateTimelineInputs()` はUIやネットワークへ依存しない純粋関数であり、有効なScrobble、有効な位置サンプル、除外理由を表すissueを返す。`joinScrobblesWithLocations()` もこの検証を内部利用するため、`NaN` などから `toISOString()` が例外を投げて結合全体を停止することはない。理由を表示・保存する呼び出し側は、結合前に同じ検証関数の結果を参照する。

次を結合対象から除外する。

- 非有限またはJavaScriptの日時として表現できないScrobble／位置時刻：`invalid_timestamp`
- `null` 以外で正の有限数でないduration：`invalid_duration`
- 空の曲名／アーティスト名：`empty_track_name` / `empty_artist_name`
- 範囲外または非有限の緯度経度：`invalid_coordinate`
- `null` 以外で0以上の有限数でない精度：`invalid_accuracy`
- 同一開始時刻の2件目以降：`duplicate_start_time`
- 同一位置IDの2件目以降：`duplicate_location_id`

同一開始時刻では `externalEventKey`、ID、メタデータの順で比較し、辞書順で最初の1件を残す。重複位置IDでは記録時刻、座標、精度などの順で1件を残す。どちらも入力順や乱数に依存しない。入力配列そのものは変更しない。

これらは安全に技術検証を続行するための暫定的な除外仕様である。卒業論文で用いる研究データの正式な採用・除外基準は、実GPSログの分布とLast.fmデータの観測後に確定する。

## 検証ケース

| ケース | 目的 | 初期設定での期待結果 |
| --- | --- | --- |
| A：正常な結合 | 3曲と10秒間隔の位置ログから区間内中間地点を選ぶ | 3曲すべて `matched` |
| B：位置サンプル不足 | 2曲目の区間内を空にし、開始10秒前の位置を使う | 2曲目が `partial`、ほかは `matched` |
| C：位置情報なし | Scrobbleだけを入力する | 対象曲が `unmatched` |
| D：同じ曲の連続再生 | 同じ曲・アーティストの開始時刻違いを渡す | 独立した2イベントを出力 |
| E：入力順がバラバラ | 両入力を時系列でない順にする | 内部ソート後、正しい3イベントを出力 |
| F：曲の長さが不明 | durationなしの中間曲と最後の曲を比較する | `next_track` と `fallback` を確認 |
| G：曲間に長い空白 | 次曲まで65分空ける | 1曲目を5分の `fallback` にし、65分全体を含めない |
| H：UTC日付またぎ | UTC 23:59台から翌日へまたぐ | Unixミリ秒基準で中間時刻・代表地点が正しい |

Fixtureは決定論的で、乱数・現在時刻・ネットワークに依存しない。Fixture Aの一部には低精度値も含め、サンプルを除外せず警告だけ付くことも確認する。

## 暫定仕様

次の値はアルゴリズムを比較するための仮の検証値であり、卒業論文の最終研究仕様や本番値ではない。`DEFAULT_TIMELINE_JOIN_CONFIG` に集約し、検証ページから変更して再計算できる。

| 設定 | 初期値 | 用途 |
| --- | ---: | --- |
| `durationToleranceMs` | 30,000 ms | duration候補へ加える猶予 |
| `fallbackDurationMs` | 300,000 ms | 終了根拠がない場合の仮区間 |
| `maxTrackWindowMs` | 1,800,000 ms | 次曲を終了根拠にできる最大間隔 |
| `locationEdgeToleranceMs` | 30,000 ms | 区間外位置を暫定利用できる端からの距離 |
| `lowAccuracyWarningThresholdM` | 100 m | 代表位置へ精度警告を付ける閾値 |

## 出力

JSONには出力時刻、選択ケース、データソース、適用設定、入力Scrobble、入力位置サンプル、validation結果、全結合結果、ステータス集計を含める。

CSVにはイベントID、`external_event_key`、曲・アーティスト、開始・推定終了・中間時刻、終了方法、duration、区間長、区間内サンプル数、代表地点の時刻・緯度・経度・精度・中間時刻との差、位置選択方法、状態、警告を含める。日本語曲名をExcelやGoogle Sheetsへ取り込みやすくするためUTF-8 BOMとCRLFを使う。

## 自動テスト

Node.js 22の標準テストランナーとTypeScript型除去を使い、追加パッケージなしで `pnpm test` を実行する。従来の時系列結合に加え、半開区間、境界サンプルの単一所属、安定キーと文字正規化、不正時刻・duration・座標・精度、空の曲／アーティスト、同一開始時刻、重複位置ID、入力非破壊、Fixture A〜Hの回帰を検証する。

## 今後の検証

- HTTPS環境で取得した実GPSログを `TimelineLocationSample` へ差し替える。
- Supabaseへ入力と結合根拠を保存できるスキーマを設計する。
- `matched` / `partial` をRecorded Spot候補へ変換する条件を決める。
- 複数のRecorded SpotをJourneyへ束ねる時系列・区間ルールへ拡張する。
- iOS／Android、Safari／Chromeでモバイルバックグラウンド制約を再検証する。
