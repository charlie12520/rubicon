# Godel scraper: breaking-banner-only rewrite (2026-06-12, rev 3)

**Final landing acceptance ID: A199** (this plan was drafted before A196 landed as
the multi-agent guardrail ID; the final merge agent renumbered this Godel work to A199).
This rev supersedes rev 1 (wrongly blamed "must log in") and rev 2 (right
direction, no element id). The user supplied the exact DOM; direction is now
concrete: **scrape ONLY the red breaking banner, poll every 3 s.**

## Location (repo relocated 2026-06-12)

- **Canonical repo is now `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker`**
  (moved from `C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker`; pre-clone
  snapshot kept at `C:\Users\charl\Desktop\Rubicon\_preclone_snapshot_20260612-201138`).
  Every `scripts/…`, `server/…`, `data/…`, `docs/…` path below is relative to this root.
- **`godel-news/` did NOT move** — it stays at `C:\Users\charl\Desktop\AI STUFF\godel-news`
  because the scraper hardcodes `const ROOT = "C:/Users/charl/Desktop/AI STUFF/godel-news"`.
  It is therefore **no longer a repo sibling**: AGENTS.md §5's `../godel-news` is now
  WRONG — refer to it by its absolute path. (Functionally fine; `ROOT` is absolute, so
  archives/lock/log keep landing there regardless of where the repo lives.)
- **Bridge coupling — the move's one real hazard.** `RUBICON_CAPTURE` is
  REPO_ROOT-relative, so the scraper writes the panel file into *whichever repo copy
  launches it* (`<repo>\data\godel-live-news.json`); the live server reads
  `data/godel-live-news.json` relative to *its own* cwd. **The Godel watcher and the
  5174 server must run from the SAME copy**, or the panel silently serves stale rows.
  Before trusting the feed, confirm both Startup entries — "Godel News Watcher" and
  "Rubicon Server" — now launch from the new path. (The currently-running watcher +
  server still serve the OLD path — they started before the move and migrate at the
  next logon/restart once the shortcuts point here.)
