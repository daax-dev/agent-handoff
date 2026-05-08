import { describe, test, expect } from "./test-compat.js";
import {
  evaluateDodCriteria,
  buildAcceptance,
  buildRejection,
  createProposal,
  executeHandshake,
  proposeHandoffWithTimeout,
  type HandoffProposal,
  type HandoffResponse,
  type HandoffRejection,
} from "../src/a2a/handshake.js";

// ---------------------------------------------------------------------------
// evaluateDodCriteria
// ---------------------------------------------------------------------------
describe("evaluateDodCriteria", () => {
  test("returns empty array when all required criteria are met", () => {
    const criteria = [
      { id: "tests_pass", description: "All tests pass", required: true },
      { id: "type_check", description: "TypeScript compiles", required: true },
    ];
    const unmet = evaluateDodCriteria(criteria, ["tests_pass", "type_check", "lint"]);
    expect(unmet).toEqual([]);
  });

  test("returns unmet required criteria ids", () => {
    const criteria = [
      { id: "tests_pass", description: "Tests pass", required: true },
      { id: "deploy_ready", description: "Deployable", required: true },
    ];
    const unmet = evaluateDodCriteria(criteria, ["tests_pass"]);
    expect(unmet).toEqual(["deploy_ready"]);
  });

  test("ignores advisory (required:false) criteria when unmet", () => {
    const criteria = [
      { id: "tests_pass", description: "Tests pass", required: true },
      { id: "perf_check", description: "Performance advisory", required: false },
    ];
    const unmet = evaluateDodCriteria(criteria, ["tests_pass"]);
    expect(unmet).toEqual([]); // perf_check is advisory, so not blocking
  });

  test("returns all ids when capabilities are empty", () => {
    const criteria = [
      { id: "a", description: "A", required: true },
      { id: "b", description: "B", required: true },
    ];
    const unmet = evaluateDodCriteria(criteria, []);
    expect(unmet).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// buildAcceptance / buildRejection
// ---------------------------------------------------------------------------
describe("buildAcceptance and buildRejection", () => {
  test("buildAcceptance includes all criteria ids", () => {
    const proposal = createProposal({
      senderJobId: "hnd_test1",
      prompt: "do the thing",
      dodCriteria: [
        { id: "tests_pass", description: "Tests", required: true },
        { id: "lint", description: "Lint", required: false },
      ],
    });
    const ack = buildAcceptance(proposal, "hnd_receiver1");
    expect(ack.accepted).toBe(true);
    expect(ack.receiverJobId).toBe("hnd_receiver1");
    expect(ack.acceptedCriteria).toEqual(["tests_pass", "lint"]);
    expect(ack.acknowledgedAt).toBeTruthy();
  });

  test("buildRejection includes reason and detail", () => {
    const rej = buildRejection("CAPABILITY_MISMATCH", "Missing deploy_ready capability");
    expect(rej.accepted).toBe(false);
    expect(rej.reason).toBe("CAPABILITY_MISMATCH");
    expect(rej.detail).toBe("Missing deploy_ready capability");
    expect(rej.rejectedAt).toBeTruthy();
  });

  test("buildRejection works without detail", () => {
    const rej = buildRejection("ACK_TIMEOUT");
    expect(rej.accepted).toBe(false);
    expect(rej.detail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createProposal
// ---------------------------------------------------------------------------
describe("createProposal", () => {
  test("sets version and proposedAt automatically", () => {
    const proposal = createProposal({
      senderJobId: "hnd_sender1",
      prompt: "implement feature X",
      dodCriteria: [{ id: "tests_pass", description: "Tests pass", required: true }],
    });
    expect(proposal.version).toBe("1");
    expect(proposal.proposedAt).toBeTruthy();
    expect(proposal.senderJobId).toBe("hnd_sender1");
  });
});

// ---------------------------------------------------------------------------
// executeHandshake
// ---------------------------------------------------------------------------
describe("executeHandshake", () => {
  test("returns acceptance when all required criteria are met", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_s1",
      prompt: "task A",
      dodCriteria: [
        { id: "tests_pass", description: "Tests", required: true },
      ],
    });

    const response = await executeHandshake(proposal, ["tests_pass"], "hnd_r1");
    expect(response.accepted).toBe(true);
    if (response.accepted) {
      expect(response.acceptedCriteria).toContain("tests_pass");
      expect(response.receiverJobId).toBe("hnd_r1");
    }
  });

  test("returns rejection when required criteria are not met", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_s2",
      prompt: "task B",
      dodCriteria: [
        { id: "deploy_ready", description: "Can deploy", required: true },
      ],
    });

    const response = await executeHandshake(proposal, ["tests_pass"]); // deploy_ready missing
    expect(response.accepted).toBe(false);
    if (!response.accepted) {
      expect(response.reason).toBe("CAPABILITY_MISMATCH");
      expect(response.detail).toContain("deploy_ready");
    }
  });

  test("returns rejection for malformed proposal", async () => {
    const bad = { version: "1", prompt: "missing fields" } as unknown as HandoffProposal;
    const response = await executeHandshake(bad, []);
    expect(response.accepted).toBe(false);
    if (!response.accepted) {
      expect(response.reason).toBe("MALFORMED_PROPOSAL");
    }
  });

  test("accepts when no required criteria (all advisory)", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_s3",
      prompt: "task C",
      dodCriteria: [
        { id: "perf_check", description: "Performance", required: false },
      ],
    });

    const response = await executeHandshake(proposal, []); // no capabilities but criteria are advisory
    expect(response.accepted).toBe(true);
  });

  test("accepts with empty DoD criteria list", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_s4",
      prompt: "task D",
      dodCriteria: [],
    });

    const response = await executeHandshake(proposal, []);
    expect(response.accepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// proposeHandoffWithTimeout
// ---------------------------------------------------------------------------
describe("proposeHandoffWithTimeout", () => {
  test("returns acceptance when handler resolves quickly", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_timeout_test",
      prompt: "quick task",
      dodCriteria: [],
    });

    const handler = async (_p: HandoffProposal): Promise<HandoffResponse> =>
      buildAcceptance(_p);

    const response = await proposeHandoffWithTimeout(proposal, handler);
    expect(response.accepted).toBe(true);
  });

  test("returns ACK_TIMEOUT rejection when handler is too slow", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_timeout_test",
      prompt: "slow task",
      dodCriteria: [],
    });

    const slowHandler = async (_p: HandoffProposal): Promise<HandoffResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return buildAcceptance(_p);
    };

    // Inject a 50 ms timeout so the test doesn't take 30 seconds
    const result = await proposeHandoffWithTimeout(proposal, slowHandler, 50);
    expect(result.accepted).toBe(false);
    expect((result as HandoffRejection).reason).toBe("ACK_TIMEOUT");
    expect((result as HandoffRejection).detail).toContain("ms");
  });

  test("propagates non-timeout errors from handler", async () => {
    const proposal = createProposal({
      senderJobId: "hnd_err_test",
      prompt: "error task",
      dodCriteria: [],
    });

    const handler = async (_p: HandoffProposal): Promise<HandoffResponse> => {
      throw new Error("unexpected handler failure");
    };

    await expect(proposeHandoffWithTimeout(proposal, handler)).rejects.toThrow(
      "unexpected handler failure",
    );
  });
});
