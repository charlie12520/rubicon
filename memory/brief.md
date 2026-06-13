# Brief Memory

Copied from `DECISIONS.md`. Keep the original decision blocks intact.

### D018: Godel news comes from an off-screen scraper, replacing the DOM bridge

Decision:
Godel Terminal news is captured by `scripts/godel-news-scraper.mjs` â€” a real headed Edge parked off-screen (Cloudflare blocks all headless and raw-HTTP routes) â€” which writes `data/godel-live-news.json` feeding the existing Morning > Live Updates panel. It auto-starts at logon via a Startup-folder shortcut + windowless VBS launcher with a pid-probed single-instance lock. The earlier minimized-safe DOM-bridge bookmarklet (`server/godelAlertBridge.ts`, its routes, the `GodelBridgeControls` card, and the legacy `capture/scrape-godel-news.mjs` scripts) is fully removed.

Reason:
The manual bookmarklet bridge needed a visible browser tab and surfaced stale chat fragments. The scraper is windowless, restart-safe, and auto-starting, with zero server changes (the reader already merged Godel + FirstSquawk). A real off-screen Edge is required because Cloudflare's managed challenge defeats headless and raw HTTP.

Status:
Accepted (A186-A189 built; bridge removed A190)

## Changelog

| Date | Merge | Notes |
|---|---|---|
