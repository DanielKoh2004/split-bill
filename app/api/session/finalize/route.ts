import { NextRequest, NextResponse } from "next/server";
import { getSession, registerSession, type SessionData } from "@/src/privacy";
import { rateLimit } from "@/src/rateLimit";

// ─────────────────────────────────────────────────────────────
// Phase 2: Finalize — Save reviewed receipt to Redis/KV
//
// Called after the host reviews and optionally edits the AI-parsed
// receipt on the client side. This is the only route that writes
// session data to the ephemeral KV store.
//
// constraints.md compliance:
//   ✅ Stateless — ephemeral KV with 2h TTL
//   ✅ Zero-knowledge — no raw images
//   ✅ Integer-only — all values pre-validated by client
//   ✅ Rate-limited — 5 requests / 60s per IP
// ─────────────────────────────────────────────────────────────

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

    const body = await request.json();
    const { receipt, originalQrString, mergeSessionId, imageBase64 } = body as {
      receipt?: Record<string, unknown>;
      originalQrString?: string;
      mergeSessionId?: string;
      imageBase64?: string;
    };

    // Validate optional receipt image (500KB cap)
    if (imageBase64 && (typeof imageBase64 !== "string" || imageBase64.length > 512_000)) {
      return NextResponse.json(
        { error: "Receipt image too large. Maximum 500KB." },
        { status: 400 },
      );
    }

    // ── Validation ────────────────────────────────────────
    if (!receipt || typeof receipt !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid receipt payload." },
        { status: 400 },
      );
    }

    if (!originalQrString || typeof originalQrString !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid DuitNow original QR string." },
        { status: 400 },
      );
    }

    // Basic shape validation: items array and totals must exist
    const items = (receipt as any).items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Receipt must contain at least one item." },
        { status: 400 },
      );
    }

    const grandTotal = (receipt as any).grandTotalInCents;
    if (typeof grandTotal !== "number" || !Number.isInteger(grandTotal) || grandTotal <= 0) {
      return NextResponse.json(
        { error: "Invalid grandTotalInCents." },
        { status: 400 },
      );
    }

    // Server-Side Math Verification
    let calculatedSubtotal = 0;
    for (const item of items) {
      if (typeof item.priceInCents !== "number" || !Number.isInteger(item.priceInCents)) {
        return NextResponse.json(
          { error: "Invalid item priceInCents." },
          { status: 400 },
        );
      }
      calculatedSubtotal += item.priceInCents;
    }

    const tTax = (receipt as any).taxInCents || 0;
    const tService = (receipt as any).serviceChargeInCents || 0;
    const expectedGrandTotal = calculatedSubtotal + tTax + tService;

    if (
      (receipt as any).subtotalInCents !== calculatedSubtotal ||
      grandTotal !== expectedGrandTotal
    ) {
      return NextResponse.json(
        { error: "Math mismatch: The server calculations do not match the client's totals." },
        { status: 400 },
      );
    }

    // ── Merge or Create ──────────────────────────────────
    let sessionId: string;
    let sessionData: SessionData;

    if (mergeSessionId) {
      // Merge into existing session
      const existing = await getSession(mergeSessionId);
      if (!existing || !existing.receiptJson) {
        return NextResponse.json(
          { error: "Invalid mergeSessionId. Session not found or expired." },
          { status: 400 },
        );
      }

      const existingReceipt = existing.receiptJson as any;
      const newReceipt = receipt as any;

      const combinedReceipt = {
        ...existingReceipt,
        merchantName: "Combined Trip Settlement",
        subtotalInCents: existingReceipt.subtotalInCents + newReceipt.subtotalInCents,
        taxInCents: existingReceipt.taxInCents + newReceipt.taxInCents,
        serviceChargeInCents: existingReceipt.serviceChargeInCents + newReceipt.serviceChargeInCents,
        grandTotalInCents: existingReceipt.grandTotalInCents + newReceipt.grandTotalInCents,
        items: [...existingReceipt.items, ...newReceipt.items],
      };

      sessionId = mergeSessionId;
      sessionData = {
        ...existing,
        receiptJson: combinedReceipt as Record<string, unknown>,
      };
    } else {
      // New session
      sessionId = generateSessionId();
      sessionData = {
        receiptJson: receipt,
        userClaims: [],
        settlementHash: null,
        originalQrString,
        ...(imageBase64 ? { sanitizedImageBase64: imageBase64 } : {}),
      };
    }

    await registerSession(sessionId, sessionData);

    return NextResponse.json({ sessionId }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
