import { getSession } from "@/src/privacy";
import GuestClaimClient from "./GuestClaimClient";
import type { GuestClaimReceipt } from "./GuestClaimClient";
import { SessionExpired, InvalidSessionData } from "./SessionErrors";

export const dynamic = "force-dynamic";

export default async function SplitPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  if (!session || !session.receiptJson) {
    return <SessionExpired />;
  }

  const receipt = session.receiptJson as unknown as GuestClaimReceipt;
  if (!receipt || !Array.isArray(receipt.items) || typeof receipt.grandTotalInCents !== "number") {
    return <InvalidSessionData />;
  }

  return (
    <GuestClaimClient
      receipt={receipt}
      sessionId={sessionId}
      originalQrString={session.originalQrString as string}
      sanitizedImageBase64={session.sanitizedImageBase64}
    />
  );
}

