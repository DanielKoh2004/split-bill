"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Copy,
  ArrowRight,
  Camera,
  Loader2,
  Pencil,
  Trash2,
  Tag,
  Settings,
  Server,
  Users,
  Image as ImageIcon,
} from "lucide-react";
import Link from "next/link";
import { parseQRImage } from "@/src/duitnowQR";
import { sanitizeImage, blobToBase64 } from "@/src/privacy";
import { useAppContext } from "@/src/ThemeContext";
import ToggleBar from "@/app/components/ToggleBar";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type FlowState = "idle" | "loading" | "review" | "success" | "error";

interface ReviewItem {
  id: string;
  name: string;
  priceInCents: number;
}

interface ReviewReceipt {
  merchantName: string;
  date: string;
  items: ReviewItem[];
  subtotalInCents: number;
  taxInCents: number;
  serviceChargeInCents: number;
  grandTotalInCents: number;
}

interface LastSession {
  sessionId: string;
  timestamp: number;
}

function getLastSession(): LastSession | null {
  if (typeof window === "undefined") return null;
  const data = localStorage.getItem("last_active_session");
  if (!data) return null;
  try {
    return JSON.parse(data) as LastSession;
  } catch {
    return null;
  }
}

function formatRM(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

// ═══════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════

export default function HostUploadPage() {
  const { t } = useAppContext();

  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<FlowState>("idle");
  const [sessionId, setSessionId] = useState<string>("");
  const [mergeSessionId, setMergeSessionId] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [originalQrString, setOriginalQrString] = useState<string>("");
  const [qrUploaded, setQrUploaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSessionId, setCopiedSessionId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  // ── Review State ────────────────────────────────────────
  const [reviewReceipt, setReviewReceipt] = useState<ReviewReceipt | null>(null);
  const [sectionName, setSectionName] = useState<string>("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [isFinalizingReview, setIsFinalizingReview] = useState(false);
  
  // Privacy features
  const [sanitizedImageBase64, setSanitizedImageBase64] = useState<string>("");
  const [includeReceiptPreview, setIncludeReceiptPreview] = useState(false);

  // ── Host Continuity ─────────────────────────────────────
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // ── Live Dashboard State ────────────────────────────────
  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [isWiping, setIsWiping] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedInfo = localStorage.getItem("duitnow_original_qr");
    if (savedInfo) {
      setOriginalQrString(savedInfo);
      setQrUploaded(true);
    }
    setLastSession(getLastSession());
  }, []);

  // Poll live status if idle and has lastSession
  useEffect(() => {
    if (state !== "idle" || !lastSession || !originalQrString) return;

    let isSubscribed = true;

    async function poll() {
      try {
        const res = await fetch(`/api/session/status?sessionId=${lastSession?.sessionId}`, {
          headers: {
            "x-qr-proof": originalQrString,
          },
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 403) {
            // Session gone or invalid proof
            setLiveStatus(null);
          }
          return;
        }
        const data = await res.json();
        if (isSubscribed) setLiveStatus(data);
      } catch (e) {
        // ignore
      }
    }

    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      isSubscribed = false;
      clearInterval(timer);
    };
  }, [state, lastSession, originalQrString]);

  const shareUrl =
    typeof window !== "undefined" && sessionId
      ? `${window.location.origin}/split/${sessionId}`
      : "";

  // ── Handle QR selection ────────────────────────────────
  const handleQRChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg("");
    try {
      const payload = await parseQRImage(file);
      if (!payload || payload.length < 50) {
        throw new Error("Invalid format. Please ensure you upload a valid DuitNow QR.");
      }
      setOriginalQrString(payload);
      setQrUploaded(true);
      localStorage.setItem("duitnow_original_qr", payload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to parse DuitNow QR.");
      setQrUploaded(false);
    }
  };

  const handleChangeAccount = () => {
    setOriginalQrString("");
    setQrUploaded(false);
    localStorage.removeItem("duitnow_original_qr");
    if (qrInputRef.current) qrInputRef.current.value = "";
  };

  // ── Handle file selection → Upload Phase 1 ────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setState("loading");
      setErrorMsg("");

      try {
        const sanitizedBlob = await sanitizeImage(file);
        const base64 = await blobToBase64(sanitizedBlob);
        
        // Save for the finalize phase
        setSanitizedImageBase64(base64);

        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        setReviewReceipt(data.enrichedReceipt as ReviewReceipt);
        setSectionName("");
        setIncludeReceiptPreview(false); // default off!
        setState("review");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setErrorMsg(msg);
        setState("error");
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [],
  );

  // ── Review: Edit item ─────────────────────────────────
  const startEditItem = (item: ReviewItem) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditPrice((item.priceInCents / 100).toFixed(2));
  };

  const saveEditItem = () => {
    if (!reviewReceipt || !editingItemId) return;

    const newPriceCents = Math.round(parseFloat(editPrice) * 100);
    if (isNaN(newPriceCents)) return;

    const updatedItems = reviewReceipt.items.map((item) =>
      item.id === editingItemId
        ? { ...item, name: editName.trim() || item.name, priceInCents: newPriceCents }
        : item
    );

    const newSubtotal = updatedItems.reduce((sum, i) => sum + i.priceInCents, 0);
    const newGrandTotal = newSubtotal + reviewReceipt.taxInCents + reviewReceipt.serviceChargeInCents;

    setReviewReceipt({
      ...reviewReceipt,
      items: updatedItems,
      subtotalInCents: newSubtotal,
      grandTotalInCents: newGrandTotal,
    });

    setEditingItemId(null);
    setEditName("");
    setEditPrice("");
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditName("");
    setEditPrice("");
  };

  const removeItem = (itemId: string) => {
    if (!reviewReceipt) return;
    const updatedItems = reviewReceipt.items.filter((i) => i.id !== itemId);
    if (updatedItems.length === 0) return;

    const newSubtotal = updatedItems.reduce((sum, i) => sum + i.priceInCents, 0);
    const newGrandTotal = newSubtotal + reviewReceipt.taxInCents + reviewReceipt.serviceChargeInCents;

    setReviewReceipt({
      ...reviewReceipt,
      items: updatedItems,
      subtotalInCents: newSubtotal,
      grandTotalInCents: newGrandTotal,
    });
  };

  // ── Review: Finalize → Phase 2 ────────────────────────
  const handleFinalize = async () => {
    if (!reviewReceipt) return;

    setIsFinalizingReview(true);
    setErrorMsg("");

    try {
      const section = sectionName.trim() || undefined;
      const receiptToSend = {
        ...reviewReceipt,
        items: reviewReceipt.items.map((item) => ({
          ...item,
          ...(section ? { sectionName: section } : {}),
        })),
      };

      const newSubtotal = receiptToSend.items.reduce((sum, i) => sum + i.priceInCents, 0);
      receiptToSend.subtotalInCents = newSubtotal;
      receiptToSend.grandTotalInCents = newSubtotal + receiptToSend.taxInCents + receiptToSend.serviceChargeInCents;

      const res = await fetch("/api/session/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receipt: receiptToSend,
          originalQrString,
          mergeSessionId: mergeSessionId.trim() || undefined,
          imageBase64: includeReceiptPreview ? sanitizedImageBase64 : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Finalize failed");
      }

      setSessionId(data.sessionId);

      const sessionInfo: LastSession = {
        sessionId: data.sessionId,
        timestamp: Date.now(),
      };
      localStorage.setItem("last_active_session", JSON.stringify(sessionInfo));
      setLastSession(sessionInfo);

      setState("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(msg);
      setState("error");
    } finally {
      setIsFinalizingReview(false);
    }
  };

  // ── Copy handlers ──────────────────────────────────────
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  const handleCopySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedSessionId(true);
      setTimeout(() => setCopiedSessionId(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // ── Reset to upload again ──────────────────────────────
  const handleReset = () => {
    setState("idle");
    setSessionId("");
    setMergeSessionId("");
    setErrorMsg("");
    setCopied(false);
    setCopiedSessionId(false);
    setReviewReceipt(null);
    setSectionName("");
    setEditingItemId(null);
    setIsFinalizingReview(false);
    setLiveStatus(null);
  };

  // ── Clear All Sessions ─────────────────────────────────
  const handleClearAll = () => {
    localStorage.removeItem("last_active_session");
    localStorage.removeItem("duitnow_original_qr");
    localStorage.removeItem("pending_bills");
    setLastSession(null);
    setOriginalQrString("");
    setQrUploaded(false);
    setShowSettings(false);
    setLiveStatus(null);
    if (qrInputRef.current) qrInputRef.current.value = "";
  };

  // ── Use Last Session shortcut ─────────────────────────
  const handleUseLastSession = () => {
    if (lastSession) {
      setMergeSessionId(lastSession.sessionId);
    }
  };

  // ── Wipe Session ──────────────────────────────────────
  const handleWipeSession = async () => {
    if (!lastSession) return;
    const ok = window.confirm(t.wipeConfirm);
    if (!ok) return;

    setIsWiping(true);
    try {
      const res = await fetch("/api/session/wipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-qr-proof": originalQrString,
        },
        body: JSON.stringify({ sessionId: lastSession.sessionId }),
      });
      if (!res.ok) throw new Error("Failed to wipe");
      
      localStorage.removeItem("last_active_session");
      setLastSession(null);
      setLiveStatus(null);
      alert(t.sessionWiped);
    } catch (e) {
      alert("Error wiping session.");
    } finally {
      setIsWiping(false);
    }
  };

  // ── Calculate Live Dashboard Stats ─────────────────────
  let totalClaimedCents = 0;
  let unclaimedItemsList: { name: string; qty: number; price: number }[] = [];
  const guestTotals = new Map<string, { name: string; sum: number }>();

  if (liveStatus && liveStatus.receipt && liveStatus.claims) {
    const claimsMap = liveStatus.claims;
    const items = liveStatus.receipt.items as { id: string; name: string; quantity: number; priceInCents: number }[];
    
    // Pass 1: find names
    const names = new Map<string, string>();
    for (const [key, val] of Object.entries(claimsMap)) {
      if (key.startsWith("name:")) {
        names.set(key.substring(5), val as string);
      }
    }

    // Pass 2: calculate items
    for (const item of items) {
      let claimedQty = 0;
      let splitSharers = 0;
      let isSplit = false;

      // Extract claims for this item
      const itemClaims = [];
      const itemSplits = [];
      
      for (const [key, val] of Object.entries(claimsMap)) {
        if (key.startsWith("name:")) continue;
        
        if (key.startsWith("split:" + item.id + ":")) {
          isSplit = true;
          itemSplits.push({ guestId: key.split(":")[2] });
          splitSharers++;
        } else if (key.startsWith(item.id + ":")) {
          const qty = Number(val);
          claimedQty += qty;
          itemClaims.push({ guestId: key.split(":")[1], qty });
        }
      }

      const price = item.priceInCents;
      let costPerUnit = price;
      
      if (isSplit && splitSharers > 0) {
        costPerUnit = Math.floor(price / splitSharers);
        // allocate
        for (const s of itemSplits) {
          totalClaimedCents += costPerUnit;
          const prev = guestTotals.get(s.guestId)?.sum || 0;
          const gName = names.get(s.guestId) || `Guest ${s.guestId.substring(0, 4)}`;
          guestTotals.set(s.guestId, { name: gName, sum: prev + costPerUnit });
        }
      } else {
        // exclusive
        if (item.quantity > 1) {
          costPerUnit = Math.floor(price / item.quantity);
        }
        for (const c of itemClaims) {
          const sumCost = costPerUnit * c.qty;
          totalClaimedCents += sumCost;
          const prev = guestTotals.get(c.guestId)?.sum || 0;
          const gName = names.get(c.guestId) || `Guest ${c.guestId.substring(0, 4)}`;
          guestTotals.set(c.guestId, { name: gName, sum: prev + sumCost });
        }
        
        const remaining = item.quantity - claimedQty;
        if (remaining > 0) {
          unclaimedItemsList.push({ name: item.name, qty: remaining, price: costPerUnit });
        }
      }
    }
  }

  const progressPercent = liveStatus?.receipt ? Math.min(100, Math.round((totalClaimedCents / liveStatus.receipt.subtotalInCents) * 100)) : 0;

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-md mx-auto min-h-screen bg-themed flex flex-col items-center justify-center px-5 relative">
      {/* ── Toggle Bar (Dark/Light + Language) ──────────── */}
      <ToggleBar />

      {/* Settings Button */}
      {state === "idle" && mounted && (
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="absolute top-5 right-5 w-10 h-10 rounded-xl bg-card-themed border border-themed flex items-center justify-center text-muted-themed hover:text-primary-themed transition-all shadow-card-themed"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      )}

      {/* Settings Dropdown */}
      {showSettings && (
        <div className="absolute top-16 right-5 bg-card-themed rounded-2xl shadow-elevated-themed border border-themed p-4 z-50 w-64 animate-[slideDown_0.2s_ease-out]">
          <p className="text-xs font-semibold text-muted-themed uppercase tracking-wider mb-3">
            {t.sessionControls}
          </p>
          <button
            onClick={handleClearAll}
            className="w-full py-3 px-4 rounded-xl bg-red-500/10 text-red-500 text-sm font-semibold hover:bg-red-500/20 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {t.clearAllSessions}
          </button>
          <p className="text-xs text-muted-themed mt-2 leading-relaxed">
            {t.clearAllDesc}
          </p>
        </div>
      )}

      {/* Click-away to close settings */}
      {showSettings && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowSettings(false)}
        />
      )}

      {/* Inline Error Notice */}
      {state === "idle" && errorMsg && (
        <div className="absolute top-10 left-5 right-5 bg-red-500/10 text-red-500 text-sm font-semibold p-4 rounded-xl shadow-sm text-center border border-red-500/20 flex items-center justify-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {errorMsg}
        </div>
      )}

      {/* ── IDLE: Upload State ─────────────────────────── */}
      {state === "idle" && (
        <div className="w-full text-center py-10">
          {/* Resume Current Session Badge */}
          {mounted && lastSession && (
            <Link
              href={`/split/${lastSession.sessionId}`}
              className="w-full mb-4 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold text-sm flex items-center justify-between shadow-lg shadow-emerald-200/50 hover:shadow-emerald-300/50 transition-all active:scale-[0.98] no-underline"
            >
              <span className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                {t.resumeCurrentSession}
              </span>
              <span className="font-mono text-xs opacity-80 bg-white/20 px-2 py-1 rounded-lg">
                {lastSession.sessionId}
              </span>
            </Link>
          )}

          {/* ── Live Dashboard ────────────────────────────── */}
          {mounted && liveStatus && (
            <div className="w-full bg-card-themed border-2 border-[#10B981] rounded-3xl shadow-[0_0_20px_rgba(16,185,129,0.15)] p-5 mb-8 text-left relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-[#10B981]/20">
                <div 
                  className="h-full bg-[#10B981] transition-all duration-1000 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between mb-4 mt-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="font-bold text-primary-themed">{t.liveDashboard}</h3>
                </div>
                <Link href={`/split/${lastSession?.sessionId}`} className="text-xs text-[#10B981] font-semibold hover:underline">
                  View link
                </Link>
              </div>

              {/* Progress */}
              <div className="mb-4 bg-elevated-themed p-3 rounded-xl border border-themed">
                <p className="text-xs text-secondary-themed uppercase tracking-wider font-semibold mb-1">{t.settlementProgress}</p>
                <div className="flex justify-between items-baseline">
                  <span className="text-xl font-bold text-primary-themed">{formatRM(totalClaimedCents)}</span>
                  <span className="text-sm text-secondary-themed">{t.of} {formatRM(liveStatus.receipt.subtotalInCents)} {t.claimedOf}</span>
                </div>
              </div>

              {/* Guest List */}
              {guestTotals.size > 0 ? (
                <div className="mb-4">
                  <p className="text-xs text-secondary-themed uppercase tracking-wider font-semibold mb-2">{t.guestList}</p>
                  <div className="space-y-2">
                    {Array.from(guestTotals.values()).map((g, i) => (
                      <div key={i} className="flex justify-between items-center bg-elevated-themed p-2.5 rounded-lg border border-themed">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-emerald-500" />
                          <span className="text-sm font-medium text-primary-themed">{g.name}</span>
                        </div>
                        <span className="text-sm font-bold text-primary-themed">{formatRM(g.sum)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-secondary-themed bg-elevated-themed p-3 rounded-xl border border-themed mb-4 text-center">
                  {t.noActivity}
                </p>
              )}

              {/* Unclaimed Items */}
              {unclaimedItemsList.length > 0 ? (
                <div className="mb-5">
                  <p className="text-xs text-amber-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {t.unclaimedItems}
                  </p>
                  <div className="space-y-1">
                    {unclaimedItemsList.map((u, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-secondary-themed truncate mr-2">{u.qty}x {u.name}</span>
                        <span className="text-primary-themed font-medium shrink-0">{formatRM(u.price * u.qty)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t.fullyClaimedBadge}
                </div>
              )}

              <button
                onClick={handleWipeSession}
                disabled={isWiping}
                className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm border border-red-500/20 hover:bg-red-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 mt-2"
              >
                {isWiping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                {isWiping ? t.wiping : t.wipeSession}
              </button>

            </div>
          )}

          <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Camera className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-primary-themed mb-2">
            {t.splitTheBill}
          </h1>
          <p className="text-sm text-secondary-themed mb-8 leading-relaxed">
            {t.uploadDesc}
          </p>

          {/* DuitNow QR Upload Section */}
          <div className="w-full mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-primary-themed text-left">
                {t.yourDuitNowQR}
              </label>
              {mounted && qrUploaded && (
                <button
                  type="button"
                  onClick={handleChangeAccount}
                  className="text-xs text-secondary-themed hover:text-primary-themed underline underline-offset-2 transition-colors"
                >
                  {t.changeAccount}
                </button>
              )}
            </div>

            {!qrUploaded ? (
              <>
                <input
                  ref={qrInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleQRChange}
                  className="hidden"
                  id="qr-upload"
                />
                <label
                  htmlFor="qr-upload"
                  className="block w-full py-4 rounded-xl border-2 transition-all duration-200 cursor-pointer flex items-center justify-center gap-3 bg-card-themed border-themed text-secondary-themed hover:border-[#10B981]/50"
                >
                  <UploadCloud className="w-5 h-5" />
                  <span className="font-semibold text-sm">
                    {t.uploadQRScreenshot}
                  </span>
                </label>
              </>
            ) : (
              <div className="w-full py-4 rounded-xl border-2 border-[#10B981] bg-[#10B981]/10 text-[#10B981] flex items-center justify-center gap-3 cursor-default">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold text-sm">
                  {t.savedDuitNowActive}
                </span>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={!qrUploaded}
            className="hidden"
            id="receipt-upload"
          />

          {/* Upload target area */}
          <label
            htmlFor={qrUploaded ? "receipt-upload" : undefined}
            onClick={() => {
              if (!qrUploaded) setErrorMsg(t.uploadQrFirst);
            }}
            className={`
              block w-full py-16 rounded-3xl border-2 border-dashed transition-all duration-200 mb-4
              ${qrUploaded
                ? "border-[#10B981] bg-[#10B981]/5 cursor-pointer hover:bg-[#10B981]/10 hover:border-[#059669] active:scale-[0.98]"
                : "border-themed bg-elevated-themed opacity-60 cursor-not-allowed"
              }
            `}
          >
            <Camera className={`w-10 h-10 mx-auto mb-3 ${qrUploaded ? "text-[#10B981]" : "text-muted-themed"}`} />
            <span className={`text-lg font-bold ${qrUploaded ? "text-[#10B981]" : "text-secondary-themed"}`}>
              {t.snapReceipt}
            </span>
            <span className="block text-xs text-secondary-themed mt-1">
              {t.exifStripped}
            </span>
          </label>

          {/* Merge Session Input */}
          <div className="w-full text-left mb-6">
            <label className="block text-xs font-semibold text-secondary-themed uppercase tracking-wider mb-2">
              {t.mergeWithExisting}
            </label>
            <input
              type="text"
              placeholder={t.pasteSessionId}
              value={mergeSessionId}
              onChange={(e) => setMergeSessionId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-themed bg-input-themed text-primary-themed text-sm focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981] outline-none transition-all placeholder:text-muted-themed"
            />
            {/* Use Last Session shortcut */}
            {mounted && lastSession && (
              <button
                onClick={handleUseLastSession}
                className="mt-2 px-3 py-1.5 rounded-lg bg-elevated-themed text-secondary-themed text-xs font-semibold hover:text-primary-themed transition-colors flex items-center gap-1.5"
              >
                <ArrowRight className="w-3 h-3" />
                {t.useLastSession} ({lastSession.sessionId})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── LOADING: AI Processing ────────────────────── */}
      {state === "loading" && (
        <div className="w-full text-center">
          <div className="w-16 h-16 bg-card-themed rounded-2xl flex items-center justify-center mx-auto mb-6 border border-themed">
            <Loader2 className="w-8 h-8 text-[#10B981] animate-spin" />
          </div>

          <h2 className="text-xl font-bold text-primary-themed mb-2">
            {t.aiCrunching}
          </h2>
          <p className="text-sm text-secondary-themed">
            {t.parsingReceipt}
          </p>

          <div className="flex items-center justify-center gap-2 mt-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-3 h-3 bg-[#10B981] rounded-full animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── REVIEW: Editable Receipt ──────────────────── */}
      {state === "review" && reviewReceipt && (
        <div className="w-full pb-8 pt-10">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-400">
              <Pencil className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-primary-themed mb-1">
              {t.reviewAndEdit}
            </h2>
            <p className="text-sm text-secondary-themed">
              {t.tapAnyItem}
            </p>
          </div>

          {/* Merchant & Date */}
          <div className="bg-card-themed rounded-2xl p-4 mb-4 border border-themed shadow-card-themed">
            <p className="text-lg font-bold text-primary-themed">{reviewReceipt.merchantName}</p>
            <p className="text-sm text-secondary-themed">{reviewReceipt.date}</p>
          </div>

          {/* Section Name Input */}
          <div className="mb-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-secondary-themed uppercase tracking-wider mb-2">
              <Tag className="w-3.5 h-3.5" />
              {t.sectionNameLabel}
            </label>
            <input
              type="text"
              placeholder={t.sectionPlaceholder}
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-themed bg-input-themed text-primary-themed text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all placeholder:text-muted-themed"
            />
          </div>

          {/* Editable Items */}
          <div className="space-y-2 mb-4">
            <span className="text-xs font-semibold text-secondary-themed uppercase tracking-wider">
              {t.items} ({reviewReceipt.items.length})
            </span>

            {reviewReceipt.items.map((item) => (
              <div
                key={item.id}
                className={`bg-card-themed rounded-xl p-4 border transition-all duration-200 ${
                  editingItemId === item.id
                    ? "border-amber-400 shadow-elevated-themed"
                    : "border-themed shadow-card-themed"
                }`}
              >
                {editingItemId === item.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-themed bg-input-themed text-primary-themed text-sm font-semibold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                      placeholder={t.itemName}
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-secondary-themed font-medium">RM</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-themed bg-input-themed text-primary-themed text-sm font-semibold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditItem}
                        className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
                      >
                        {t.save}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 py-2 rounded-lg bg-elevated-themed text-secondary-themed text-sm font-semibold hover:text-primary-themed transition-colors"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => startEditItem(item)}
                      className="flex-1 text-left min-w-0 mr-3"
                    >
                      <p className="font-semibold text-primary-themed truncate text-sm">
                        {item.name}
                      </p>
                      <p className="text-xs text-secondary-themed mt-0.5">
                        {formatRM(item.priceInCents)}
                        {item.quantity > 1 && ` · Qty: ${item.quantity}`}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEditItem(item)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-themed hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                        aria-label={`Edit ${item.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {reviewReceipt.items.length > 1 && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-themed hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Totals Summary */}
          <div className="bg-card-themed rounded-2xl p-4 mb-4 border border-themed shadow-card-themed">
            <span className="text-xs font-semibold text-secondary-themed uppercase tracking-wider">
              {t.totals}
            </span>
            <div className="space-y-1.5 mt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-secondary-themed">{t.subtotal}</span>
                <span className="text-primary-themed font-medium font-mono">
                  {formatRM(reviewReceipt.subtotalInCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary-themed">{t.sstTax}</span>
                <span className="text-primary-themed font-medium font-mono">
                  {formatRM(reviewReceipt.taxInCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary-themed">{t.serviceCharge}</span>
                <span className="text-primary-themed font-medium font-mono">
                  {formatRM(reviewReceipt.serviceChargeInCents)}
                </span>
              </div>
              <div className="border-t border-themed pt-2 mt-2 flex justify-between">
                <span className="font-bold text-primary-themed">{t.grandTotal}</span>
                <span className="font-bold text-primary-themed font-mono text-lg">
                  {formatRM(reviewReceipt.grandTotalInCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Privacy Toggle for Receipt Image */}
          <label className="flex items-start gap-3 p-4 rounded-2xl bg-card-themed border border-themed shadow-sm mb-6 cursor-pointer hover:bg-elevated-themed transition-colors">
            <div className="flex items-center h-5 mt-0.5">
              <input
                type="checkbox"
                checked={includeReceiptPreview}
                onChange={(e) => setIncludeReceiptPreview(e.target.checked)}
                className="w-5 h-5 rounded border-2 border-themed text-[#10B981] focus:ring-[#10B981] bg-input-themed"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary-themed flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-[#10B981]" />
                {t.includeReceiptPreview}
              </p>
              <p className="text-xs text-secondary-themed mt-1 leading-relaxed">
                {t.includeReceiptPreviewDesc}
              </p>
            </div>
          </label>

          {/* Finalize Button */}
          <button
            onClick={handleFinalize}
            disabled={isFinalizingReview}
            className={`
              w-full py-4 rounded-2xl text-white font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              shadow-lg mb-4
              ${isFinalizingReview
                ? "bg-slate-400 cursor-not-allowed"
                : "bg-[#10B981] active:bg-emerald-600 shadow-emerald-500/20 hover:shadow-emerald-500/30"
              }
            `}
          >
            {isFinalizingReview ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t.finalizing}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                {t.confirmAndGenerate}
              </>
            )}
          </button>

          <button
            onClick={handleReset}
            className="w-full text-sm text-secondary-themed underline underline-offset-2 py-2 hover:text-primary-themed transition-colors"
          >
            {t.startOver}
          </button>
        </div>
      )}

      {/* ── SUCCESS: Share Link ───────────────────────── */}
      {state === "success" && (
        <div className="w-full text-center pt-10">
          <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-8 h-8 text-white" />
          </div>

          <h2 className="text-2xl font-bold text-primary-themed mb-2">
            {t.readyToSplit}
          </h2>
          <p className="text-sm text-secondary-themed mb-8 px-4">
            {t.shareLinkDesc}
          </p>

          {/* URL Display */}
          <div className="bg-card-themed rounded-3xl p-5 mb-5 border border-themed shadow-card-themed relative">
            <p className="text-xs text-secondary-themed uppercase tracking-wider font-semibold mb-3">
              {t.shareLink}
            </p>
            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-mono break-all font-semibold select-all">
              {shareUrl}
            </p>
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="
              w-full py-4 rounded-2xl bg-card-themed text-primary-themed border-2 border-themed font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              hover:border-[#10B981] active:bg-elevated-themed shadow-card-themed mb-6
            "
          >
            <Copy className="w-5 h-5" />
            {copied ? t.copied : t.copyShareLink}
          </button>

          {/* Session ID for Merging */}
          <div className="bg-card-themed rounded-2xl p-4 mb-6 border border-themed shadow-card-themed text-left">
            <p className="text-xs text-secondary-themed uppercase tracking-wider font-semibold mb-3">
              {t.sessionIdForMerging}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-elevated-themed px-4 py-3 rounded-xl text-sm font-mono text-primary-themed font-bold tracking-wider border border-themed text-center">
                {sessionId}
              </code>
              <button
                onClick={handleCopySessionId}
                className="shrink-0 px-4 py-3 rounded-xl bg-elevated-themed text-secondary-themed text-sm font-semibold hover:text-primary-themed transition-colors border border-transparent hover:border-themed flex items-center justify-center"
              >
                {copiedSessionId ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-themed mt-3 leading-relaxed">
              {t.sessionIdNote}
            </p>
          </div>

          {/* Upload another */}
          <button
            onClick={handleReset}
            className="w-full text-sm text-secondary-themed underline underline-offset-2 py-3 hover:text-primary-themed transition-colors font-medium"
          >
            {t.uploadAnother}
          </button>
        </div>
      )}

      {/* ── ERROR: Retry ──────────────────────────────── */}
      {state === "error" && (
        <div className="w-full text-center pt-10">
          <div className="w-16 h-16 bg-[#FC7C78] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-red-500/20">
            <AlertCircle className="w-8 h-8 text-white" />
          </div>

          <h2 className="text-2xl font-bold text-primary-themed mb-2">
            {t.couldntParse}
          </h2>
          <p className="text-sm text-[#FC7C78] mb-8 px-4 font-medium">
            {errorMsg}
          </p>

          <button
            onClick={handleReset}
            className="
              w-full py-4 rounded-2xl bg-card-themed text-primary-themed border-2 border-themed font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              hover:border-[#FC7C78] active:bg-elevated-themed shadow-card-themed
            "
          >
            {t.tryAnotherPhoto}
          </button>
        </div>
      )}
    </div>
  );
}
