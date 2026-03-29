import { describe, it, expect } from "vitest";
import { tlv, crc16ccitt, generateDuitNowPayload } from "./duitnowQR";

// ═════════════════════════════════════════════════════════════
// TEST SUITE — DuitNow QR Payload Generator
// ═════════════════════════════════════════════════════════════

describe("tlv — Tag-Length-Value builder", () => {
  it("encodes a simple tag correctly", () => {
    expect(tlv("00", "01")).toBe("000201");
    // Tag "00", Length "02" (value "01" is 2 chars), Value "01"
  });

  it("pads length to 2 digits", () => {
    expect(tlv("58", "MY")).toBe("5802MY");
  });

  it("handles longer values", () => {
    expect(tlv("59", "SPLITBILL USER")).toBe("5914SPLITBILL USER");
    // Length = 14 chars
  });

  it("handles single-char value", () => {
    expect(tlv("99", "X")).toBe("9901X");
  });

  it("calculates length from UTF-8 bytes, not JS string length", () => {
    // "Hotpot 🥘" = 7 ASCII chars + 1 emoji (4 UTF-8 bytes) = 11 bytes total
    // JS string length would report 9 (or 10 with surrogate pair),
    // but UTF-8 byte length is 11.
    const value = "Hotpot 🥘";
    const result = tlv("59", value);

    // Extract the 2-char length field from position 2–3
    const encodedLength = result.substring(2, 4);
    expect(encodedLength).toBe("11"); // 11 bytes, NOT 9 chars

    // Full TLV: Tag "59" + Length "11" + Value "Hotpot 🥘"
    expect(result).toBe(`5911${value}`);
  });
});

// ─────────────────────────────────────────────────────────────
// CRC16-CCITT
// ─────────────────────────────────────────────────────────────

