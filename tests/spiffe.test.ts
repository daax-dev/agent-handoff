import { describe, test, expect } from "./test-compat.js";
import {
  signHandoff,
  verifyHandoff,
  createMockSvid,
  SvidVerificationError,
  type HandoffEnvelope,
} from "../src/auth/spiffe.js";

describe("SPIFFE SVID signing and verification", () => {
  test("sign then verify succeeds with correct trust store", async () => {
    const { svid, privateKey } = createMockSvid("spiffe://example.org/agent/claude");
    const trustStore = new Map([[svid.spiffeId, privateKey]]);

    const payload = JSON.stringify({ task: "test payload" });
    const envelope = signHandoff(payload, svid);

    expect(envelope.version).toBe("1");
    expect(envelope.senderSpiffeId).toBe("spiffe://example.org/agent/claude");
    expect(envelope.signature).toBeTruthy();
    expect(envelope.payload).toBe(payload);

    const recovered = await verifyHandoff(envelope, trustStore);
    expect(recovered).toBe(payload);
  });

  test("verify throws SVID_EXPIRED for expired SVID", async () => {
    const { svid, privateKey } = createMockSvid("spiffe://example.org/agent/codex", -1000); // already expired
    const trustStore = new Map([[svid.spiffeId, privateKey]]);

    const payload = "some payload";
    const envelope = signHandoff(payload, svid);

    await expect(verifyHandoff(envelope, trustStore)).rejects.toMatchObject({
      code: "SVID_EXPIRED",
      name: "SvidVerificationError",
    });
  });

  test("verify throws SVID_UNTRUSTED_ID when spiffeId not in trust store", async () => {
    const { svid } = createMockSvid("spiffe://example.org/agent/unknown");
    const trustStore = new Map<string, string>(); // empty

    const envelope = signHandoff("payload", svid);
    await expect(verifyHandoff(envelope, trustStore)).rejects.toMatchObject({
      code: "SVID_UNTRUSTED_ID",
    });
  });

  test("verify throws SVID_INVALID_SIGNATURE when signature is tampered", async () => {
    const { svid, privateKey } = createMockSvid("spiffe://example.org/agent/tamper");
    const trustStore = new Map([[svid.spiffeId, privateKey]]);

    const envelope = signHandoff("original payload", svid);
    const tampered: HandoffEnvelope = { ...envelope, payload: "tampered payload" };

    await expect(verifyHandoff(tampered, trustStore)).rejects.toMatchObject({
      code: "SVID_INVALID_SIGNATURE",
    });
  });

  test("verify throws SVID_MALFORMED for invalid envelope shape", async () => {
    const trustStore = new Map<string, string>();
    const bad = { version: "1", payload: "x" } as unknown as HandoffEnvelope;

    await expect(verifyHandoff(bad, trustStore)).rejects.toMatchObject({
      code: "SVID_MALFORMED",
    });
  });

  test("verify throws SVID_MALFORMED when svidExpiry is not a valid date", async () => {
    const { svid, privateKey } = createMockSvid("spiffe://example.org/agent/nandate");
    const trustStore = new Map([[svid.spiffeId, privateKey]]);

    const envelope = signHandoff("payload", svid);
    // Overwrite expiry with a non-date string — Date.now() > NaN is false, so
    // without the NaN guard this would silently bypass the expiry check.
    const bad: HandoffEnvelope = { ...envelope, svidExpiry: "not-a-date" };

    await expect(verifyHandoff(bad, trustStore)).rejects.toMatchObject({
      code: "SVID_MALFORMED",
    });
  });

  test("SvidVerificationError.toJSON includes all fields", () => {
    const err = new SvidVerificationError(
      "SVID_EXPIRED",
      "expired",
      "spiffe://example.org/agent/x",
    );
    const json = err.toJSON();
    expect(json.code).toBe("SVID_EXPIRED");
    expect(json.senderSpiffeId).toBe("spiffe://example.org/agent/x");
    expect(json.error).toBe("SvidVerificationError");
  });

  test("different SVID keys produce different signatures", () => {
    const { svid: svid1 } = createMockSvid("spiffe://example.org/a");
    const { svid: svid2 } = createMockSvid("spiffe://example.org/a");

    const payload = "same payload";
    const env1 = signHandoff(payload, svid1);
    const env2 = signHandoff(payload, svid2);

    // Keys are random so signatures should differ
    expect(env1.signature).not.toBe(env2.signature);
  });
});
