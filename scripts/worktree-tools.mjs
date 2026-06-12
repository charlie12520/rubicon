import path from "node:path";

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeAcceptanceId(value) {
  const match = String(value ?? "").trim().toUpperCase().match(/^A(\d+)$/);
  if (!match) {
    throw new Error("Acceptance ID must look like A196.");
  }
  return `A${match[1].padStart(3, "0")}`;
}

export function defaultAiStuffRoot(repoRoot) {
  const resolved = path.resolve(repoRoot);
  const parent = path.dirname(resolved);
  return path.basename(parent).toLowerCase() === "rubicon-worktrees" ? path.dirname(parent) : parent;
}

export function defaultWorktreeRoot(repoRoot, env = process.env) {
  return path.resolve(env.RUBICON_WORKTREE_ROOT ?? path.join(defaultAiStuffRoot(repoRoot), "rubicon-worktrees"));
}

export function branchNameForAgent(id, slug) {
  return `agent/${normalizeAcceptanceId(id)}-${slugify(slug)}`;
}

export function directoryNameForBranch(branchName) {
  return branchName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function worktreePathForBranch(worktreeRoot, branchName) {
  return path.join(path.resolve(worktreeRoot), directoryNameForBranch(branchName));
}

export function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