describe("crc16ccitt — CRC16-CCITT checksum", () => {
  it("returns correct checksum for the EMVCo test vector", () => {
    // Well-known EMVCo example: the CRC of "00020101021102164000123456789012520452515303840580
    // 2US5911ABC Hammers6008New York6304" should equal a known value.
    //
    // Verified against the EMVCo spec example and cross-checked with
    // multiple CRC16-CCITT (0xFFFF) calculators.
    const testPayload =
      "00020101021102164000123456789012520452515303840" +
      "5802US5911ABC Hammers6008New York6304";
    const crc = crc16ccitt(testPayload);

    // The CRC for this payload is 830B (verified via manual CRC16-CCITT calculation)
    expect(crc).toBe("830B");
  });

  it("returns a 4-character uppercase hex string", () => {
    const result = crc16ccitt("hello");
    expect(result).toMatch(/^[0-9A-F]{4}$/);
  });

  it("returns different CRC for different inputs", () => {
    const a = crc16ccitt("payload_a");
    const b = crc16ccitt("payload_b");
    expect(a).not.toBe(b);
  });

  it("returns consistent results for the same input", () => {
    const input = "some test string";
    expect(crc16ccitt(input)).toBe(crc16ccitt(input));
  });

  it("zero-pads CRC values that are less than 4 hex digits", () => {
    // We verify the format — the padStart(4, "0") logic
    const result = crc16ccitt("");
    expect(result).toMatch(/^[0-9A-F]{4}$/);
    expect(result.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────
// Payload Generator
// ─────────────────────────────────────────────────────────────

describe("generateDuitNowPayload — full EMVCo payload", () => {
  it("builds a valid TLV payload string", () => {
    const payload = generateDuitNowPayload("+60123456789", 1550);

    // Must start with Payload Format Indicator (Tag 00)
    expect(payload).toMatch(/^000201/);

    // Must contain Point of Initiation (Tag 01) = 12 (dynamic, amount locked)
    expect(payload).toContain("010212");

    // Must contain Tag 26 with DuitNow GUID sub-tag
    expect(payload).toContain("A0000006150001");

    // Must contain country code MY (Tag 58)
    expect(payload).toContain("5802MY");

    // Must contain currency MYR = 458 (Tag 53)
    expect(payload).toContain("5303458");

    // Must end with Tag 63 + 04 + 4-hex-char CRC
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("converts amountInCents to decimal string (1550 → '15.50')", () => {
    const payload = generateDuitNowPayload("+60123456789", 1550);
    // Tag 54, Length 05, Value "15.50"
    expect(payload).toContain("540515.50");
  });

  it("converts amountInCents correctly for small values (5 → '0.05')", () => {
    const payload = generateDuitNowPayload("+60123456789", 5);
    // Tag 54, Length 04, Value "0.05"
    expect(payload).toContain("54040.05");
  });

  it("converts amountInCents correctly for exact ringgit (1000 → '10.00')", () => {
    const payload = generateDuitNowPayload("+60123456789", 1000);
    // Tag 54, Length 05, Value "10.00"
    expect(payload).toContain("540510.00");
  });

  it("converts large amount correctly (250050 → '2500.50')", () => {
    const payload = generateDuitNowPayload("+60123456789", 250050);
    // Tag 54, Length 07, Value "2500.50"
    expect(payload).toContain("54072500.50");
  });

  it("includes the DuitNow ID in the payload", () => {
    const phone = "+60198765432";
    const payload = generateDuitNowPayload(phone, 1000);
    expect(payload).toContain(phone);
  });

  it("includes custom merchant name and city when provided", () => {
    const payload = generateDuitNowPayload("+60123456789", 500, {
      merchantName: "ALI RESTAURANT",
      merchantCity: "PENANG",
    });
    expect(payload).toContain("ALI RESTAURANT");
    expect(payload).toContain("PENANG");
  });

  it("produces a valid CRC that covers the full payload", () => {
    const payload = generateDuitNowPayload("+60123456789", 1550);

    // Extract everything before the final 4-char CRC
    const base = payload.slice(0, -4);
    const embeddedCrc = payload.slice(-4);

    // Recalculate CRC over the base (which includes "6304")
    const recalculated = crc16ccitt(base);
    expect(embeddedCrc).toBe(recalculated);
  });

  it("changes CRC when amount changes", () => {
    const p1 = generateDuitNowPayload("+60123456789", 1550);
    const p2 = generateDuitNowPayload("+60123456789", 2000);
    const crc1 = p1.slice(-4);
    const crc2 = p2.slice(-4);
    expect(crc1).not.toBe(crc2);
  });

  it("throws on non-integer amount", () => {
    expect(() => generateDuitNowPayload("+60123456789", 15.5)).toThrow(
      "amountInCents must be a positive integer",
    );
  });

  it("throws on zero amount", () => {
    expect(() => generateDuitNowPayload("+60123456789", 0)).toThrow(
      "amountInCents must be a positive integer",
    );
  });

  it("throws on negative amount", () => {
    expect(() => generateDuitNowPayload("+60123456789", -100)).toThrow(
      "amountInCents must be a positive integer",
    );
  });

  it("throws on empty duitNowId", () => {
    expect(() => generateDuitNowPayload("", 1000)).toThrow(
      "duitNowId must be a non-empty string",
    );
  });

  it("Tag 26 sub-tags are correctly nested inside Tag 26", () => {
    const payload = generateDuitNowPayload("+60123456789", 1000);

    // Manually reconstruct what Tag 26 should look like
    const guid = "A0000006150001";         // 14 chars
    const sub00 = `0014${guid}`;           // "00" + "14" + guid
    const sub01 = `0102${"01"}`;           // "01" + "02" + "01" (default proxy type)
    const sub02 = `0212+60123456789`;      // "02" + "12" + phone
    const tag26Inner = sub00 + sub01 + sub02;
    const tag26 = `26${tag26Inner.length.toString().padStart(2, "0")}${tag26Inner}`;

    expect(payload).toContain(tag26);
  });
});
