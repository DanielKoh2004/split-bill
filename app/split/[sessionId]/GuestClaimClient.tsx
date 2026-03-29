"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ChefHat,
  Minus,
  Plus,
  Check,
  QrCode,
  Download,
  X,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { calculateSplit } from "@/src/mathEngine";
import { modifyEMVCoPayload } from "@/src/duitnowQR";
import type { Receipt as ReceiptType } from "@/src/mathEngine";

// ═══════════════════════════════════════════════════════════
// Types (exported for page.tsx type safety)
// ═══════════════════════════════════════════════════════════

export interface ReceiptItemDisplay {
  id: string;
  name: string;
  quantity: number;
  priceInCents: number;
}

export interface GuestClaimReceipt {
  merchantName: string;
  date: string;
  items: ReceiptItemDisplay[];
  subtotalInCents: number;
  taxInCents: number;
  serviceChargeInCents: number;
  grandTotalInCents: number;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 3000;

function formatRM(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

/** Generate a stable guest ID, persisted in sessionStorage. */
function getOrCreateGuestId(sessionId: string): string {
  const storageKey = `splitbill-guest-${sessionId}`;
  if (typeof window !== "undefined") {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(storageKey, id);
    return id;
  }
  return crypto.randomUUID();
}

// ═══════════════════════════════════════════════════════════
// Client Component — fed by Server Component props
// ═══════════════════════════════════════════════════════════

export default function GuestClaimClient({
  receipt,
  sessionId,
  originalQrString,
}: {
  receipt: GuestClaimReceipt;
  sessionId: string;
  originalQrString: string;
}) {
  const items: ReceiptItemDisplay[] = receipt.items;

  // Memoize mathReceipt to prevent unnecessary recalculations
  const mathReceipt: ReceiptType = useMemo(
    () => ({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        priceInCents: i.priceInCents,
      })),
      subtotalInCents: receipt.subtotalInCents,
      taxInCents: receipt.taxInCents,
      serviceChargeInCents: receipt.serviceChargeInCents,
      grandTotalInCents: receipt.grandTotalInCents,
    }),
    [items, receipt.subtotalInCents, receipt.taxInCents, receipt.serviceChargeInCents, receipt.grandTotalInCents],
  );

  // ── State ───────────────────────────────────────────────
  const [claims, setClaims] = useState<Record<string, number>>({});
  const [othersTotals, setOthersTotals] = useState<Record<string, number>>({});
  const [showModal, setShowModal] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const pendingSyncsRef = useRef(0);

  const guestIdRef = useRef<string>("");
  if (guestIdRef.current === "") {
    guestIdRef.current = getOrCreateGuestId(sessionId);
  }
  const guestId = guestIdRef.current;

  // ── Server Sync: POST claim changes ────────────────────
  const syncClaim = useCallback(
    async (itemId: string, quantity: number) => {
      pendingSyncsRef.current += 1;
      try {
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, guestId, itemId, quantity }),
        });
        if (res.status === 409) {
          const data = await res.json();
          setConflictMsg(data.error ?? "Item no longer available.");
          setTimeout(() => setConflictMsg(null), 3000);
          // Revert: re-poll to get true state
          await pollClaims();
          return false;
        }
        if (!res.ok) {
          console.error("Claim sync failed:", res.status);
        }
        return true;
      } catch (err) {
        console.error("Claim sync error:", err);
        return true; // keep local state on network error (graceful degradation)
      } finally {
        pendingSyncsRef.current -= 1;
      }
    },
    [sessionId, guestId],
  );

  // ── Server Sync: Poll for all claims ───────────────────
  const pollClaims = useCallback(async () => {
    if (pendingSyncsRef.current > 0) return;
    try {
      const res = await fetch(`/api/claim?sessionId=${sessionId}`);
      if (!res.ok) return;
      const { claims: raw } = await res.json();
      if (!raw) return;

      const myNew: Record<string, number> = {};
      const othersNew: Record<string, number> = {};

      for (const [field, value] of Object.entries(raw)) {
        const sepIdx = field.lastIndexOf(":");
        if (sepIdx === -1) continue;
        const itemId = field.substring(0, sepIdx);
        const claimGuestId = field.substring(sepIdx + 1);
        const qty = Number(value);

        if (claimGuestId === guestId) {
          myNew[itemId] = qty;
        } else {
          othersNew[itemId] = (othersNew[itemId] ?? 0) + qty;
        }
      }

      setClaims(myNew);
      setOthersTotals(othersNew);
    } catch {
      // Polling failure is non-fatal
    }
  }, [sessionId, guestId]);

  // Poll on mount + interval
  useEffect(() => {
    pollClaims();
    const interval = setInterval(pollClaims, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollClaims]);

  // Clear conflict message timer
  useEffect(() => {
    if (!conflictMsg) return;
    const t = setTimeout(() => setConflictMsg(null), 3000);
    return () => clearTimeout(t);
  }, [conflictMsg]);

  // ── Claim Handlers (optimistic update + server sync) ───
  const toggleSingleItem = useCallback(
    (itemId: string) => {
      const isClaimed = !!claims[itemId];
      const newQty = isClaimed ? 0 : 1;

      setClaims((prev) => {
        const next = { ...prev };
        if (newQty === 0) {
          delete next[itemId];
        } else {
          next[itemId] = 1;
        }
        return next;
      });

      // Fire-and-forget sync (revert on conflict via poll)
      syncClaim(itemId, newQty);
    },
    [claims, syncClaim],
  );

  const adjustClaim = useCallback(
    (itemId: string, maxQty: number, delta: number) => {
      const current = claims[itemId] ?? 0;
      const othersQty = othersTotals[itemId] ?? 0;
      const effectiveMax = maxQty - othersQty;
      const next = Math.max(0, Math.min(effectiveMax, current + delta));

      setClaims((prev) => {
        const updated = { ...prev };
        if (next === 0) {
          delete updated[itemId];
        } else {
          updated[itemId] = next;
        }
        return updated;
      });

      syncClaim(itemId, next);
    },
    [claims, othersTotals, syncClaim],
  );

  // ── Backend Calculation ───────────────────────────────
  const userTotal = useMemo(() => {
    const activeClaimEntries = Object.entries(claims).filter(
      ([, qty]) => qty > 0,
    );
    if (activeClaimEntries.length === 0) return 0;

    try {
      const userClaims = activeClaimEntries.map(([itemId, qty]) => {
        const item = items.find((i) => i.id === itemId);
        if (!item) return [];
        if (item.quantity === 1) {
          return [{ userId: "guest", itemId }];
        }
        return Array.from({ length: qty }, () => ({
          userId: "guest",
          itemId,
        }));
      });

      const allClaims = userClaims.flat();

      for (const item of items) {
        const guestQty = claims[item.id] ?? 0;
        const remaining = item.quantity - guestQty;
        if (remaining > 0 && item.quantity > 1) {
          for (let i = 0; i < remaining; i++) {
            allClaims.push({
              userId: "others",
              itemId: item.id,
            });
          }
        } else if (guestQty === 0) {
          allClaims.push({
            userId: "others",
            itemId: item.id,
          });
        }
      }

      const result = calculateSplit(mathReceipt, allClaims);
      return result["guest"] ?? 0;
    } catch {
      return 0;
    }
  }, [claims, items, mathReceipt]);

  // ── QR Payload ────────────────────────────────────────
  const qrPayload = useMemo(() => {
    if (userTotal <= 0) return "";
    return modifyEMVCoPayload(originalQrString, userTotal);
  }, [userTotal, originalQrString]);

  // ── Proportional breakdown (integer math, no floats) ──
  const breakdown = useMemo(() => {
    if (userTotal <= 0 || receipt.grandTotalInCents <= 0)
      return { subtotal: 0, tax: 0, service: 0, total: 0 };

    // Multiply-before-divide: same pattern as mathEngine
    const subtotal = Math.floor(
      (userTotal * receipt.subtotalInCents) / receipt.grandTotalInCents,
    );
    const tax = Math.floor(
      (userTotal * receipt.taxInCents) / receipt.grandTotalInCents,
    );
    const service = userTotal - subtotal - tax; // absorbs remainder
    return { subtotal, tax, service, total: userTotal };
  }, [userTotal, receipt]);

  const hasItems = Object.keys(claims).length > 0;

  // ── Download QR Handler ───────────────────────────────
  const downloadQR = () => {
    const canvas = document.getElementById("duitnow-qr") as HTMLCanvasElement;
    if (!canvas) return;

    // Convert canvas to image data URL
    const pngUrl = canvas
      .toDataURL("image/png")
      .replace("image/png", "image/octet-stream");
    
    // Trigger download
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = "split-bill-payment.png";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 relative pb-32">
      {/* ── Conflict Banner ──────────────────────────────── */}
      {conflictMsg && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center p-3">
          <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 max-w-md w-full text-sm font-medium animate-[slideDown_0.3s_ease-out]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {conflictMsg}
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────── */}
      <header className="px-5 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-[#10B981] flex items-center justify-center">
            <ChefHat className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1E293B]">
              {receipt.merchantName}
            </h1>
            <p className="text-sm text-[#64748B]">{receipt.date}</p>
          </div>
        </div>
        <p className="text-sm text-[#64748B] mt-3 leading-relaxed">
          Select what you ate. Taxes and service charges will be calculated
          automatically.
        </p>
      </header>

      {/* ── Receipt Summary ─────────────────────────────── */}
      <div className="mx-5 mb-4 p-4 bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-[#64748B]" />
          <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
            Bill Summary
          </span>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-[#64748B]">Subtotal</span>
            <span className="text-[#1E293B] font-medium">
              {formatRM(receipt.subtotalInCents)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#64748B]">SST (6%)</span>
            <span className="text-[#1E293B] font-medium">
              {formatRM(receipt.taxInCents)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#64748B]">Service Charge (10%)</span>
            <span className="text-[#1E293B] font-medium">
              {formatRM(receipt.serviceChargeInCents)}
            </span>
          </div>
          <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between">
            <span className="font-semibold text-[#1E293B]">Grand Total</span>
            <span className="font-bold text-[#1E293B]">
              {formatRM(receipt.grandTotalInCents)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Item Cards ──────────────────────────────────── */}
      <div className="px-5 space-y-3">
        <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
          Select Your Items
        </span>

        {items.map((item) => {
          const claimed = claims[item.id] ?? 0;
          const othersQty = othersTotals[item.id] ?? 0;
          const remaining = item.quantity - claimed - othersQty;
          const isSingle = item.quantity === 1;
          const isSelected = claimed > 0;
          const isTakenByOthers = isSingle && othersQty >= 1 && claimed === 0;

          return (
            <div
              key={item.id}
              className={`
                bg-white rounded-2xl p-4 shadow-sm border-2 transition-all duration-200
                ${isSelected
                  ? "border-[#10B981] shadow-[0_0_0_1px_rgba(16,185,129,0.1)]"
                  : isTakenByOthers
                  ? "border-transparent opacity-50"
                  : "border-transparent"
                }
              `}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-4">
                  <p className="font-semibold text-[#1E293B] truncate">
                    {item.name}
                  </p>
                  <p className="text-sm text-[#64748B] mt-0.5">
                    {formatRM(item.priceInCents)}
                    {item.quantity > 1 && (
                      <span className="ml-1">
                        · {remaining} of {item.quantity} available
                      </span>
                    )}
                    {isTakenByOthers && (
                      <span className="ml-1 text-amber-600">· Claimed</span>
                    )}
                  </p>
                </div>

                {isSingle ? (
                  <button
                    onClick={() => toggleSingleItem(item.id)}
                    disabled={isTakenByOthers}
                    className={`
                      w-8 h-8 rounded-full border-2 flex items-center justify-center
                      transition-all duration-200 shrink-0
                      ${isSelected
                        ? "bg-[#10B981] border-[#10B981]"
                        : isTakenByOthers
                        ? "border-slate-200 bg-slate-100 cursor-not-allowed"
                        : "border-[#64748B] bg-transparent"
                      }
                    `}
                    aria-label={`Toggle ${item.name}`}
                  >
                    {isSelected && (
                      <Check className="w-4 h-4 text-white" strokeWidth={3} />
                    )}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => adjustClaim(item.id, item.quantity, -1)}
                      disabled={claimed === 0}
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center
                        border-2 transition-all duration-200
                        ${claimed === 0
                          ? "border-slate-200 text-slate-300 cursor-not-allowed"
                          : "border-[#FC7C78] text-[#FC7C78] active:bg-red-50"
                        }
                      `}
                      aria-label={`Remove one ${item.name}`}
                    >
                      <Minus className="w-4 h-4" strokeWidth={3} />
                    </button>

                    <span
                      className={`
                        w-6 text-center font-bold text-lg
                        ${claimed > 0 ? "text-[#1E293B]" : "text-slate-300"}
                      `}
                    >
                      {claimed}
                    </span>

                    <button
                      onClick={() => adjustClaim(item.id, item.quantity, +1)}
                      disabled={remaining <= 0}
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center
                        border-2 transition-all duration-200
                        ${remaining <= 0
                          ? "border-slate-200 text-slate-300 cursor-not-allowed"
                          : "border-[#10B981] text-[#10B981] active:bg-emerald-50"
                        }
                      `}
                      aria-label={`Add one ${item.name}`}
                    >
                      <Plus className="w-4 h-4" strokeWidth={3} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Sticky Footer ───────────────────────────────── */}
      <div className="fixed bottom-0 w-full max-w-md bg-white p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] rounded-t-2xl z-40">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#64748B]">Your Total</span>
          <span className="text-3xl font-bold text-[#1E293B]">
            {formatRM(userTotal)}
          </span>
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={!hasItems || userTotal <= 0}
          className={`
            w-full py-4 rounded-2xl text-white font-bold text-lg
            transition-all duration-200 flex items-center justify-center gap-2
            ${hasItems && userTotal > 0
              ? "bg-[#10B981] active:bg-emerald-600 shadow-lg shadow-emerald-200"
              : "bg-slate-300 cursor-not-allowed"
            }
          `}
        >
          <QrCode className="w-5 h-5" />
          Pay {formatRM(userTotal)}
        </button>
      </div>

      {/* ── Settlement Modal (Bottom Sheet) ──────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setShowModal(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          <div
            className="relative w-full max-w-md bg-white rounded-t-3xl p-6 animate-[slideUp_0.3s_ease-out] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[#64748B] hover:bg-slate-200 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-[#1E293B]">
                Scan to Pay
              </h2>
              <p className="text-sm text-[#64748B] mt-1">
                DuitNow QR · {receipt.merchantName}
              </p>
            </div>

            <div className="flex justify-center mb-6">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                <QRCodeCanvas
                  id="duitnow-qr"
                  value={qrPayload || "placeholder"}
                  size={250}
                  level="M"
                  bgColor="#FFFFFF"
                  fgColor="#1E293B"
                />
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 mb-5">
              <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                Your Share Breakdown
              </span>
              <div className="space-y-2 mt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Subtotal</span>
                  <span className="text-[#1E293B] font-medium">
                    {formatRM(breakdown.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">SST (6%)</span>
                  <span className="text-[#1E293B] font-medium">
                    {formatRM(breakdown.tax)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Service Charge (10%)</span>
                  <span className="text-[#1E293B] font-medium">
                    {formatRM(breakdown.service)}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between">
                  <span className="font-bold text-[#1E293B]">
                    Total to Pay
                  </span>
                  <span className="text-xl font-bold text-[#10B981]">
                    {formatRM(breakdown.total)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 mb-3 text-center">
              <p className="text-xs text-[#64748B]">
                Open your banking app, tap Scan, and select this image from your gallery.
              </p>
            </div>

            <button
              onClick={downloadQR}
              className="w-full py-3.5 rounded-2xl bg-[#1E293B] text-white font-semibold flex items-center justify-center gap-2 transition-all duration-200 active:bg-slate-800"
            >
              <Download className="w-4 h-4" />
              Save QR to Gallery
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
