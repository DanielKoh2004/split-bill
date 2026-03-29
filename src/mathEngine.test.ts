import { describe, it, expect } from "vitest";
import {
  calculateSplit,
  ReconciliationError,
  type Receipt,
  type UserClaim,
} from "./mathEngine";

// ─────────────────────────────────────────────────────────────
// Helper: quickly build a Receipt from items + tax/service
// ─────────────────────────────────────────────────────────────

function makeReceipt(
  items: { id: string; name: string; priceInCents: number }[],
  taxInCents: number,
  serviceChargeInCents: number,
): Receipt {
  const subtotalInCents = items.reduce((s, i) => s + i.priceInCents, 0);
  return {
    items,
    subtotalInCents,
    taxInCents,
    serviceChargeInCents,
    grandTotalInCents: subtotalInCents + taxInCents + serviceChargeInCents,
  };
}

// ═════════════════════════════════════════════════════════════
// TEST SUITE
// ═════════════════════════════════════════════════════════════

describe("calculateSplit — Core Math Engine", () => {
  // ─────────────────────────────────────────────────────────
  // 1. The Solo Spender
  //    One user buys an expensive item, another buys a cheap item.
  //    Tax and service charge must scale proportionally.
  // ─────────────────────────────────────────────────────────
  describe("Solo Spender — proportional tax/tip scaling", () => {
    it("allocates tax & service proportionally, not equally", () => {
      const receipt = makeReceipt(
        [
          { id: "i1", name: "Wagyu Steak", priceInCents: 9000 }, // RM 90
          { id: "i2", name: "Teh Tarik", priceInCents: 1000 },  // RM 10
        ],
        1000, // tax = RM 10
        500,  // service = RM 5
      );
      // subtotal = 10000, tax = 1000, service = 500, grand = 11500

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 },
        { userId: "bob", itemId: "i2", fraction: 1 },
      ];

      const result = calculateSplit(receipt, claims);

      // Alice's weight = 9000/10000 = 0.9
      // Bob's weight   = 1000/10000 = 0.1
      // Alice tax = floor(9000*1000/10000) = 900, Bob tax = floor(1000*1000/10000) = 100 → sum=1000 ✓
      // Alice svc = floor(9000*500/10000)  = 450, Bob svc = floor(1000*500/10000)  = 50  → sum=500  ✓
      expect(result["alice"]).toBe(9000 + 900 + 450); // 10350
      expect(result["bob"]).toBe(1000 + 100 + 50);    // 1150
      expect(result["alice"] + result["bob"]).toBe(receipt.grandTotalInCents);
    });

    it("distributes stray tax/service cents to highest spender first", () => {
      const receipt = makeReceipt(
        [
          { id: "i1", name: "Nasi Lemak Set", priceInCents: 700 },
          { id: "i2", name: "Air Sirap", priceInCents: 300 },
        ],
        100, // tax = RM 1
        50,  // service = RM 0.50
      );
      // subtotal = 1000, grand = 1150

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 },
        { userId: "bob", itemId: "i2", fraction: 1 },
      ];

      const result = calculateSplit(receipt, claims);

      // Alice tax = floor(700*100/1000) = 70, Bob tax = floor(300*100/1000) = 30 → sum=100 ✓
      // Alice svc = floor(700*50/1000)  = 35, Bob svc = floor(300*50/1000)  = 15 → sum=50  ✓
      expect(result["alice"]).toBe(700 + 70 + 35);  // 805
      expect(result["bob"]).toBe(300 + 30 + 15);    // 345
      expect(result["alice"] + result["bob"]).toBe(receipt.grandTotalInCents);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2. The Messy Split
  //    3 users split an item costing 1000 sen evenly.
  //    1000 / 3 = 333 R 1 → must be 334, 333, 333 (no cent lost)
  // ─────────────────────────────────────────────────────────
  describe("Messy Split — indivisible penny distribution", () => {
    it("distributes 1000 sen among 3 as 334 + 333 + 333", () => {
      const receipt = makeReceipt(
        [{ id: "i1", name: "Sharing Platter", priceInCents: 1000 }],
        0,
        0,
      );
      // subtotal = 1000, grand = 1000 (no tax/service)

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 / 3 },
        { userId: "bob", itemId: "i1", fraction: 1 / 3 },
        { userId: "charlie", itemId: "i1", fraction: 1 / 3 },
      ];

      const result = calculateSplit(receipt, claims);

      const values = Object.values(result).sort((a, b) => b - a);
      expect(values).toEqual([334, 333, 333]);
      expect(values.reduce((a, b) => a + b, 0)).toBe(1000);
    });

    it("distributes 100 sen among 3 as 34 + 33 + 33", () => {
      const receipt = makeReceipt(
        [{ id: "i1", name: "Kuih", priceInCents: 100 }],
        0,
        0,
      );

      const claims: UserClaim[] = [
        { userId: "u1", itemId: "i1", fraction: 1 / 3 },
        { userId: "u2", itemId: "i1", fraction: 1 / 3 },
        { userId: "u3", itemId: "i1", fraction: 1 / 3 },
      ];

      const result = calculateSplit(receipt, claims);

      const values = Object.values(result).sort((a, b) => b - a);
      expect(values).toEqual([34, 33, 33]);
      expect(values.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("handles 2-way split with remainder", () => {
      const receipt = makeReceipt(
        [{ id: "i1", name: "Roti Canai", priceInCents: 501 }],
        0,
        0,
      );

      const claims: UserClaim[] = [
        { userId: "u1", itemId: "i1", fraction: 0.5 },
        { userId: "u2", itemId: "i1", fraction: 0.5 },
      ];

      const result = calculateSplit(receipt, claims);

      const values = Object.values(result).sort((a, b) => b - a);
      expect(values).toEqual([251, 250]);
      expect(values.reduce((a, b) => a + b, 0)).toBe(501);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 3. Overlapping Claims
  //    User A → Item 1 solo
  //    User B → Item 2 solo
  //    Users A, B, C → share Item 3
  // ─────────────────────────────────────────────────────────
  describe("Overlapping Claims — mixed solo and shared items", () => {
    it("correctly composes solo + shared items with tax", () => {
      const receipt = makeReceipt(
        [
          { id: "i1", name: "Chicken Rice", priceInCents: 1200 },
          { id: "i2", name: "Laksa", priceInCents: 1500 },
          { id: "i3", name: "Shared Appetizer", priceInCents: 900 },
        ],
        360, // tax (10% of 3600)
        180, // service (5% of 3600)
      );
      // subtotal = 3600, grand = 4140

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 },
        { userId: "bob", itemId: "i2", fraction: 1 },
        { userId: "alice", itemId: "i3", fraction: 1 / 3 },
        { userId: "bob", itemId: "i3", fraction: 1 / 3 },
        { userId: "charlie", itemId: "i3", fraction: 1 / 3 },
      ];

      const result = calculateSplit(receipt, claims);

      // Item 3: 900 / 3 = 300 each, remainder 0
      // Alice subtotal:   1200 + 300 = 1500
      // Bob subtotal:     1500 + 300 = 1800
      // Charlie subtotal: 0    + 300 = 300
      // Total subtotal: 3600 ✓

      // Tax (360): alice = floor(1500*360/3600) = 150
      //            bob   = floor(1800*360/3600) = 180
      //            charlie = floor(300*360/3600) = 30
      //            sum = 360 ✓

      // Service (180): alice   = floor(1500*180/3600) = 75
      //                bob     = floor(1800*180/3600) = 90
      //                charlie = floor(300*180/3600)  = 15
      //                sum = 180 ✓

      expect(result["alice"]).toBe(1500 + 150 + 75);     // 1725
      expect(result["bob"]).toBe(1800 + 180 + 90);       // 2070
      expect(result["charlie"]).toBe(300 + 30 + 15);     // 345

      expect(
        result["alice"] + result["bob"] + result["charlie"],
      ).toBe(receipt.grandTotalInCents);
    });

    it("handles shared item with indivisible price + tax remainders", () => {
      const receipt = makeReceipt(
        [
          { id: "i1", name: "Satay", priceInCents: 500 },
          { id: "i2", name: "Rendang", priceInCents: 800 },
          { id: "i3", name: "Mixed Platter", priceInCents: 1000 },
        ],
        230, // tax
        115, // service
      );
      // subtotal = 2300, grand = 2645

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 },
        { userId: "bob", itemId: "i2", fraction: 1 },
        { userId: "alice", itemId: "i3", fraction: 1 / 3 },
        { userId: "bob", itemId: "i3", fraction: 1 / 3 },
        { userId: "charlie", itemId: "i3", fraction: 1 / 3 },
      ];

      const result = calculateSplit(receipt, claims);

      // Item 3: 1000/3 = 333 R 1
      // After base: alice has 500+333=833, bob has 800+333=1133, charlie has 333
      // Remainder (1 cent) → sorted by subtotal desc: bob(1133) > alice(833) > charlie(333)
      // → bob gets +1 → bob = 1134
      // Final subtotals: alice=833, bob=1134, charlie=333, sum=2300 ✓

      // Tax (230):
      //   alice   = floor(833*230/2300)  = floor(83.3)  = 83
      //   bob     = floor(1134*230/2300) = floor(113.4) = 113
      //   charlie = floor(333*230/2300)  = floor(33.3)  = 33
      //   sum = 229, remainder = 1 → goes to bob (highest)
      //   Final: alice=83, bob=114, charlie=33 → sum=230 ✓

      // Service (115):
      //   alice   = floor(833*115/2300)  = floor(41.65) = 41
      //   bob     = floor(1134*115/2300) = floor(56.7)  = 56
      //   charlie = floor(333*115/2300)  = floor(16.65) = 16
      //   sum = 113, remainder = 2 → bob(+1)=57, alice(+1)=42
      //   Final: alice=42, bob=57, charlie=16 → sum=115 ✓

      expect(result["alice"]).toBe(833 + 83 + 42);     // 958
      expect(result["bob"]).toBe(1134 + 114 + 57);     // 1305
      expect(result["charlie"]).toBe(333 + 33 + 16);   // 382

      expect(
        result["alice"] + result["bob"] + result["charlie"],
      ).toBe(receipt.grandTotalInCents);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 4. Validation Failure
  //    subtotal + tax + service ≠ grandTotal → ReconciliationError
  // ─────────────────────────────────────────────────────────
  describe("Validation Failure — inconsistent receipt", () => {
    it("throws ReconciliationError when receipt totals don't add up", () => {
      const badReceipt: Receipt = {
        items: [{ id: "i1", name: "Mee Goreng", priceInCents: 800 }],
        subtotalInCents: 800,
        taxInCents: 80,
        serviceChargeInCents: 40,
        grandTotalInCents: 999, // should be 920
      };

      const claims: UserClaim[] = [
        { userId: "alice", itemId: "i1", fraction: 1 },
      ];

      expect(() => calculateSplit(badReceipt, claims)).toThrow(
        ReconciliationError,
      );
    });

    it("provides expected vs actual in the error", () => {
      const badReceipt: Receipt = {
        items: [{ id: "i1", name: "Roti Canai", priceInCents: 250 }],
        subtotalInCents: 250,
        taxInCents: 25,
        serviceChargeInCents: 13,
        grandTotalInCents: 300, // should be 288
      };

      const claims: UserClaim[] = [
        { userId: "bob", itemId: "i1", fraction: 1 },
      ];

      try {
        calculateSplit(badReceipt, claims);
        expect.fail("Should have thrown ReconciliationError");
      } catch (e) {
        expect(e).toBeInstanceOf(ReconciliationError);
        const err = e as ReconciliationError;
        expect(err.expected).toBe(300);
        expect(err.actual).toBe(288);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // 5. Edge Cases
  // ─────────────────────────────────────────────────────────
  describe("Edge Cases", () => {
    it("handles a single user claiming everything", () => {
      const receipt = makeReceipt(
        [
          { id: "i1", name: "Item A", priceInCents: 5000 },
          { id: "i2", name: "Item B", priceInCents: 3000 },
        ],
        800,
        400,
      );

      const claims: UserClaim[] = [
        { userId: "solo", itemId: "i1", fraction: 1 },
        { userId: "solo", itemId: "i2", fraction: 1 },
      ];

      const result = calculateSplit(receipt, claims);
      expect(result["solo"]).toBe(receipt.grandTotalInCents);
    });

    it("handles zero tax and zero service charge", () => {
      const receipt = makeReceipt(
        [{ id: "i1", name: "Item", priceInCents: 750 }],
        0,
        0,
      );

      const claims: UserClaim[] = [
        { userId: "u1", itemId: "i1", fraction: 0.5 },
        { userId: "u2", itemId: "i1", fraction: 0.5 },
      ];

      const result = calculateSplit(receipt, claims);
      expect(result["u1"] + result["u2"]).toBe(750);
    });

    it("throws when an item in claims is not found in the receipt", () => {
      const receipt = makeReceipt(
        [{ id: "i1", name: "Exists", priceInCents: 500 }],
        0,
        0,
      );

      const claims: UserClaim[] = [
        { userId: "u1", itemId: "i_missing", fraction: 1 },
      ];

      expect(() => calculateSplit(receipt, claims)).toThrow(
        'Item "i_missing" not found in receipt items',
      );
    });
  });
});
