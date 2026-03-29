import { getSession } from "@/src/privacy";
import GuestClaimClient from "./GuestClaimClient";

// ─────────────────────────────────────────────────────────────
// Server Component — fetches session from server memory
// constraints.md: stateless, zero-knowledge, no database
// ─────────────────────────────────────────────────────────────

export default async function SplitPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = getSession(sessionId);

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

  // ── Handoff: pass receipt data to Client Component ────
  return <GuestClaimClient receipt={session.receiptJson as any} />;
}
