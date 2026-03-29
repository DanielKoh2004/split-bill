import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  parseReceiptImage,
  MathReconciliationError,
} from "@/src/receiptParser";
import { registerSession, type SessionData } from "@/src/privacy";
import { rateLimit } from "@/src/rateLimit";

// ─────────────────────────────────────────────────────────────
// constraints.md compliance:
//   ✅ Stateless — in-memory session, no database
//   ✅ Zero-knowledge — raw image never stored
//   ✅ Integer-only — all math via parseReceiptImage pipeline
//   ✅ Fail loudly — MathReconciliationError / ZodError → 400
//   ✅ Rate-limited — 5 requests / 60s per IP
// ─────────────────────────────────────────────────────────────

/** Max base64 payload size (~7.5 MB decoded). */
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

/** Generate a short random alphanumeric session ID. */
function generateSessionId(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate Limiting ─────────────────────────────────────
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    const { allowed, retryAfterMs } = await rateLimit(ip, 5, 60_000);

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(retryAfterMs / 1000).toString(),
          },
        },
      );
    }

    // 1. Parse request body
    const body = await request.json();
    const { imageBase64, merchantAccountInfo } = body as { imageBase64?: string; merchantAccountInfo?: string; };

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid imageBase64 field." },
        { status: 400 },
      );
    }

    if (!merchantAccountInfo || typeof merchantAccountInfo !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid DuitNow QR merchant info." },
        { status: 400 },
      );
    }

    // ── Payload Validation ────────────────────────────────
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: "Image too large. Maximum ~7.5 MB." },
        { status: 413 },
      );
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
      return NextResponse.json(
        { error: "Invalid base64 encoding." },
        { status: 400 },
      );
    }

    // 2. Get API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing GEMINI_API_KEY." },
        { status: 500 },
      );
    }

    // 3. Parse receipt via LLM + Zod validation + math reconciliation gate
    const parsedReceipt = await parseReceiptImage(imageBase64, {
      provider: "gemini",
      apiKey,
      model: "gemini-2.5-flash",
    });

    // 4. Enrich items with stable IDs (ParsedReceipt has no id field)
    const enrichedReceipt = {
      ...parsedReceipt,
      items: parsedReceipt.items.map((item, idx) => ({
        ...item,
        id: `item-${idx}`,
      })),
    };

    // 5. Generate ephemeral session ID (12-char for enumeration resistance)
    const sessionId = generateSessionId();

    // 6. Register session in Vercel KV (constraints.md mandate: 2-hour TTL)
    const sessionData: SessionData = {
      receiptJson: enrichedReceipt as unknown as Record<string, unknown>,
      userClaims: [],
      settlementHash: null,
      merchantAccountInfo,
    };
    await registerSession(sessionId, sessionData);

    // 7. Return session ID — the raw image is already gone from memory
    return NextResponse.json({ sessionId }, { status: 200 });
  } catch (error) {
    // ── Fail Loudly: specific error types ────────────────
    if (error instanceof MathReconciliationError) {
      return NextResponse.json(
        {
          error: "Receipt math doesn't add up. Please try a clearer photo.",
          detail: error.message,
        },
        { status: 400 },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Could not parse receipt into a valid format. Please try again.",
          detail:
            error && typeof error === "object" && "errors" in error
              ? (error as any).errors.map((e: any) => e.message).join("; ")
              : error instanceof Error
              ? error.message
              : String(error),
        },
        { status: 400 },
      );
    }

    // ── Generic server error ─────────────────────────────
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
