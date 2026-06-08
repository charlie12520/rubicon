# HEARTBEAT.md

## Core Rule

Every heartbeat should read less, change less, and prove more.

## Normal Heartbeat Prompt

```text
Heartbeat:
Read AGENTS.md, codebase.md, WORKLOG.md, naive_acceptance.md, and naive_validation.md.

Context budget:
Read PRODUCT_SPEC.md only if product behavior is unclear.
Read DEMO_SCRIPT.md only during demo/e2e validation.
Read COMPETITOR_BOUNDARIES.md only when changing public UI, copy, naming, or positioning.
Read DECISIONS.md only before making or revising architecture/product decisions.

Before changing code:
1. Inspect git/worktree state and preserve user changes.
2. Identify the current phase and active acceptance ID from WORKLOG.md.
3. Select exactly one RED or YELLOW acceptance criterion from naive_acceptance.md.
4. State the smallest patch that could move that criterion toward GREEN.
5. State the narrowest validation command or artifact that will prove it.
6. For later-phase/breadth work, state the workflow-depth proof: what user/operator action changes state, what related record or module updates, and how persistence/recovery is verified.
7. If the prior run completed a phase or goal set, review the goals themselves: did they force real workflow progress, or should the next goals be stricter?

Execution:
- Make one focused change only.
- Every changed file must support the selected acceptance criterion.
- Do not add unrelated features.
- Do not implement billing, real notifications, advanced permissions, analytics dashboards, import/export, or full integrations before the core MVP loop is GREEN.
- If the work requires a large feature, create the smallest functional slice.
- Do not satisfy later-phase goals with static UI or modeled data alone. Add the smallest workflow that proves the surface is usable.

Validation:
- Run the narrowest relevant check from naive_validation.md.
- If it passes, update the acceptance criterion status and proof.
- If it fails, classify the failure and try one focused fix.
- If the same acceptance criterion or failure class fails twice, stop and document three options in WORKLOG.md instead of continuing blindly.

Update:
- Update WORKLOG.md.
- Update naive_acceptance.md.
- Update DECISIONS.md only if a meaningful product or architecture decision was made.
- After a phase run, record a goal meta-review and revise MiniOS/task-list goals when the previous goals were too broad, too static, or too easy to satisfy without workflow proof.
- Manual phase exit rule: after a completed phase or goal set, score the run in WORKLOG.md against ten productivity meta-goals: goal quality, time to stable, rework rate, validation strength, workflow depth, context carryover, tooling leverage, user-visible value, agent productivity metrics, and next-goal improvement. Do this before defining the next goals.
- MiniOS self-edit rule: when the phase review suggests a better operating rule, update the current MiniOS docs and log the edit in MINIOS_CHANGELOG.md with datetime, changed file, reason, and expected effect.
- Production-conversion rule: after local launch rehearsal proof, keep hosted, connector, security, telemetry, performance, and pilot claims non-green until the selected environment has real proof.
- Hard dependency stop rule: if the selected criterion requires hosted data, auth, a connector sandbox, pilot tenant, telemetry source, or deployment account, discover whether it is actually connected before implementation. If absent, keep the criterion non-green and document the exact operator inputs needed.

Stop when:
- The selected acceptance criterion is GREEN,
- or the same blocker has failed twice,
- or the patch would require a forbidden non-MVP feature,
- or the full core MVP loop is GREEN.
```

## What The Heartbeat Is Trying To Accomplish

1. Prevent drift
2. Force measurable progress
3. Minimize context load
4. Protect user work
5. Create continuity between sessions
6. Separate product vision from execution
7. Prevent false completion
8. Avoid repeated failure loops
9. Preserve originality and scope safety
10. Make the app demoable

## Key Behavior

Every heartbeat must turn one acceptance criterion from RED or YELLOW toward GREEN.

Do not generally improve the app. Improve one measurable part of the MVP loop.

As the app matures, prefer harder workflow criteria over broader-looking surfaces. The best next criterion is usually the one that proves a real user can finish work and trust the resulting state.

After each completed run, improve the goal system itself. The next goals should become more realistic, more workflow-based, and harder to mark GREEN without real app behavior.

For completed phases, the goal-system improvement must include the manual ten-point productivity meta-review, with Strong/Mixed/Weak judgments and next-run adjustments.

MiniOS edits are allowed as part of that improvement loop, but they must be traceable through MINIOS_CHANGELOG.md.
