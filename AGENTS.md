# AGENTS.md

## Product

We are building Rubicon, a local-first morning intelligence, trade tracker, and replay cockpit for an SPX 0DTE spread trader.

The app may be inspired by common product patterns or named reference products, but it must not copy competitor branding, exact UI, CSS, icons, wording, screenshots, or proprietary assets.

## Core Loop

Trader opens the local app -> app imports AI STUFF/SPX tracker data -> trader reviews today's or a selected range's P/L and position metrics -> trader selects a session/trade -> replay charts advance through the day with scrub/autoplay -> optional wallet size persists locally.

Example shape:

User arrives -> completes the primary action -> app persists useful data -> operator/admin can inspect or act -> user sees the result/status -> the demo proves the loop end to end.

## Always-Read Docs

For normal starts or heartbeats, skim only the top/current portions of:

- WORKLOG.md
- codebase.md
- naive_acceptance.md
- naive_validation.md

Keep this pass lightweight. Read enough to know the current work state, repository/file map, current acceptance ID, latest validation status, relevant commands/URLs, and any known blockers. Use `rg` for a specific acceptance ID, feature name, or failure phrase when deeper history is needed.

Before navigating implementation files, read `codebase.md` as the repository/file map. Use it to find the right module and avoid wasting context by reading the entire codebase or large files end to end. When a mapped file is large, search within it first and then read only the relevant section.

## Read Only When Needed

- Read ACCEPTANCE_CRITERIA.md only when `naive_acceptance.md` is insufficient or historical proof is needed.
- Read VALIDATION.md only when `naive_validation.md` is insufficient, a command is unclear, or historical validation evidence is needed.
- Read HEARTBEAT.md only when changing process/governance or when a heartbeat run is ambiguous.
- Read PRODUCT_SPEC.md only if product behavior is unclear.
- Read DEMO_SCRIPT.md only during demo/e2e validation.
- Read COMPETITOR_BOUNDARIES.md only when changing public UI, copy, naming, or positioning.
- Read DECISIONS.md before making or revising architecture/product decisions.
- Read REVIEW_AND_BLOCKERS.md during review passes or repeated blockers.

## Build Priority

1. Repo audit or minimal scaffold
2. Data model and seed/demo data
3. Primary public/user workflow
4. Required create/read/update actions
5. Operator/admin workflow, if the app needs one
6. Status, history, or result visibility
7. Optional AI/integration fallback layer
8. Tests and demo validation

## Phase Governance

Phase goals are effective only when they force measurable app progress. Early phases may add scaffold, data, and visible surfaces, but later phases must become stricter: they should prove real workflow depth, cross-record effects, persistence, permissions, recovery, scale, and operator clarity.

Do not keep adding panels, modules, or modeled records just to make the app look broader. A future phase should be marked GREEN only when it proves a user or operator can complete a meaningful workflow, see the result, recover from normal failure, and rely on persisted state after reload.

After every run, review the goals themselves before defining the next run. Ask whether the completed goals were too broad, too easy to satisfy with static panels, too focused on breadth, or missing workflow proof. If so, revise the MiniOS and Backlog/task list so the next goals are harder, more workflow-based, and less gameable.

Manual productivity meta-review rule: after any completed phase or goal run, manually score these ten meta-goals in WORKLOG.md before defining the next goals: goal quality, time to stable, rework rate, validation strength, workflow depth, context carryover, tooling leverage, user-visible value, agent productivity metrics, and next-goal improvement. Each score must be Strong, Mixed, or Weak, cite proof, and name one adjustment for the next run.

MiniOS self-edit rule: after each phase/goal review, agents are allowed to revise this MiniOS when the review exposes a better operating rule, stricter goal shape, validation habit, or productivity improvement. Every MiniOS edit must be logged in `MINIOS_CHANGELOG.md` with datetime, changed file, reason, and expected effect before claiming the run is complete.

Production-conversion rule: after a local launch rehearsal is green, future phases must distinguish local proof, sandbox proof, hosted proof, and pilot/customer proof. Do not mark hosted production, connector, security, telemetry, performance, or pilot claims green from modeled local evidence alone.

Hard dependency stop rule: when a selected phase requires an external resource such as hosted data, hosted auth, a connector sandbox, pilot tenant, telemetry source, or deployment account, run a credential/config discovery pass first and record only names/statuses, never secret values. If the resource is absent, do not build modeled substitutes or mark the phase green; record the blocker in WORKLOG.md and VALIDATION.md, keep task/backlog items non-done, and create an operator input note if the user needs to provide access.

## Non-Goals For MVP

Do not build these until the core loop is green unless the user explicitly makes one of them the core product:

- Billing
- Real email/SMS/push sending
- Enterprise SSO
- Advanced permissions
- Advanced analytics dashboards
- Full third-party integrations
- Complex import/export flows
- Pixel-perfect polish

Stubs are acceptable when they clarify future direction.

## Engineering Behavior

- Reuse the existing stack.
- Do not rewrite broad architecture unless WORKLOG.md identifies it as the current blocker.
- Preserve existing user changes.
- Prefer small, reviewable patches.
- Every meaningful change must map to one acceptance criterion.
- After each run, perform a meta-review of whether the goals improved app reality or merely added surfaces; write the lesson into the next goal set.
- For completed phases, include the manual ten-point productivity meta-review before claiming the next goals are ready.
- If the review suggests a better operating rule, update the relevant MiniOS docs and record the datetime/reason in `MINIOS_CHANGELOG.md`.
- Add or update tests when behavior changes.
- Run the narrowest relevant validation first.
- Update WORKLOG.md after each meaningful change.
- If a task takes more than five minutes, include a short completion note naming what took very long or cost an unreasonable amount of tokens, plus any obvious optimization for the next run. For tasks under five minutes, skip this note.

## Done Means

The app runs locally, seed/demo data works, the core demo flow works, acceptance criteria are green or explicitly marked deferred, and tests/checks pass or documented failures are actionable.
