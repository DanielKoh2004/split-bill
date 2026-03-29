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
  Copy,
  Info,
  CreditCard,
  Users,
  Image as ImageIcon,
} from "lucide-react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { calculateSplit } from "@/src/mathEngine";
import { modifyEMVCoPayload } from "@/src/duitnowQR";
import { useAppContext } from "@/src/ThemeContext";
import ToggleBar from "@/app/components/ToggleBar";
import type { Receipt as ReceiptType, FractionalClaim, UserClaim } from "@/src/mathEngine";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ReceiptItemDisplay {
  id: string;
  name: string;
  quantity: number;
  priceInCents: number;
  sectionName?: string;
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

function groupItemsBySection(items: ReceiptItemDisplay[], generalLabel: string): Map<string, ReceiptItemDisplay[]> {
  const groups = new Map<string, ReceiptItemDisplay[]>();
  for (const item of items) {
    const section = item.sectionName || generalLabel;
    if (!groups.has(section)) {
      groups.set(section, []);
    }
    groups.get(section)!.push(item);
  }
  return groups;
}

function formatRM(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

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

function getSavedGuestName(sessionId: string): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(`splitbill-name-${sessionId}`) || "";
}

function saveGuestName(sessionId: string, name: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(`splitbill-name-${sessionId}`, name);
  }
}

// ═══════════════════════════════════════════════════════════
// Client Component
// ═══════════════════════════════════════════════════════════

