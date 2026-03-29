import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { SessionData } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// GET /api/session/status — Live session status for host dashboard
//
// Security: requires x-qr-proof header matching the stored
// originalQrString (Proof of Ownership). Only the host knows this.
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query parameter." },
      { status: 400 },
    );
  }

  const qrProof = request.headers.get("x-qr-proof");
  if (!qrProof) {
    return NextResponse.json(
      { error: "Missing x-qr-proof header." },
      { status: 401 },
    );
  }

  // Fetch session
  const session = await kv.get<SessionData>(sessionId);
  if (!session || !session.receiptJson) {
    return NextResponse.json(
      { error: "Session expired or not found." },
      { status: 404 },
    );
  }

  // Verify ownership
  if (session.originalQrString !== qrProof) {
    return NextResponse.json(
      { error: "Unauthorized. QR proof mismatch." },
      { status: 403 },
    );
  }

  // Fetch live claims
  const claimsKey = `claims:${sessionId}`;
  const rawClaims = await kv.hgetall(claimsKey);

  return NextResponse.json({
    receipt: session.receiptJson,
    claims: rawClaims ?? {},
    originalQrString: session.originalQrString,
  });
}