- **Out of scope here:** physically relocating `godel-news/` under the Rubicon folder
  (would need the dir moved AND the scraper's `ROOT` updated AND a watcher relaunch).
  Flag if wanted; not done in this plan.

## The target element (confirmed from user-supplied DOM)

```html
<div class="flex items-center justify-center fade-in-animation max-w-full"
     style="gap:6px; color:rgb(234,234,234); background-color:rgb(255,0,0); padding:4px 9px 6px;">
  <div class="truncate" style="font-size:12px;">
    1:41:52 PM | IRNA REPORTED THAT AN IRANIAN FOREIGN MINISTRY SPOKESPERSON SAID …
  </div>
  <div class="cursor-pointer"><span aria-label="close" class="anticon anticon-close">✕</span></div>
</div>
```

Facts that drive the design:
- **It is NOT a table row.** The current scraper only reads `tr[id*="streaming-table"]`
  (the AAPL-bound news table), so it structurally cannot see this. That alone is
  why the market-wide breaking feed never reached Rubicon.
- **Red parent, transparent child.** Background `rgb(255,0,0)` is on the OUTER
  `div.fade-in-animation`; the headline `div.truncate` has no background. This
  explains why the old red-band heuristic produced an empty `breaking.jsonl`:
  `document.elementFromPoint(...)` returns the *innermost* node (the transparent
  `.truncate`), whose computed background is `rgba(0,0,0,0)` — never red. The
  heuristic was sampling the wrong node. (It also looked for `class*="breaking"`,
  which this element doesn't have.)
- **Text is one blob:** `"<time> | <headline>"`, time is **time-of-day only**
  (`1:41:52 PM`), no date, no symbol, no source column.
- **No `id`** on the element → dedup must be content-based.
- **`fade-in-animation`** ⇒ it animates in and is replaced/dismissed (note the ✕
  close button) ⇒ it is **transient**, not a persistent table. This changes the
  liveness model (below).

## Design

### 1. Poll cadence → 3 s
`POLL_MS = 3_000` (was 5_000), per spec.

> **Transience risk + mitigation.** A banner that lives < 3 s between polls would
> be missed. Recommended: attach a page-side `MutationObserver` on the banner's
> container that pushes every banner it sees into an in-page buffer; the 3 s poll
> *drains* that buffer. Cadence stays 3 s (per spec) but no fast flash is dropped.
> If you want strictly the literal "poll every 3 s, read current DOM" with no
> observer, accept the small miss risk — call it out in the plan, don't hide it.

### 2. Scrape ONLY the banner
Replace `scrapeOnce`'s body. Remove entirely:
- the `tr[id*="streaming-table"]` table read (AAPL noise),
- the `[class*="breaking" i]` / `[id*="breaking" i]` scan,
- the `elementFromPoint` red-band sampling.

New extraction (page-side), **capturing ALL matches** (defensive — see §6):
```js
const TIME_PIPE = /^\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*\|\s*(.+)$/i;
const banners = [];
for (const el of document.querySelectorAll('div.truncate')) {
  const m = TIME_PIPE.exec((el.textContent ?? '').replace(/\s+/g, ' ').trim());
  if (!m) continue;
  // confirm it's the red breaking banner, not some other truncated text:
  const parent = el.closest('.fade-in-animation') ?? el.parentElement;
  const bg = parent ? getComputedStyle(parent).backgroundColor : '';
  const c = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  const isRed = c && +c[1] > 200 && +c[2] < 60 && +c[3] < 60;
  banners.push({ timeOfDay: m[1].trim(), headline: m[2].trim(), isRed: !!isRed });
}
return banners;
```
Anchor on the **time-pipe text shape** (robust to Tailwind class churn). **Red is
NOT a filter** — the recon caught a *non-red* ADBE banner (`redBanner=0`) while the
user's Iran banner was red, so banner color varies by severity. Record red /
`.fade-in-animation` ancestor only as an optional `severity` label for the panel;
never gate capture on it, or non-red flashes vanish.

### 3. Parse + timestamp (time-of-day → ISO)
The banner gives only `1:41:52 PM`. Attach the **capture date in this machine's
local tz** (the existing code already treats local tz as authoritative for naive
Godel stamps) → ISO. Handle midnight rollover: if the banner time is far in the
*future* vs now (> ~2 h), treat it as yesterday. `source = "Godel Breaking"`;
no ticker.

### 4. Dedup (no element id)
Key = hash of `headline` (NOT including the seconds-precision time, so the same
banner re-seen across polls isn't re-recorded; but DO include time if identical
headlines legitimately recur). Reuse the FIFO-capped `seen` set. The same banner
persists across many 3 s polls — content dedup prevents 20× duplicate rows.

### 5. Liveness watchdog — REDESIGN (this is a correctness bug under banner-only)
Today: relaunch if `news.length === 0` for 60 polls. **Under banner-only, zero
banners is the NORMAL state** (breaking news is sparse) — the old watchdog would
relaunch every ~3 min forever. Banner presence/recency is NOT a health signal.

New health = **app shell present**: probe a persistent element that exists
whenever the Godel app is loaded and logged-in-or-guest (e.g. the always-present
`tr[id*="streaming-table"]` container, or a stable toolbar/root). Relaunch only
when the shell is absent for N polls (or the title is the CF interstitial).
Banners are payload, never heartbeat.

### 6. "Only one at a time" — confirmed, but don't depend on it
User asserts one banner shows at a time (confirm step below). The scraper
**captures all matches anyway** (the loop above), so 0 / 1 / N all work — a rare
stack can't drop a headline. The assumption is an optimization, not a load-bearing
invariant.

### 7. WS logging — leave as-is
`page.on("websocket")` raw logging is passive (not "polling") and harmless; keep
it. "Poll only this" refers to the DOM poll, which is now banner-only.

### 8. Rubicon bridge + server reader
`writeRubiconCapture()` still emits `{generatedAt, items:[{id,headline,time,
ticker?,source}]}`; `ticker` now omitted, `time` is the ISO from §3, `source =
"Godel Breaking"`. `server/godelLiveNews.ts` maps `time→publishedAt` via
`new Date()` and `headline→title` — ISO parses cleanly, so no server change
needed and **no 5174 restart** (the live server just reads the new file on its
10 s poll). Verify with the existing reader test.

## Confirm step (the "use the headless" check)
**Headless cannot load Godel** — Cloudflare blocks it (see `recon_headless.png`:
the verification wall). The working "invisible" mode is the off-screen *headed*
Edge. So the confirm = a throwaway off-screen recon (separate profile dir, does
NOT touch the running watcher's `godel-news/profile` lock) that, every 3 s for
~90 s, counts `div.truncate` time-pipe matches and red `fade-in-animation`
nodes, logging the max seen.

**Result (recon ran 2026-06-12 ~1:53 PM ET, off-screen throwaway profile):**
- **Max simultaneous banners = 1** → one-at-a-time confirmed.
- Selector caught a live non-AAPL flash: `1:43:18 PM | ADOBE (ADBE.O) SHARES FELL
  10%, HITTING THEIR LOWEST LEVEL SINCE 2018.` → the time-pipe `div.truncate`
  anchor works on the real bottom feed.
- That banner was **NOT red** (`redBanner=0` all run) → red is variable; do not
  gate on it (drove the §2 change above).
- App shell steady at **200 `tr[id*="streaming-table"]` rows** throughout → use
  that presence as the watchdog heartbeat (§5).
- Banners are intermittent: one visible for ~15 s, then ~75 s of none in the
  window — reinforces §1 (don't treat "0 banners" as unhealthy) and §5.

(Script `godel-banner-confirm.tmp.mjs` + `godel-news/recon-profile-banner` were
deleted after the run.)

**One sub-detail to pin at implementation time:** whether the matched `.truncate`
is the transient red pop-up itself or a persistent ticker bar carrying the same
text (the ADBE match had no red ancestor). Doesn't block — the text-pipe anchor +
capture-all + content dedup handle either — but dump the parent chain of a live
match during the build to write the tightest container scope.

## Tests (AGENTS.md §3 — behavior change ⇒ tests)
- Scraper parse unit (extract to a pure fn): time-pipe split, time-of-day→ISO
  date-attach incl. midnight rollover, red-confirm, capture-all, content dedup.
- `server/godelLiveNews.test.ts`: a banner-shaped capture
  (`{id, headline, time:<ISO>, source:"Godel Breaking"}`, no ticker) yields a
  valid `MorningLiveUpdate` (title/publishedAt/author), still passes
  `isValidGodelLiveUpdate`.

## Rollout (no market-feed risk)
This touches only the **Godel watcher**, never the 5174 server / TWS / feeds:
1. Land code on the current branch (`git branch --show-current` first; stage only
   scraper + test files).
2. `npm run typecheck && npm run test` (narrow first), then `validate:mvp` if no
   other agent is building.
3. Restart the watcher to pick up the change: stop the pid in
   `C:\Users\charl\Desktop\AI STUFF\godel-news\watcher.lock.json` (`Stop-Process`),
   close its off-screen Edge if it lingers, relaunch via the Startup shortcut
   "Godel News Watcher" /
   `wscript "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\scripts\godel-news-watcher.vbs"`.
   **First confirm that shortcut (and the 5174 server) now point at the new repo**
   (see Location — same-copy coupling), then confirm `watcher.log` shows the new
   build and `NEWS`/banner lines.
4. WORKLOG entry under `## Last Completed Change`, opening with `A199`.

## Acceptance (A199)
- A red breaking banner visible on Godel (like the 1:41 PM Iran line) lands in
  `data/godel-live-news.json` within ~1 poll, `source:"Godel Breaking"`, ISO time,
  no AAPL.
- `breaking.jsonl` (or its successor) receives the banner — the empty-since-go-live
  bug is fixed.
- A quiet period with zero banners does NOT trigger a relaunch (watchdog redesign);
  the watcher stays up. Induced shell-loss DOES relaunch.
- Same banner across many polls = exactly one recorded row (content dedup).
- `npm run validate:mvp` green; live panel shows the breaking flash within ~10 s.

## Reference facts
- Old red-band miss root cause: `elementFromPoint` returns the transparent inner
  `.truncate`, not the red `.fade-in-animation` parent.
- Watcher start chain: Startup `Godel News Watcher.lnk` →
  `scripts/godel-news-watcher.vbs` (WMI SW_HIDE) → node scraper; single-instance
  via `godel-news/watcher.lock.json`.
- Headless is CF-blocked for Godel; off-screen headed Edge is the only route.
- Relocation 2026-06-12: repo now `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker`;
  `godel-news/` stays absolute at `C:\Users\charl\Desktop\AI STUFF\godel-news` (scraper
  `ROOT`) and is no longer a repo sibling; scraper + 5174 server must share one repo copy
  because the bridge file (`RUBICON_CAPTURE`) is repo-relative.
