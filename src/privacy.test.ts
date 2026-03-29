import { describe, it, expect, beforeEach } from "vitest";
import {
  generateSettlementHash,
  registerSession,
  getSession,
  wipeSession,
  activeSessionCount,
  type SessionData,
} from "./privacy";

// ═════════════════════════════════════════════════════════════
// Feature B: Settlement Hash Tests
// ═════════════════════════════════════════════════════════════

describe("generateSettlementHash — SHA-256 zero-knowledge digest", () => {
  const receiptId = "rcpt_001";
  const salt = "random-salt-abc123";
  const userTotals: Record<string, number> = {
    alice: 5000,
    bob: 3000,
    charlie: 2000,
  };

  // ── Determinism ───────────────────────────────────────────

  it("is deterministic: same inputs always produce the same hash", async () => {
    const hash1 = await generateSettlementHash(receiptId, userTotals, salt);
    const hash2 = await generateSettlementHash(receiptId, userTotals, salt);
    const hash3 = await generateSettlementHash(receiptId, userTotals, salt);
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("returns a 64-character lowercase hex string (SHA-256)", async () => {
    const hash = await generateSettlementHash(receiptId, userTotals, salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-independent: differently-ordered keys produce the same hash", async () => {
    const totalsA = { charlie: 2000, alice: 5000, bob: 3000 };
    const totalsB = { bob: 3000, charlie: 2000, alice: 5000 };
    const hashA = await generateSettlementHash(receiptId, totalsA, salt);
    const hashB = await generateSettlementHash(receiptId, totalsB, salt);
    expect(hashA).toBe(hashB);
  });

  // ── Avalanche Effect ──────────────────────────────────────

  it("changes completely when a user total changes by 1 sen", async () => {
    const original = await generateSettlementHash(receiptId, userTotals, salt);
    const altered = await generateSettlementHash(
      receiptId,
      { ...userTotals, alice: 5001 }, // +1 sen
      salt,
    );
    expect(altered).not.toBe(original);
    // Count differing hex characters (avalanche ≈ 50%)
    let diff = 0;
    for (let i = 0; i < 64; i++) {
      if (original[i] !== altered[i]) diff++;
    }
    // At least 20 of 64 hex chars should differ (>30%)
    expect(diff).toBeGreaterThan(20);
  });

  it("changes completely when the salt changes", async () => {
    const hash1 = await generateSettlementHash(receiptId, userTotals, "salt-a");
    const hash2 = await generateSettlementHash(receiptId, userTotals, "salt-b");
    expect(hash1).not.toBe(hash2);
  });

  it("changes completely when the receiptId changes", async () => {
    const hash1 = await generateSettlementHash("rcpt_001", userTotals, salt);
    const hash2 = await generateSettlementHash("rcpt_002", userTotals, salt);
    expect(hash1).not.toBe(hash2);
  });

  it("works with a single user", async () => {
    const hash = await generateSettlementHash("r1", { solo: 10000 }, "s");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("works with large amounts without overflow", async () => {
    const hash = await generateSettlementHash(
      "r1",
      { user: 99999999 }, // RM 999,999.99
      "big-salt",
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═════════════════════════════════════════════════════════════
// Feature C: Ephemeral Session Wipe Tests
// ═════════════════════════════════════════════════════════════

describe("wipeSession — reference deletion for GC", () => {
  const sessionId = "sess_test_001";

  const makeSampleSession = (): SessionData => ({
    receiptJson: {
      items: [
        { id: "i1", name: "Nasi Lemak", priceInCents: 1200 },
        { id: "i2", name: "Teh Tarik", priceInCents: 500 },
      ],
      subtotalInCents: 1700,
      taxInCents: 170,
      grandTotalInCents: 1870,
    },
    userClaims: [
      { userId: "alice", itemId: "i1", fraction: 1 },
      { userId: "bob", itemId: "i2", fraction: 1 },
    ],
    settlementHash: "abc123def456",
  });

  beforeEach(() => {
    // Clean slate for each test
    wipeSession(sessionId);
    wipeSession("sess_other");
  });

  it("returns true when a session exists and is deleted", () => {
    registerSession(sessionId, makeSampleSession());
    expect(wipeSession(sessionId)).toBe(true);
  });

  it("returns false when session does not exist", () => {
    expect(wipeSession("nonexistent")).toBe(false);
  });

  it("removes the session from the store completely", () => {
    registerSession(sessionId, makeSampleSession());
    expect(getSession(sessionId)).toBeDefined();

    wipeSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });

  it("decrements active session count correctly", () => {
    registerSession(sessionId, makeSampleSession());
    registerSession("sess_other", makeSampleSession());

    const before = activeSessionCount();
    wipeSession(sessionId);
    expect(activeSessionCount()).toBe(before - 1);
  });

  it("is idempotent: wiping an already-wiped session returns false", () => {
    registerSession(sessionId, makeSampleSession());
    expect(wipeSession(sessionId)).toBe(true);
    expect(wipeSession(sessionId)).toBe(false);
  });
});
