// ─────────────────────────────────────────────────────────────
// Module 2: DuitNow QR Payload Generator
// Generates an EMVCo Merchant-Presented Mode (MPM) dynamic QR
// payload string with a valid CRC16-CCITT checksum.
//
// Reference: EMVCo QR Code Specification for Payment Systems
//            (Merchant-Presented Mode) v1.1
// ─────────────────────────────────────────────────────────────

// ── TLV Helper ──────────────────────────────────────────────

/**
 * Builds a single TLV (Tag-Length-Value) data object.
 * Tag and Length are always 2 characters, zero-padded.
 *
 * Length is computed as **UTF-8 byte count** (not JS string length)
 * to correctly handle multi-byte characters (accented letters, emoji, CJK).
 */
const encoder = new TextEncoder();

export function tlv(tag: string, value: string): string {
  const byteLength = encoder.encode(value).length;
  const length = byteLength.toString().padStart(2, "0");
  return `${tag}${length}${value}`;
}

// ── CRC16-CCITT ─────────────────────────────────────────────

/**
 * Calculates CRC16-CCITT (polynomial 0x1021, initial 0xFFFF)
 * over the given ASCII string. Returns a 4-character uppercase
 * hex string (e.g. "A12B").
 *
 * Implemented manually — no external dependencies.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;

  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// ── DuitNow Constants ───────────────────────────────────────



/** ISO 4217 numeric code for Malaysian Ringgit */
const CURRENCY_MYR = "458";

/** ISO 3166-1 alpha-2 for Malaysia */
const COUNTRY_MY = "MY";

// ── EMVCo Tag IDs ───────────────────────────────────────────

const TAG = {
  PAYLOAD_FORMAT_INDICATOR: "00",
  POINT_OF_INITIATION: "01",
  MERCHANT_ACCOUNT_INFO: "26",
  MERCHANT_CATEGORY_CODE: "52",
  TRANSACTION_CURRENCY: "53",
  TRANSACTION_AMOUNT: "54",
  COUNTRY_CODE: "58",
  MERCHANT_NAME: "59",
  MERCHANT_CITY: "60",
  CRC: "63",
} as const;



// ── Payload Generator ───────────────────────────────────────

export interface DuitNowPayloadOptions {
  /** Merchant Category Code (4-digit ISO 18245). Default: "0000" */
  merchantCategoryCode?: string;
  /** Merchant name for the QR payload. Default: "SPLITBILL USER" */
  merchantName?: string;
  /** Merchant city. Default: "KUALA LUMPUR" */
  merchantCity?: string;
}

/**
 * Generates a complete EMVCo-compliant DuitNow dynamic QR payload string.
 *
 * The amountInCents is converted to a decimal string (e.g. 1550 → "15.50")
 * **only** at the moment it's injected into the payload.
 *
 * @throws {Error} if amountInCents is not a positive integer.
 */
export function generateDuitNowPayload(
  merchantAccountInfo: string,
  amountInCents: number,
  options?: Partial<DuitNowPayloadOptions>,
): string {
  // ── Validation ────────────────────────────────────────────
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    throw new Error(
      `amountInCents must be a positive integer, got: ${amountInCents}`,
    );
  }
  if (!merchantAccountInfo || merchantAccountInfo.trim().length === 0) {
    throw new Error("merchantAccountInfo must be a non-empty string");
  }

  const merchantCategoryCode = options?.merchantCategoryCode ?? "0000";
  const merchantName = options?.merchantName ?? "SPLITBILL USER";
  const merchantCity = options?.merchantCity ?? "KUALA LUMPUR";

  // ── Convert cents to decimal string ───────────────────────
  // 1550 → "15.50", 100 → "1.00", 5 → "0.05"
  const ringgit = Math.floor(amountInCents / 100);
  const sen = amountInCents % 100;
  const amountStr = `${ringgit}.${sen.toString().padStart(2, "0")}`;

  // ── Assemble payload (without CRC) ────────────────────────
  const payloadWithoutCrc =
    tlv(TAG.PAYLOAD_FORMAT_INDICATOR, "01") +         // Tag 00
    tlv(TAG.POINT_OF_INITIATION, "12") +              // Tag 01: Dynamic QR (amount locked)
    tlv(TAG.MERCHANT_ACCOUNT_INFO, merchantAccountInfo) +      // Tag 26
    tlv(TAG.MERCHANT_CATEGORY_CODE, merchantCategoryCode) + // Tag 52
    tlv(TAG.TRANSACTION_CURRENCY, CURRENCY_MYR) +     // Tag 53
    tlv(TAG.TRANSACTION_AMOUNT, amountStr) +           // Tag 54
    tlv(TAG.COUNTRY_CODE, COUNTRY_MY) +               // Tag 58
    tlv(TAG.MERCHANT_NAME, merchantName) +             // Tag 59
    tlv(TAG.MERCHANT_CITY, merchantCity);              // Tag 60

  // ── Append CRC placeholder then calculate ─────────────────
  // The CRC is computed over the entire string INCLUDING "6304"
  const crcInput = payloadWithoutCrc + TAG.CRC + "04";
  const crcValue = crc16ccitt(crcInput);

  return payloadWithoutCrc + tlv(TAG.CRC, crcValue);
}
