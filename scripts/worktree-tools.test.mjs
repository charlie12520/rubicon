import path from "node:path";
import { describe, expect, it } from "vitest";
import { branchNameForAgent, defaultAiStuffRoot, defaultWorktreeRoot, directoryNameForBranch, slugify, worktreePathForBranch } from "./worktree-tools.mjs";

describe("worktree tools", () => {
  it("builds stable branch and directory names", () => {
    const branch = branchNameForAgent("A196", "Multi Agent Safety!");
    expect(branch).toBe("agent/A196-multi-agent-safety");
    expect(directoryNameForBranch(branch)).toBe("agent-A196-multi-agent-safety");
    expect(slugify("  replay volume freshness  ")).toBe("replay-volume-freshness");
  });

  it("places worktrees in the sibling rubicon-worktrees folder", () => {
    const aiStuff = path.join("C:", "Users", "charl", "Desktop", "AI STUFF");
    expect(defaultAiStuffRoot(path.join(aiStuff, "spx-spread-replay-tracker"))).toBe(aiStuff);
    expect(defaultAiStuffRoot(path.join(aiStuff, "rubicon-worktrees", "agent-A196"))).toBe(aiStuff);
    expect(defaultWorktreeRoot(path.join(aiStuff, "spx-spread-replay-tracker"), {})).toBe(path.join(aiStuff, "rubicon-worktrees"));
    expect(worktreePathForBranch(path.join(aiStuff, "rubicon-worktrees"), "agent/A196-demo")).toBe(
      path.join(aiStuff, "rubicon-worktrees", "agent-A196-demo"),
    );
  });
});
