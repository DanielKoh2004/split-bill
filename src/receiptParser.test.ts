import { describe, it, expect } from "vitest";
import {
  validateParsedReceipt,
  MathReconciliationError,
  ParsedReceiptSchema,
  type ParsedReceipt,
} from "./receiptParser";

// ═════════════════════════════════════════════════════════════
// Helper: build a valid receipt
// priceInCents = total line price (unit × qty, already computed)
// ═════════════════════════════════════════════════════════════

function makeValidReceipt(
  overrides: Partial<ParsedReceipt> = {},
): ParsedReceipt {
  return {
    merchantName: "Restoran Selera Kampung",
    date: "2026-03-29",
    items: [
      { name: "Nasi Lemak Special", quantity: 2, priceInCents: 2400 }, // 1200 × 2
      { name: "Teh Tarik", quantity: 3, priceInCents: 1050 },          // 350 × 3
      { name: "Roti Canai", quantity: 1, priceInCents: 250 },
    ],
    // subtotal = 2400 + 1050 + 250 = 3700
    subtotalInCents: 3700,
    taxInCents: 370,          // 10%
    serviceChargeInCents: 185, // 5%
    grandTotalInCents: 4255,   // 3700 + 370 + 185
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════
// Zod Schema Validation Tests
// ═════════════════════════════════════════════════════════════

describe("ParsedReceiptSchema — Zod type enforcement", () => {
  it("accepts a valid receipt", () => {
    const receipt = makeValidReceipt();
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("rejects missing merchantName", () => {
    const { merchantName, ...noName } = makeValidReceipt();
    const result = ParsedReceiptSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid date format", () => {
    const receipt = makeValidReceipt({ date: "29/03/2026" });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(false);
  });

  it("rejects empty items array", () => {
    const receipt = makeValidReceipt({ items: [] as any });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(false);
  });

  it("rejects floating-point priceInCents", () => {
    const receipt = makeValidReceipt({
      items: [{ name: "Bad Item", quantity: 1, priceInCents: 15.50 }],
    });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const receipt = makeValidReceipt({
      items: [{ name: "Negative", quantity: -1, priceInCents: 500 }],
    });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(false);
  });

  it("rejects floating-point grandTotalInCents", () => {
    const receipt = makeValidReceipt({ grandTotalInCents: 42.55 as any });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(false);
  });

  it("accepts negative priceInCents for discounts", () => {
    const receipt = makeValidReceipt({
      items: [
        { name: "Item", quantity: 1, priceInCents: 1000 },
        { name: "Discount", quantity: 1, priceInCents: -200 },
      ],
      subtotalInCents: 800,
      grandTotalInCents: 800 + 370 + 185,
    });
    const result = ParsedReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// validateParsedReceipt — Math Reconciliation Gate
// ═════════════════════════════════════════════════════════════

describe("validateParsedReceipt — mathematical reconciliation gate", () => {
  // ── Happy Path ────────────────────────────────────────────

  it("passes validation for a perfectly balanced receipt", () => {
    const receipt = makeValidReceipt();
    expect(() => validateParsedReceipt(receipt)).not.toThrow();
  });

  it("passes with zero tax and zero service charge", () => {
    const receipt = makeValidReceipt({
      taxInCents: 0,
      serviceChargeInCents: 0,
      grandTotalInCents: 3700,
    });
    expect(() => validateParsedReceipt(receipt)).not.toThrow();
  });

  it("passes with single item, quantity = 1", () => {
    const receipt: ParsedReceipt = {
      merchantName: "Test",
      date: "2026-01-01",
      items: [{ name: "Solo Item", quantity: 1, priceInCents: 5000 }],
      subtotalInCents: 5000,
      taxInCents: 500,
      serviceChargeInCents: 250,
      grandTotalInCents: 5750,
    };
    expect(() => validateParsedReceipt(receipt)).not.toThrow();
  });

  it("passes with discount line items (negative priceInCents)", () => {
    const receipt: ParsedReceipt = {
      merchantName: "Discount Store",
      date: "2026-03-29",
      items: [
        { name: "Nasi Goreng", quantity: 1, priceInCents: 1500 },
        { name: "Milo Ais", quantity: 2, priceInCents: 700 },
        { name: "Member Discount", quantity: 1, priceInCents: -500 },
      ],
      // subtotal = 1500 + 700 + (-500) = 1700
      subtotalInCents: 1700,
      taxInCents: 170,
      serviceChargeInCents: 0,
      grandTotalInCents: 1870,
    };
    expect(() => validateParsedReceipt(receipt)).not.toThrow();
  });

  // ── Item Sum vs. Subtotal Failures ────────────────────────

  it("throws ITEM_SUM_VS_SUBTOTAL when item sum exceeds subtotal", () => {
    const receipt = makeValidReceipt({
      subtotalInCents: 3500, // too low — real sum is 3700
    });

    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );

    try {
      validateParsedReceipt(receipt);
    } catch (e) {
      const err = e as MathReconciliationError;
      expect(err.check).toBe("ITEM_SUM_VS_SUBTOTAL");
      expect(err.expected).toBe(3500);
      expect(err.actual).toBe(3700);
    }
  });

  it("throws ITEM_SUM_VS_SUBTOTAL when item sum is below subtotal", () => {
    const receipt = makeValidReceipt({
      subtotalInCents: 4000, // too high — real sum is 3700
    });

    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );
  });

  it("throws when LLM hallucinates an extra item", () => {
    const receipt = makeValidReceipt();
    receipt.items.push({ name: "Ghost Item", quantity: 1, priceInCents: 500 });
    // sum is now 4200, subtotal still says 3700

    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );
  });

  // ── Grand Total Failures ──────────────────────────────────

  it("throws SUBTOTAL_TAX_SERVICE_VS_GRAND when grand total is wrong", () => {
    const receipt = makeValidReceipt({
      grandTotalInCents: 9999,
    });

    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );

    try {
      validateParsedReceipt(receipt);
    } catch (e) {
      const err = e as MathReconciliationError;
      expect(err.check).toBe("SUBTOTAL_TAX_SERVICE_VS_GRAND");
      expect(err.expected).toBe(9999);
      expect(err.actual).toBe(4255);
    }
  });

  it("throws when tax is inflated beyond grand total", () => {
    const receipt = makeValidReceipt({
      taxInCents: 99999,
    });
    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );
  });

  it("catches off-by-one errors (the sneakiest LLM bug)", () => {
    const receipt = makeValidReceipt({
      grandTotalInCents: 4256, // off by 1 sen
    });
    expect(() => validateParsedReceipt(receipt)).toThrow(
      MathReconciliationError,
    );
  });

  // ── Error Object Shape ────────────────────────────────────

  it("MathReconciliationError has correct name and properties", () => {
    const err = new MathReconciliationError("TEST_CHECK", 100, 200);
    expect(err.name).toBe("MathReconciliationError");
    expect(err.check).toBe("TEST_CHECK");
    expect(err.expected).toBe(100);
    expect(err.actual).toBe(200);
    expect(err.message).toContain("off by 100");
  });
});
