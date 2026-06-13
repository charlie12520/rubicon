# Validation Workflow

Use the narrowest proof that can catch the likely failure.

1. Pure logic: run the focused co-located test, usually `npm run test -- path/to/file.test.ts`.
2. Type or cross-file app change: run focused tests plus `npm run typecheck`.
3. Shipped frontend or CSS change: run focused tests if relevant plus `npm run build`.
4. UI behavior or layout change: run tests/build as needed, then browser smoke on a scratch port `5189-5199`.
5. Importer or data-contract change: run focused importer tests plus an API smoke for the affected route.
6. Multi-task merge, shared behavior, unclear risk, or shipped behavior without narrower confidence: run `npm run validate:mvp` if no other build is active.

If validation is missing, blocked, or weaker than the change deserves, record that clearly in the task file and ask before treating the task as merge-ready.

Record only the command, result, blocker if any, and the reason stronger validation was or was not needed. Merge agents record accepted-merge proof in `proof.md`.
