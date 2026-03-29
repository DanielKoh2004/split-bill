import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getSession, wipeSession } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// POST /api/session/wipe — Delete session + claims from Redis
//
// Security: requires x-qr-proof header matching stored QR.
// Called by the host "Nuke" button once everyone has paid.
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid sessionId." },
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

    // Fetch session to verify ownership
    const session = await getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or already wiped." },
        { status: 404 },
      );
    }

    if (session.originalQrString !== qrProof) {
      return NextResponse.json(
        { error: "Unauthorized. QR proof mismatch." },
        { status: 403 },
      );
    }

    // Wipe session data
    await wipeSession(sessionId);

    // Also wipe the claims hash
    const claimsKey = `claims:${sessionId}`;
    await kv.del(claimsKey);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
