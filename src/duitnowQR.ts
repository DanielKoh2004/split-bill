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



// ── Modifier ────────────────────────────────────────────────

/**
 * Parses an EMVCo QR string byte-by-byte, modifies it for a dynamic payment
 * with a new amount, sorts the tags, and recalculates the CRC.
 *
 * @throws {Error} if amountInCents is not a positive integer.
 */
export function modifyEMVCoPayload(
  originalPayload: string,
  amountInCents: number,
): string {
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    throw new Error(
      `amountInCents must be a positive integer, got: ${amountInCents}`,
    );
  }

  const decoder = new TextDecoder();
  const bytes = encoder.encode(originalPayload);
  const tags = new Map<string, string>();

  let i = 0;
  while (i < bytes.length) {
    if (i + 4 > bytes.length) break;
    const tag = decoder.decode(bytes.slice(i, i + 2));
    const lenStr = decoder.decode(bytes.slice(i + 2, i + 4));
    const len = parseInt(lenStr, 10);
    if (isNaN(len)) break;

    const valueBytes = bytes.slice(i + 4, i + 4 + len);
    const value = decoder.decode(valueBytes);

    tags.set(tag, value);
    i += 4 + len;
  }

  // Force Tag 01 to "12" (Dynamic QR)
  tags.set("01", "12");

  // Convert cents to decimal string (e.g. 1550 -> "15.50")
  const ringgit = Math.floor(amountInCents / 100);
  const sen = amountInCents % 100;
  const amountStr = `${ringgit}.${sen.toString().padStart(2, "0")}`;
  tags.set("54", amountStr);

  // Remove the old CRC (Tag 63)
  tags.delete("63");

  // Rebuild the payload by sorting tags as EMVCo expects (00 ascending)
  const sortedTags = Array.from(tags.keys()).sort();

  let newPayload = "";
  for (const tag of sortedTags) {
    const val = tags.get(tag)!;
    newPayload += tlv(tag, val);
  }

  // Calculate new CRC
  const crcInput = newPayload + "6304";
  const crcValue = crc16ccitt(crcInput);

  return newPayload + tlv("63", crcValue);
}
