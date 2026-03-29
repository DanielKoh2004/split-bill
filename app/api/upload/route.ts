import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  parseReceiptImage,
  MathReconciliationError,
} from "@/src/receiptParser";
import { rateLimit } from "@/src/rateLimit";

// ─────────────────────────────────────────────────────────────
// Phase 1: Upload → Parse → Return Draft
//
// The upload route now ONLY parses the receipt via AI and
// returns the enriched JSON to the client for review.
// NO data is written to Redis/KV at this stage.
//
// constraints.md compliance:
//   ✅ Stateless — no data persisted
//   ✅ Zero-knowledge — raw image never stored
//   ✅ Integer-only — all math via parseReceiptImage pipeline
//   ✅ Fail loudly — MathReconciliationError / ZodError → 400
//   ✅ Rate-limited — 5 requests / 60s per IP
// ─────────────────────────────────────────────────────────────

/** Max base64 payload size (~7.5 MB decoded). */
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

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

    const body = await request.json();
    const { imageBase64, sectionName } = body as {
      imageBase64?: string;
      sectionName?: string;
    };

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid imageBase64 field." },
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

    // 4. Enrich items with stable IDs and optional sectionName
    const section = sectionName?.trim() || undefined;
    const enrichedReceipt = {
      ...parsedReceipt,
      items: parsedReceipt.items.map((item) => ({
        ...item,
        id: `item-${crypto.randomUUID()}`,
        ...(section ? { sectionName: section } : {}),
      })),
    };

    // 5. Return the enriched receipt for client-side review
    //    NO session is created — the client must call /api/session/finalize
    return NextResponse.json({ enrichedReceipt }, { status: 200 });
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
