# Daily niche.co social stats update

Run every morning. Goal: refresh `social.json` in the root of this repo so the Jarvis "niche.co · Social" panel shows the last 7 days.

## 1. Pull data from Metricool
Brand: **Niche.co**, brandId `8014166`, timezone Africa/Johannesburg (+02:00).

Periods (dates in SA time):
- **this week** = the 7 full days ending yesterday (yesterday-6 … yesterday)
- **last week** = the 7 days before that

Call `getAnalyticsDataByMetrics` once per period (or once for the full 14 days and split by the date column) with these metrics, in this order:

| Field | Metric | How to combine over the 7 days |
|---|---|---|
| IGEV01 | Instagram followers | last non-null value |
| IGEV43 | Instagram followers gained | sum |
| IGEV05 | Instagram views | sum |
| IGEV06 | Instagram reach | sum |
| TKEV07 | TikTok followers | last non-null value |
| TKEV08 | TikTok new followers (net) | sum |
| TKEV12 | TikTok video views in period | sum (use null if every day is null) |
| TKEV13 | TikTok account likes (running total) | last non-null value = `totalLikes`; `likesGained` = last non-null minus the last non-null value before the period (0 if none) |

Each returned row is `[metric values in requested order..., "YYYYMMDD"]`. Treat null as "no data".

## 2. Write `social.json`
```json
{
  "updated": "<now, ISO 8601 with +02:00>",
  "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
  "source": "Metricool",
  "tiktok":    { "handle": "niche.co", "followers": 0, "newFollowers": 0, "totalLikes": 0, "likesGained": 0, "views": null, "prev": null },
  "instagram": { "handle": "nicheco.offcial", "followers": 0, "newFollowers": 0, "views": 0, "reach": 0, "prev": null }
}
```
`prev` = the same fields (without handle/prev) for **last week**, or `null` when last week has no data at all (every value null or 0).
Numbers are plain numbers (no strings). Never put sales, money, emails or anything private in this file — the repo is public.

## 3. Publish
Commit only `social.json` to `main` with message `Daily social stats YYYY-MM-DD` and push. Do not change any other file.
If Metricool fails, change nothing and report the error.