export default function GuestClaimClient({
  receipt,
  sessionId,
  originalQrString,
  sanitizedImageBase64,
}: {
  receipt: GuestClaimReceipt;
  sessionId: string;
  originalQrString: string;
  sanitizedImageBase64?: string;
}) {
  const { t } = useAppContext();
  const items: ReceiptItemDisplay[] = receipt.items;

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

  // ── Name Gate State ───────────────────────────────────
  const [guestName, setGuestName] = useState(() => getSavedGuestName(sessionId));
  const [nameInput, setNameInput] = useState("");
  const [nameSubmitted, setNameSubmitted] = useState(() => getSavedGuestName(sessionId).length > 0);

  // ── Claim State ───────────────────────────────────────
  const [claims, setClaims] = useState<Record<string, number>>({});
  const [othersTotals, setOthersTotals] = useState<Record<string, number>>({});
  // Split claims: itemId → Set of guestIds sharing
  const [splitClaims, setSplitClaims] = useState<Record<string, Set<string>>>({});
  const [mySplits, setMySplits] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [copiedProof, setCopiedProof] = useState(false);

  const pendingSyncsRef = useRef(0);

  const guestIdRef = useRef<string>("");
  if (guestIdRef.current === "") {
    guestIdRef.current = getOrCreateGuestId(sessionId);
  }
  const guestId = guestIdRef.current;

  // ── Name Gate Submit ──────────────────────────────────
  const handleNameSubmit = () => {
    const trimmed = nameInput.trim();
    if (trimmed.length === 0) return;
    setGuestName(trimmed);
    setNameSubmitted(true);
    saveGuestName(sessionId, trimmed);
  };

  // ── Server Sync: POST claim changes ───────────────────
  const syncClaim = useCallback(
    async (itemId: string, quantity: number, mode: "exclusive" | "split" = "exclusive") => {
      pendingSyncsRef.current += 1;
      try {
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, guestId, itemId, quantity, mode, guestName }),
        });
        if (res.status === 409) {
          const data = await res.json();
          setConflictMsg(data.error ?? "Item no longer available.");
          setTimeout(() => setConflictMsg(null), 3000);
          await pollClaims();
          return false;
        }
        if (!res.ok) {
          console.error("Claim sync failed:", res.status);
        }
        return true;
      } catch (err) {
        console.error("Claim sync error:", err);
        return true;
      } finally {
        pendingSyncsRef.current -= 1;
      }
    },
    [sessionId, guestId, guestName],
  );

  // ── Server Sync: Poll ─────────────────────────────────
  const pollClaims = useCallback(async () => {
    if (pendingSyncsRef.current > 0) return;
    try {
      const res = await fetch(`/api/claim?sessionId=${sessionId}`);
      if (!res.ok) return;
      const { claims: raw } = await res.json();
      if (!raw) return;

      const myNew: Record<string, number> = {};
      const othersNew: Record<string, number> = {};
      const splitNew: Record<string, Set<string>> = {};
      const mySplitNew = new Set<string>();

      for (const [field, value] of Object.entries(raw)) {
        // Skip name entries
        if (field.startsWith("name:")) continue;

        if (field.startsWith("split:")) {
          // Parse: split:itemId:guestId
          const rest = field.substring(6); // after "split:"
          const sepIdx = rest.lastIndexOf(":");
          if (sepIdx === -1) continue;
          const itemId = rest.substring(0, sepIdx);
          const claimGuestId = rest.substring(sepIdx + 1);

          if (!splitNew[itemId]) splitNew[itemId] = new Set();
          splitNew[itemId].add(claimGuestId);

          if (claimGuestId === guestId) {
            mySplitNew.add(itemId);
          }
        } else {
          // Parse: itemId:guestId (exclusive claim)
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
      }

      setClaims(myNew);
      setOthersTotals(othersNew);
      setSplitClaims(splitNew);
      setMySplits(mySplitNew);
    } catch {
      // Polling failure is non-fatal
    }
  }, [sessionId, guestId]);

  useEffect(() => {
    if (!nameSubmitted) return;
    pollClaims();
    const interval = setInterval(pollClaims, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollClaims, nameSubmitted]);

  useEffect(() => {
    if (!conflictMsg) return;
    const timer = setTimeout(() => setConflictMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [conflictMsg]);

  // ── Claim Handlers ────────────────────────────────────
  const toggleSingleItem = useCallback(
    (itemId: string) => {
      // If currently splitting this item, remove split first
      if (mySplits.has(itemId)) {
        setMySplits((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
        syncClaim(itemId, 0, "split");
      }

      const isClaimed = !!claims[itemId];
      const newQty = isClaimed ? 0 : 1;

      setClaims((prev) => {
        const next = { ...prev };
        if (newQty === 0) delete next[itemId];
        else next[itemId] = 1;
        return next;
      });

      syncClaim(itemId, newQty, "exclusive");
    },
    [claims, mySplits, syncClaim],
  );

  const toggleSplitItem = useCallback(
    (itemId: string) => {
      // If exclusively claimed, remove exclusive first
      if (claims[itemId]) {
        setClaims((prev) => { const n = { ...prev }; delete n[itemId]; return n; });
        syncClaim(itemId, 0, "exclusive");
      }

      const isSplit = mySplits.has(itemId);
      if (isSplit) {
        setMySplits((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
        syncClaim(itemId, 0, "split");
      } else {
        setMySplits((prev) => new Set(prev).add(itemId));
        syncClaim(itemId, 1, "split");
      }
    },
    [claims, mySplits, syncClaim],
  );

  const adjustClaim = useCallback(
    (itemId: string, maxQty: number, delta: number) => {
      const current = claims[itemId] ?? 0;
      const othersQty = othersTotals[itemId] ?? 0;
      const effectiveMax = maxQty - othersQty;
      const next = Math.max(0, Math.min(effectiveMax, current + delta));

      setClaims((prev) => {
        const updated = { ...prev };
        if (next === 0) delete updated[itemId];
        else updated[itemId] = next;
        return updated;
      });

      syncClaim(itemId, next, "exclusive");
    },
    [claims, othersTotals, syncClaim],
  );

  // ── Total Calculation ─────────────────────────────────
  const userTotal = useMemo(() => {
    const activeExclusive = Object.entries(claims).filter(([, qty]) => qty > 0);
    const activeSplits = [...mySplits];

    if (activeExclusive.length === 0 && activeSplits.length === 0) return 0;

    try {
      const allClaims: (UserClaim | FractionalClaim)[] = [];

      // Exclusive claims
      for (const [itemId, qty] of activeExclusive) {
        const item = items.find((i) => i.id === itemId);
        if (!item) continue;
        if (item.quantity === 1) {
          allClaims.push({ userId: "guest", itemId });
        } else {
          for (let i = 0; i < qty; i++) {
            allClaims.push({ userId: "guest", itemId });
          }
        }
      }

      // Fractional claims
      for (const itemId of activeSplits) {
        const totalSharers = (splitClaims[itemId]?.size) ?? 1;
        allClaims.push({
          userId: "guest",
          itemId,
          shares: 1,
          totalSharers,
        } as FractionalClaim);

        // Add phantom sharers for the remaining splits
        for (let i = 1; i < totalSharers; i++) {
          allClaims.push({
            userId: `sharer-${i}`,
            itemId,
            shares: 1,
            totalSharers,
          } as FractionalClaim);
        }
      }

      // Fill unclaimed items with "others" so reconciliation passes
      for (const item of items) {
        const guestQty = claims[item.id] ?? 0;
        const isSplit = mySplits.has(item.id);
        const hasSplitClaims = splitClaims[item.id] && splitClaims[item.id].size > 0;

        if (isSplit) {
          // Already handled by fractional claims above (I am part of it)
          continue;
        }
        if (hasSplitClaims) {
          // I am NOT part of the split, but others are. Assign to 'others' so math reconciles.
          const splitSharers = splitClaims[item.id]?.size ?? 1;
          for (let i = 0; i < splitSharers; i++) {
            allClaims.push({
              userId: "others",
              itemId: item.id,
              shares: 1,
              totalSharers: splitSharers,
            } as FractionalClaim);
          }
          continue;
        }

        const remaining = item.quantity - guestQty;
        if (remaining > 0 && item.quantity > 1) {
          for (let i = 0; i < remaining; i++) {
            allClaims.push({ userId: "others", itemId: item.id });
          }
        } else if (guestQty === 0) {
          allClaims.push({ userId: "others", itemId: item.id });
        }
      }

      const result = calculateSplit(mathReceipt, allClaims);
      return result["guest"] ?? 0;
    } catch {
      return 0;
    }
  }, [claims, mySplits, splitClaims, items, mathReceipt]);

  // ── QR Payload ────────────────────────────────────────
  const qrPayload = useMemo(() => {
    if (userTotal <= 0) return "";
    return modifyEMVCoPayload(originalQrString, userTotal);
  }, [userTotal, originalQrString]);

  const breakdown = useMemo(() => {
    if (userTotal <= 0 || receipt.grandTotalInCents <= 0)
      return { subtotal: 0, tax: 0, service: 0, total: 0 };
    const subtotal = Math.floor((userTotal * receipt.subtotalInCents) / receipt.grandTotalInCents);
    const tax = Math.floor((userTotal * receipt.taxInCents) / receipt.grandTotalInCents);
    const service = userTotal - subtotal - tax;
    return { subtotal, tax, service, total: userTotal };
  }, [userTotal, receipt]);

  const hasItems = Object.keys(claims).length > 0 || mySplits.size > 0;

  // ── Handlers ──────────────────────────────────────────
  const downloadQR = () => {
    const canvas = document.getElementById("duitnow-qr") as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = "split-bill-payment.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyAmount = useCallback(async () => {
    try {
      await navigator.clipboard.writeText((userTotal / 100).toFixed(2));
      setCopiedAmount(true);
      setTimeout(() => setCopiedAmount(false), 2000);
    } catch {}
  }, [userTotal]);

  const copyProof = useCallback(async () => {
    try {
      const activeItems = items.filter((i) => claims[i.id] > 0 || mySplits.has(i.id));
      const itemsList = activeItems.map((i) => {
        if (mySplits.has(i.id)) {
          const sharers = splitClaims[i.id]?.size ?? 1;
          return `${i.name} (split ${sharers}-way)`;
        }
        return `${i.name} (${claims[i.id]}x)`;
      }).join(", ");
      const text = `SplitBill: ${guestName} paying RM ${(userTotal / 100).toFixed(2)} for ${itemsList} via DuitNow.`;
      await navigator.clipboard.writeText(text);
      setCopiedProof(true);
      setTimeout(() => setCopiedProof(false), 2000);
    } catch {}
  }, [userTotal, claims, items, mySplits, splitClaims, guestName]);

  // ── Bookmark ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !nameSubmitted) return;
    try {
      const existingStr = localStorage.getItem("pending_bills");
      let bills: Array<{ sessionId: string; merchantName: string; originalQrString: string; userTotal: number }> = [];
      if (existingStr) bills = JSON.parse(existingStr);
      const idx = bills.findIndex((b) => b.sessionId === sessionId);
      if (userTotal > 0) {
        const payload = { sessionId, merchantName: receipt.merchantName, originalQrString, userTotal };
        if (idx !== -1) bills[idx] = payload;
        else bills.push(payload);
      } else {
        if (idx !== -1) bills.splice(idx, 1);
      }
      localStorage.setItem("pending_bills", JSON.stringify(bills));
    } catch {}
  }, [sessionId, receipt.merchantName, originalQrString, userTotal, nameSubmitted]);

  // ═══════════════════════════════════════════════════════
  // Render — Name Gate
  // ═══════════════════════════════════════════════════════

  if (!nameSubmitted) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-themed flex flex-col items-center justify-center px-5">
        <ToggleBar />

        <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ChefHat className="w-8 h-8 text-white" />
        </div>

        <h1 className="text-2xl font-bold text-primary-themed mb-1">
          {receipt.merchantName}
        </h1>
        <p className="text-sm text-secondary-themed mb-8 text-center">
          {t.whatsYourName}
        </p>

        <div className="w-full mb-4">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
            placeholder={t.namePlaceholder}
            className="w-full px-4 py-4 rounded-2xl border-2 border-themed bg-card-themed text-primary-themed text-lg font-semibold text-center focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981] outline-none transition-all placeholder:text-muted-themed"
            autoFocus
          />
          <p className="text-xs text-secondary-themed mt-2 text-center">
            {t.enterYourName}
          </p>
        </div>

        <button
          onClick={handleNameSubmit}
          disabled={nameInput.trim().length === 0}
          className={`
            w-full py-4 rounded-2xl text-white font-bold text-lg
            flex items-center justify-center gap-2 transition-all duration-200
            ${nameInput.trim().length > 0
              ? "bg-[#10B981] active:bg-emerald-600 shadow-lg shadow-emerald-500/20"
              : "bg-slate-400 cursor-not-allowed"
            }
          `}
        >
          <ArrowRight className="w-5 h-5" />
          {t.joinBill}
        </button>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // Render — Main Claim UI
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-md mx-auto min-h-screen bg-themed relative pb-32">
      <ToggleBar />

      {/* Conflict Banner */}
      {conflictMsg && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center p-3">
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-600 px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 max-w-md w-full text-sm font-medium animate-[slideDown_0.3s_ease-out]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {conflictMsg}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-5 pt-8 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#10B981] flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary-themed">
                {receipt.merchantName}
              </h1>
              <p className="text-sm text-secondary-themed">{receipt.date}</p>
            </div>
          </div>

          {/* View Receipt Button */}
          {sanitizedImageBase64 && (
            <button
              onClick={() => setShowReceiptModal(true)}
              className="w-10 h-10 rounded-xl bg-card-themed border border-themed flex items-center justify-center text-secondary-themed hover:text-primary-themed transition-all shadow-card-themed"
              aria-label={t.viewReceipt}
            >
              <ImageIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <p className="text-sm text-secondary-themed leading-relaxed flex-1">
            {t.selectWhatYouAte}
          </p>
          <span className="shrink-0 px-3 py-1 rounded-lg bg-[#10B981]/10 text-[#10B981] text-xs font-bold">
            {guestName}
          </span>
        </div>
      </header>

      {/* Receipt Summary */}
      <div className="mx-5 mb-4 p-4 bg-card-themed rounded-2xl shadow-card-themed border border-themed">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-4 h-4 text-secondary-themed" />
          <span className="text-xs font-semibold text-secondary-themed uppercase tracking-wider">
            {t.billSummary}
          </span>
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-secondary-themed">{t.subtotal}</span>
            <span className="text-primary-themed font-medium">{formatRM(receipt.subtotalInCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary-themed">{t.sst6}</span>
            <span className="text-primary-themed font-medium">{formatRM(receipt.taxInCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary-themed">{t.serviceCharge10}</span>
            <span className="text-primary-themed font-medium">{formatRM(receipt.serviceChargeInCents)}</span>
          </div>
          <div className="border-t border-themed pt-2 mt-2 flex justify-between">
            <span className="font-semibold text-primary-themed">{t.grandTotal}</span>
            <span className="font-bold text-primary-themed">{formatRM(receipt.grandTotalInCents)}</span>
          </div>
        </div>
      </div>

      {/* Item Cards (Grouped by Section) */}
      <div className="px-5 space-y-3">
        <span className="text-xs font-semibold text-secondary-themed uppercase tracking-wider">
          {t.selectYourItems}
        </span>

        {Array.from(groupItemsBySection(items, t.general)).map(([sectionLabel, sectionItems]) => (
          <div key={sectionLabel} className="space-y-2">
            <div className="flex items-center gap-2 pt-3 pb-1">
              <span className="text-xs font-bold text-primary-themed uppercase tracking-wider bg-elevated-themed px-3 py-1.5 rounded-lg">
                🍽 {sectionLabel}
              </span>
              <div className="flex-1 border-t border-themed" />
            </div>

            {sectionItems.map((item) => {
              const claimed = claims[item.id] ?? 0;
              const othersQty = othersTotals[item.id] ?? 0;
              const remaining = item.quantity - claimed - othersQty;
              const isSingle = item.quantity === 1;
              const isSelected = claimed > 0;
              const isSplitting = mySplits.has(item.id);
              const splitSharers = splitClaims[item.id]?.size ?? 0;
              const isTakenByOthers = isSingle && othersQty >= 1 && claimed === 0 && !isSplitting && splitSharers === 0;

              return (
                <div
                  key={item.id}
                  className={`
                    bg-card-themed rounded-2xl p-4 shadow-card-themed border-2 transition-all duration-200
                    ${isSelected || isSplitting
                      ? "border-[#10B981] shadow-[0_0_0_1px_rgba(16,185,129,0.1)]"
                      : isTakenByOthers
                      ? "border-transparent opacity-50"
                      : "border-transparent"
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-4">
                      <p className="font-semibold text-primary-themed truncate">
                        {item.name}
                      </p>
                      <p className="text-sm text-secondary-themed mt-0.5">
                        {formatRM(item.priceInCents)}
                        {item.quantity > 1 && (
                          <span className="ml-1">
                            · {remaining} {t.of} {item.quantity} {t.available}
                          </span>
                        )}
                        {isTakenByOthers && (
                          <span className="ml-1 text-amber-500">· {t.claimed}</span>
                        )}
                      </p>

                      {/* Split info badge */}
                      {isSplitting && splitSharers > 0 && (
                        <p className="text-xs text-[#10B981] font-semibold mt-1 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {splitSharers} {t.peopleSharingPrefix} {formatRM(Math.floor(item.priceInCents / splitSharers))} {t.eachSuffix}
                        </p>
                      )}
                    </div>

                    {isSingle ? (
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Exclusive claim toggle */}
                        <button
                          onClick={() => toggleSingleItem(item.id)}
                          disabled={isTakenByOthers}
                          className={`
                            w-8 h-8 rounded-full border-2 flex items-center justify-center
                            transition-all duration-200
                            ${isSelected
                              ? "bg-[#10B981] border-[#10B981]"
                              : isTakenByOthers
                              ? "border-themed bg-elevated-themed cursor-not-allowed"
                              : "border-[#64748B] bg-transparent"
                            }
                          `}
                          aria-label={`Toggle ${item.name}`}
                        >
                          {isSelected && (
                            <Check className="w-4 h-4 text-white" strokeWidth={3} />
                          )}
                        </button>

                        {/* Split toggle */}
                        <button
                          onClick={() => toggleSplitItem(item.id)}
                          className={`
                            w-8 h-8 rounded-full border-2 flex items-center justify-center
                            transition-all duration-200
                            ${isSplitting
                              ? "bg-purple-500 border-purple-500 text-white"
                              : "border-purple-300 text-purple-400 hover:border-purple-500"
                            }
                          `}
                          aria-label={`Split ${item.name}`}
                          title={t.splitWithOthers}
                        >
                          <Users className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => adjustClaim(item.id, item.quantity, -1)}
                          disabled={claimed === 0}
                          className={`
                            w-8 h-8 rounded-full flex items-center justify-center
                            border-2 transition-all duration-200
                            ${claimed === 0
                              ? "border-themed text-muted-themed cursor-not-allowed"
                              : "border-[#FC7C78] text-[#FC7C78] active:bg-red-500/10"
                            }
                          `}
                          aria-label={`Remove one ${item.name}`}
                        >
                          <Minus className="w-4 h-4" strokeWidth={3} />
                        </button>

                        <span className={`w-6 text-center font-bold text-lg ${claimed > 0 ? "text-primary-themed" : "text-muted-themed"}`}>
                          {claimed}
                        </span>

                        <button
                          onClick={() => adjustClaim(item.id, item.quantity, +1)}
                          disabled={remaining <= 0}
                          className={`
                            w-8 h-8 rounded-full flex items-center justify-center
                            border-2 transition-all duration-200
                            ${remaining <= 0
                              ? "border-themed text-muted-themed cursor-not-allowed"
                              : "border-[#10B981] text-[#10B981] active:bg-emerald-500/10"
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
        ))}
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 w-full max-w-md bg-card-themed p-4 shadow-elevated-themed rounded-t-2xl z-40 border-t border-themed">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-secondary-themed">{t.yourTotal}</span>
          <span className="text-3xl font-bold text-primary-themed">{formatRM(userTotal)}</span>
        </div>

        <button
          onClick={() => setShowModal(true)}
          disabled={!hasItems || userTotal <= 0}
          className={`
            w-full py-4 rounded-2xl text-white font-bold text-lg
            transition-all duration-200 flex items-center justify-center gap-2 mb-3
            ${hasItems && userTotal > 0
              ? "bg-[#10B981] active:bg-emerald-600 shadow-lg shadow-emerald-500/20"
              : "bg-slate-400 cursor-not-allowed"
            }
          `}
        >
          <QrCode className="w-5 h-5" />
          {t.pay} {formatRM(userTotal)}
        </button>

        <Link
          href="/pay"
          className="w-full py-3.5 rounded-xl border-2 border-themed text-secondary-themed font-semibold flex items-center justify-center gap-2 hover:bg-elevated-themed transition-colors no-underline"
        >
          <CreditCard className="w-4 h-4" />
          {t.viewAllPendingBills}
        </Link>
      </div>

      {/* ── Receipt Preview Modal ────────────────────────── */}
      {showReceiptModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setShowReceiptModal(false)}
        >
          <div className="absolute inset-0" style={{ backgroundColor: 'var(--bg-modal-overlay)' }} />
          <div
            className="relative w-full max-w-md bg-card-themed rounded-t-3xl p-6 animate-[slideUp_0.3s_ease-out] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowReceiptModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-elevated-themed flex items-center justify-center text-secondary-themed hover:text-primary-themed transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-xl font-bold text-primary-themed mb-4">{t.viewReceipt}</h2>

            {sanitizedImageBase64 ? (
              <>
                <div className="rounded-2xl overflow-hidden border border-themed mb-4">
                  <img
                    src={`data:image/jpeg;base64,${sanitizedImageBase64}`}
                    alt="Receipt"
                    className="w-full h-auto"
                  />
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-2 items-start">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-600 font-medium">{t.receiptDisclaimer}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-secondary-themed">{t.noReceiptImage}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Settlement Modal ─────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setShowModal(false)}
        >
          <div className="absolute inset-0 backdrop-blur-sm" style={{ backgroundColor: 'var(--bg-modal-overlay)' }} />
          <div
            className="relative w-full max-w-md bg-card-themed rounded-t-3xl p-6 animate-[slideUp_0.3s_ease-out] max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-elevated-themed flex items-center justify-center text-secondary-themed hover:text-primary-themed transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-primary-themed">{t.scanToPay}</h2>
              <p className="text-sm text-secondary-themed mt-1">DuitNow QR · {receipt.merchantName}</p>
            </div>

            <div className="flex justify-center mb-6">
              <div className="bg-white p-5 rounded-2xl shadow-card-themed border border-themed">
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

            <div className="bg-blue-500/10 p-3 rounded-xl mb-4 flex gap-3 items-start border border-blue-500/20">
              <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium leading-snug">{t.bankSecurityNote}</p>
            </div>

            <div className="bg-elevated-themed rounded-2xl p-4 mb-5">
              <span className="text-xs font-semibold text-secondary-themed uppercase tracking-wider">{t.yourShareBreakdown}</span>
              <div className="space-y-2 mt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-secondary-themed">{t.subtotal}</span>
                  <span className="text-primary-themed font-medium">{formatRM(breakdown.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-themed">{t.sst6}</span>
                  <span className="text-primary-themed font-medium">{formatRM(breakdown.tax)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-themed">{t.serviceCharge10}</span>
                  <span className="text-primary-themed font-medium">{formatRM(breakdown.service)}</span>
                </div>
                <div className="border-t border-themed pt-2 mt-2 flex justify-between items-center">
                  <span className="font-bold text-primary-themed">{t.totalToPay}</span>
                  <div className="flex items-center gap-2">
                    {copiedAmount && (
                      <span className="text-xs font-bold text-[#10B981] animate-[fadeIn_0.2s]">{t.copied}</span>
                    )}
                    <button
                      onClick={copyAmount}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 transition-colors"
                    >
                      <span className="text-xl font-bold">{formatRM(breakdown.total)}</span>
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-secondary-themed text-center mb-4">{t.openBankingApp}</p>

            <button
              onClick={downloadQR}
              className="w-full py-3.5 rounded-2xl bg-[#10B981] text-white font-semibold flex items-center justify-center gap-2 transition-all active:bg-emerald-600"
            >
              <Download className="w-4 h-4" />
              {t.saveQrToGallery}
            </button>

            <button
              onClick={copyProof}
              className="w-full mt-3 py-3.5 rounded-2xl bg-elevated-themed text-primary-themed font-semibold flex items-center justify-center gap-2 hover:bg-card-themed transition-all"
            >
              <Copy className="w-4 h-4" />
              {copiedProof ? t.copiedToClipboard : t.copyClaimSummary}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Need this import in the name gate render
function ArrowRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}
