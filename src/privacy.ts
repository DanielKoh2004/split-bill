// ─────────────────────────────────────────────────────────────
// Module 4: Privacy & Sanitization Layer
//
// Three pillars of data hygiene:
//   A. sanitizeImage    — strip EXIF, compress (browser-only)
//   B. generateSettlementHash — SHA-256 zero-knowledge receipt
//   C. wipeSession      — ephemeral memory teardown
//
// Constraints: No external crypto libs. Use native APIs only.
// ─────────────────────────────────────────────────────────────

// Uses native Web Crypto API + Vercel KV
import { kv } from "@vercel/kv";
// ═════════════════════════════════════════════════════════════
// Feature A: Client-Side Image Sanitization (Browser API)
// ═════════════════════════════════════════════════════════════

/** Maximum dimension (px) for the longest side after compression. */
const MAX_DIMENSION = 1500;

/** JPEG output quality (0–1). 0.85 balances size vs. OCR readability. */
const JPEG_QUALITY = 0.85;

/**
 * Strips all EXIF metadata and compresses a JPEG/PNG image entirely
 * in the browser. The trick: drawing to a `<canvas>` inherently
 * discards all metadata — the output is a clean raster with zero
 * GPS coordinates, timestamps, or camera model strings.
 *
 * @param file - The raw File from an `<input type="file">`.
 * @param maxDimension - Longest-side cap in pixels (default 1500).
 * @param quality - JPEG quality 0–1 (default 0.85).
 * @returns A clean, compressed Blob (image/jpeg) safe to transmit.
 *
 * @throws {Error} if the file cannot be decoded as an image.
 *
 * NOTE: This function requires DOM APIs (Canvas, Image, FileReader).
 *       It will NOT work in a pure Node.js / Vitest environment
 *       without a browser-like polyfill.
 */
export async function sanitizeImage(
  file: File,
  maxDimension: number = MAX_DIMENSION,
  quality: number = JPEG_QUALITY,
): Promise<Blob> {
  // 1. Read file as a data URL
  const dataUrl = await readFileAsDataURL(file);

  // 2. Decode into an HTMLImageElement
  const img = await loadImage(dataUrl);

  // 3. Calculate scaled dimensions (preserve aspect ratio)
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // 4. Draw to canvas → this inherently strips ALL EXIF metadata
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire 2D canvas context");
  }
  ctx.drawImage(img, 0, 0, width, height);

  // 5. Export as compressed JPEG blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Canvas toBlob returned null"));
        }
      },
      "image/jpeg",
      quality,
    );
  });
}

/** Reads a File/Blob into a data URL string. */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** Loads an image from a data URL. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

// ═════════════════════════════════════════════════════════════
// Feature B: Zero-Knowledge Settlement Hash
// ═════════════════════════════════════════════════════════════

/**
 * Generates a deterministic SHA-256 hash of the final settlement.
 *
 * This is the **only** artifact we store in our database to prove a
 * transaction occurred — without exposing who paid what or for which items.
 *
 * Algorithm:
 *   1. Sort userTotals by userId alphabetically (deterministic order).
 *   2. Serialize as `receiptId|userId1:amount1|userId2:amount2|...|salt`.
 *   3. SHA-256 the resulting string.
 *   4. Return lowercase hex digest.
 *
 * @param receiptId - Unique identifier for the receipt session.
 * @param userTotals - Map of userId → amount in cents (from Math Engine).
 * @param salt - Cryptographic salt (client-generated, never stored with hash).
 * @returns 64-character lowercase hex SHA-256 digest.
 */
export async function generateSettlementHash(
  receiptId: string,
  userTotals: Record<string, number>,
  salt: string,
): Promise<string> {
  // 1. Sort by userId for deterministic ordering
  const sortedEntries = Object.entries(userTotals).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  // 2. Build canonical string: receiptId|user1:amt1|user2:amt2|salt
  const parts = sortedEntries.map(([uid, amt]) => `${uid}:${amt}`);
  const canonical = [receiptId, ...parts, salt].join("|");

  // 3. SHA-256 via Web Crypto API (browser + Node 20+ compatible)
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);

  // 4. Convert ArrayBuffer to lowercase hex string
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ═════════════════════════════════════════════════════════════
// Feature C: Ephemeral Session Wipe
// ═════════════════════════════════════════════════════════════

/**
 * In-memory session store. Each session holds the raw receipt JSON
 * and user claims that must be wiped after QR generation.
 *
 * WARNING: This store is intentionally module-scoped so that
 * wipeSession can reach it. In production, you'd integrate with
 * your state management layer (e.g. Zustand, Redux, or a Map).
 */
export interface SessionData {
  receiptJson: Record<string, unknown> | null;
  userClaims: Array<Record<string, unknown>> | null;
  settlementHash: string | null;
  acquirerId: string;
  qrId: string;
  [key: string]: unknown;
}

/**
 * Registers a session with raw financial data.
 * Call this when the receipt is first parsed.
 * EX: 7200 sets a 2-hour zero-knowledge self-destruct.
 */
export async function registerSession(
  sessionId: string,
  data: SessionData,
): Promise<void> {
  await kv.set(sessionId, data, { ex: 7200 });
}

/**
 * Retrieves session data (returns undefined/null if wiped or never set).
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  return await kv.get<SessionData>(sessionId);
}

/**
 * Ephemeral teardown — removes all references to financial data.
 */
export async function wipeSession(sessionId: string): Promise<boolean> {
  const deleted = await kv.del(sessionId);
  return deleted > 0;
}
