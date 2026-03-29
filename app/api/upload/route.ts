import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  parseReceiptImage,
  MathReconciliationError,
} from "@/src/receiptParser";
import { registerSession, type SessionData } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// constraints.md compliance:
//   ✅ Stateless — in-memory session, no database
//   ✅ Zero-knowledge — raw image never stored
//   ✅ Integer-only — all math via parseReceiptImage pipeline
//   ✅ Fail loudly — MathReconciliationError / ZodError → 400
// ─────────────────────────────────────────────────────────────

/** Generate a short random alphanumeric session ID. */
function generateSessionId(length = 6): string {
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
    // 1. Parse request body
    const body = await request.json();
    const { imageBase64 } = body as { imageBase64?: string };

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid imageBase64 field." },
        { status: 400 },
      );
    }

    // 2. Get API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: missing API key." },
        { status: 500 },
      );
    }

    // 3. Parse receipt via LLM + Zod validation + math reconciliation gate
    const parsedReceipt = await parseReceiptImage(imageBase64, {
      provider: "openai",
      apiKey,
      model: "gpt-4o",
    });

    // 4. Generate ephemeral session ID
    const sessionId = generateSessionId();

    // 5. Register in-memory session (NO database — constraints.md mandate)
    const sessionData: SessionData = {
      receiptJson: parsedReceipt as unknown as Record<string, unknown>,
      userClaims: [],
      settlementHash: null,
    };
    registerSession(sessionId, sessionData);

    // 6. Return session ID — the raw image is already gone from memory
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
          error:
            "Could not parse receipt into a valid format. Please try again.",
          detail: error.errors.map((e) => e.message).join("; "),
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
