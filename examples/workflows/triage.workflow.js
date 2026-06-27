/**
 * Example agent-handoff workflow: triage → fix → verify.
 *
 * Code-as-orchestrator: every decision below is plain JavaScript. Agent results
 * pass directly between phases and never re-enter a model's context window, so
 * this scales to dozens of sub-agents without the orchestrator degrading.
 *
 * Run it:
 *   agent-handoff workflow run examples/workflows/triage.workflow.js \
 *     --agent claude --arg threshold=100 --budget 200000
 *
 * The default export receives a WorkflowContext:
 *   { agent, parallel, pipeline, phaseLog, budget, args }
 */
export default async function triage({ agent, pipeline, phaseLog, budget, args }) {
  const threshold = typeof args.threshold === "number" ? args.threshold : 1;

  // Phase 1: typed handoff — the schema is the contract between phases.
  phaseLog("Loading unresolved issues");
  const issues = await agent({
    prompt:
      "List unresolved issues. Return ONLY a JSON array of " +
      '{ "issueId": string, "title": string, "userCount": number }.',
    schema: { issueId: "string", title: "string", userCount: "number" },
    array: true,
  });

  // Plain-JS filtering and early exit — no LLM decision-making, no token tax.
  const bigIssues = issues.filter((i) => i.userCount >= threshold);
  if (bigIssues.length === 0) {
    return { fixed: 0, message: `No issues at or above threshold ${threshold}` };
  }

  // Phase 2: pipeline — each issue streams through fix → verify independently.
  phaseLog(`Fixing ${bigIssues.length} issue(s) above threshold`, { count: bigIssues.length });
  const verified = await pipeline(bigIssues, [
    (issue) => agent({ prompt: `Investigate and fix ${issue.issueId}: ${issue.title}` }),
    (fix, issue) => agent({ prompt: `Verify the fix for ${issue.issueId} is real:\n${fix}` }),
  ]);

  return {
    fixed: verified.length,
    threshold,
    tokensRemaining: budget.remaining,
  };
}
