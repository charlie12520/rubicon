const A_ID_PATTERN = /^A(\d+)$/i;

export function parseAcceptanceId(value) {
  const match = String(value ?? "").trim().match(A_ID_PATTERN);
  return match ? Number(match[1]) : null;
}

export function formatAcceptanceId(value) {
  return `A${String(value).padStart(3, "0")}`;
}

export function parseAcceptanceLedger(content) {
  const activeMatch = content.match(/^\s*active_acceptance_id:\s*["']?(A\d+)["']?\s*$/im);
  const tableIds = [...content.matchAll(/^\|\s*(A\d+)\s*\|/gim)].map((match) => match[1].toUpperCase());
  const duplicateIds = [...new Set(tableIds.filter((id, index) => tableIds.indexOf(id) !== index))];
  const numericIds = tableIds.map(parseAcceptanceId).filter((id) => id !== null);
  return {
    activeId: activeMatch?.[1]?.toUpperCase() ?? null,
    activeNumber: parseAcceptanceId(activeMatch?.[1]),
    tableIds,
    duplicateIds,
    maxTableNumber: numericIds.length ? Math.max(...numericIds) : null,
  };
}

export function checkAcceptanceLedger({ stagedContent, headContent = "" }) {
  const staged = parseAcceptanceLedger(stagedContent);
  const head = headContent ? parseAcceptanceLedger(headContent) : null;
  const problems = [];

  if (!staged.activeId) {
    problems.push("naive_acceptance.md is missing active_acceptance_id.");
  }
  if (staged.duplicateIds.length) {
    problems.push(`naive_acceptance.md has duplicate acceptance rows: ${staged.duplicateIds.join(", ")}.`);
  }
  if (staged.activeNumber !== null && staged.maxTableNumber !== null && staged.activeNumber < staged.maxTableNumber) {
    problems.push(
      `active_acceptance_id ${staged.activeId} is lower than current table max ${formatAcceptanceId(staged.maxTableNumber)}.`,
    );
  }
  if ((head?.activeNumber ?? null) !== null && staged.activeNumber !== null && staged.activeNumber < head.activeNumber) {
    problems.push(`active_acceptance_id ${staged.activeId} regresses below HEAD ${head.activeId}.`);
  }

  return { problems, staged, head };
}

export function parseNameStatus(nameStatusText) {
  return nameStatusText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t+/);
      const status = parts[0] ?? "";
      const paths = parts.slice(1);
      return { status, paths };
    });
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

export function isArchiveDocMove(entry) {
  if (!entry.status.startsWith("R") || entry.paths.length < 2) {
    return false;
  }
  const [from, to] = entry.paths.map(normalizePath);
  return /^[^/]+\.md$/i.test(from) && to.startsWith("archive/") && to.toLowerCase().endsWith(".md");
}

export function isSourcePath(filePath) {
  const normalized = normalizePath(filePath);
  return (
    normalized.startsWith("server/") ||
    normalized.startsWith("src/") ||
    normalized.startsWith("shared/") ||
    normalized.startsWith("scripts/") ||
    normalized === "package.json" ||
    normalized === "package-lock.json" ||
    normalized === "vite.config.ts" ||
    normalized.startsWith("tsconfig")
  );
}

export function checkStagedChangeMix(nameStatusText) {
  const entries = parseNameStatus(nameStatusText);
  const archiveMoves = entries.filter(isArchiveDocMove);
  const sourcePaths = entries.flatMap((entry) => entry.paths).filter(isSourcePath);
  if (archiveMoves.length >= 3 && sourcePaths.length > 0) {
    return {
      problems: [
        `Broad archive/doc move (${archiveMoves.length} markdown renames) is mixed with source changes (${[...new Set(sourcePaths)].slice(0, 4).join(", ")}). Split these commits.`,
      ],
      archiveMoves,
      sourcePaths,
    };
  }
  return { problems: [], archiveMoves, sourcePaths };
}

export function checkBranchGuard({ branch, env = process.env }) {
  if (env.RUBICON_LANDING_OVERRIDE === "1" || env.RUBICON_ALLOW_MAIN_COMMIT === "1") {
    return [];
  }
  return branch === "main" ? ["Direct commits/merges on main are blocked. Use scripts/land-agent-branch.mjs."] : [];
}

export function runGitSafetyChecks({ branch, nameStatusText, stagedAcceptanceContent = null, headAcceptanceContent = null, env = process.env }) {
  const isLandingIntegration = env.RUBICON_LANDING_OVERRIDE === "1";
  const problems = [
    ...checkBranchGuard({ branch, env }),
    ...(isLandingIntegration ? [] : checkStagedChangeMix(nameStatusText).problems),
  ];

  if (stagedAcceptanceContent !== null) {
    problems.push(...checkAcceptanceLedger({ stagedContent: stagedAcceptanceContent, headContent: headAcceptanceContent ?? "" }).problems);
  }

  return problems;
}
