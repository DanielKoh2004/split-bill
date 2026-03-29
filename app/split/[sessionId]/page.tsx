import { getSession } from "@/src/privacy";
import GuestClaimClient from "./GuestClaimClient";
import type { GuestClaimReceipt } from "./GuestClaimClient";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Server Component — fetches session from Vercel KV
// constraints.md: stateless, zero-knowledge, no relational database
// ─────────────────────────────────────────────────────────────

export default async function SplitPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  // ── Kill Switch: Session Expired ──────────────────────
  if (!session || !session.receiptJson) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 px-5 text-center">
        <h1 className="text-2xl font-bold text-[#1E293B]">Session Expired</h1>
        <p className="text-sm text-[#64748B] mt-2">
          This bill has already been settled, or the session was wiped for
          privacy.
        </p>
      </div>
    );
  }

  // ── Runtime shape guard (prevents hydration/type drift) ─
  const receipt = session.receiptJson as unknown as GuestClaimReceipt;
  if (
    !receipt ||
    !Array.isArray(receipt.items) ||
    typeof receipt.grandTotalInCents !== "number"
  ) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 px-5 text-center">
        <h1 className="text-2xl font-bold text-[#1E293B]">
          Invalid Session Data
        </h1>
        <p className="text-sm text-[#64748B] mt-2">
          This session&apos;s data appears corrupted. Please ask the host to
          re-upload.
        </p>
      </div>
    );
  }

  // ── Handoff: pass receipt data + sessionId to Client Component ─
  return <GuestClaimClient receipt={receipt} sessionId={sessionId} payeeDuitNowId={session.payeeDuitNowId as string} />;
}
