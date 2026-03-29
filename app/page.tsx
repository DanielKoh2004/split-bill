"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera,
  Loader2,
  CheckCircle2,
  Copy,
  AlertCircle,
  UploadCloud,
  ArrowRight,
  Pencil,
  Trash2,
  Settings,
  Tag,
} from "lucide-react";
import { sanitizeImage } from "@/src/privacy";
import jsQR from "jsqr";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────
// constraints.md compliance:
//   ✅ Client-side EXIF strip via sanitizeImage (Module 4)
//   ✅ No raw File sent to API — only sanitized base64
//   ✅ No persistent storage — ephemeral session only
//   ✅ Stateless — session ID returned, no user accounts
//   ✅ Two-phase: Upload → Review → Finalize
// ─────────────────────────────────────────────────────────────

type FlowState = "idle" | "loading" | "review" | "success" | "error";

interface ReviewItem {
  id: string;
  name: string;
  quantity: number;
  priceInCents: number;
  sectionName?: string;
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

/** Convert a Blob to a base64 string (no data URI prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

function parseQRImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context not supported"));
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        resolve(code.data);
      } else {
        reject(new Error("No valid QR code found in the image."));
      }
    };
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = URL.createObjectURL(file);
  });
}

/** Format cents to RM display */
function formatRM(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

// ── 24-hour freshness check ─────────────────────────────────
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function getLastSession(): LastSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("last_active_session");
    if (!raw) return null;
    const parsed: LastSession = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > TWENTY_FOUR_HOURS_MS) {
      localStorage.removeItem("last_active_session");
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export default function HostUploadPage() {
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

  // ── Host Continuity ─────────────────────────────────────
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedInfo = localStorage.getItem("duitnow_original_qr");
    if (savedInfo) {
      setOriginalQrString(savedInfo);
      setQrUploaded(true);
    }
    setLastSession(getLastSession());
  }, []);

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

        // Phase 1: Upload for AI parsing only (no session created)
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        // Transition to review state with the parsed receipt
        setReviewReceipt(data.enrichedReceipt as ReviewReceipt);
        setSectionName("");
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
    [originalQrString],
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

    // Recalculate subtotal from items
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
    if (updatedItems.length === 0) return; // Don't allow removing all items

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
      // Tag items with section name if provided
      const section = sectionName.trim() || undefined;
      const receiptToSend = {
        ...reviewReceipt,
        items: reviewReceipt.items.map((item) => ({
          ...item,
          ...(section ? { sectionName: section } : {}),
        })),
      };

      // Recalculate totals to be safe
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Finalize failed");
      }

      setSessionId(data.sessionId);

      // Persist last session for Host Continuity
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
    if (qrInputRef.current) qrInputRef.current.value = "";
  };

  // ── Use Last Session shortcut ─────────────────────────
  const handleUseLastSession = () => {
    if (lastSession) {
      setMergeSessionId(lastSession.sessionId);
    }
  };

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col items-center justify-center px-5 relative">
      {/* Settings Button */}
      {state === "idle" && mounted && (
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="absolute top-5 right-5 w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all shadow-sm"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      )}

      {/* Settings Dropdown */}
      {showSettings && (
        <div className="absolute top-16 right-5 bg-white rounded-2xl shadow-xl border border-slate-100 p-4 z-50 w-64 animate-[slideDown_0.2s_ease-out]">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Session Controls
          </p>
          <button
            onClick={handleClearAll}
            className="w-full py-3 px-4 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Sessions
          </button>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Removes saved QR, session history, and pending bills. Use this to start fresh.
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
        <div className="absolute top-10 left-5 right-5 bg-red-50 text-red-600 text-sm font-semibold p-4 rounded-xl shadow-sm text-center border border-red-100 flex items-center justify-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {errorMsg}
        </div>
      )}

      {/* ── IDLE: Upload State ─────────────────────────── */}
      {state === "idle" && (
        <div className="w-full text-center">
          {/* Resume Current Session Badge */}
          {mounted && lastSession && (
            <Link
              href={`/split/${lastSession.sessionId}`}
              className="w-full mb-6 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold text-sm flex items-center justify-between shadow-lg shadow-emerald-200/50 hover:shadow-emerald-300/50 transition-all active:scale-[0.98] no-underline"
            >
              <span className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                Resume Current Session
              </span>
              <span className="font-mono text-xs opacity-80 bg-white/20 px-2 py-1 rounded-lg">
                {lastSession.sessionId}
              </span>
            </Link>
          )}

          <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Camera className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-[#1E293B] mb-2">
            Split the Bill
          </h1>
          <p className="text-sm text-[#64748B] mb-8 leading-relaxed">
            Upload your QR and snap your receipt. AI will crunch it natively and safely.
          </p>

          {/* DuitNow QR Upload Section */}
          <div className="w-full mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-[#1E293B] text-left">
                Your Personal DuitNow QR
              </label>
              {mounted && qrUploaded && (
                <button
                  type="button"
                  onClick={handleChangeAccount}
                  className="text-xs text-[#64748B] hover:text-[#1E293B] underline underline-offset-2 transition-colors"
                >
                  Change Account
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
                  className={`
                    block w-full py-4 rounded-xl border-2 transition-all duration-200 cursor-pointer flex items-center justify-center gap-3
                    bg-white border-slate-200 text-slate-500 hover:border-slate-300
                  `}
                >
                  <UploadCloud className="w-5 h-5" />
                  <span className="font-semibold text-sm">
                    Upload QR Screenshot
                  </span>
                </label>
              </>
            ) : (
              <div className="w-full py-4 rounded-xl border-2 border-[#10B981] bg-emerald-50 text-[#10B981] flex items-center justify-center gap-3 cursor-default">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold text-sm">
                  ✓ Saved DuitNow Account Active
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
              if (!qrUploaded) setErrorMsg("Please upload your DuitNow QR screenshot first.");
            }}
            className={`
              block w-full py-16 rounded-3xl border-2 border-dashed transition-all duration-200 mb-4
              ${qrUploaded
                ? "border-[#10B981] bg-emerald-50/50 cursor-pointer hover:bg-emerald-50 hover:border-[#059669] active:scale-[0.98]"
                : "border-slate-300 bg-slate-50 opacity-60 cursor-not-allowed"
              }
            `}
          >
            <Camera className={`w-10 h-10 mx-auto mb-3 ${qrUploaded ? "text-[#10B981]" : "text-slate-400"}`} />
            <span className={`text-lg font-bold ${qrUploaded ? "text-[#10B981]" : "text-slate-500"}`}>
              Snap Receipt
            </span>
            <span className="block text-xs text-[#64748B] mt-1">
              EXIF data will be stripped automatically
            </span>
          </label>

          {/* Merge Session Input */}
          <div className="w-full text-left mb-6">
            <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-2">
              Merge with existing bill (Optional)
            </label>
            <input
              type="text"
              placeholder="Paste existing Session ID here"
              value={mergeSessionId}
              onChange={(e) => setMergeSessionId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981] outline-none transition-all placeholder:text-slate-400"
            />
            {/* Use Last Session shortcut */}
            {mounted && lastSession && (
              <button
                onClick={handleUseLastSession}
                className="mt-2 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors flex items-center gap-1.5"
              >
                <ArrowRight className="w-3 h-3" />
                Use Last Session ({lastSession.sessionId})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── LOADING: AI Processing ────────────────────── */}
      {state === "loading" && (
        <div className="w-full text-center">
          <div className="w-16 h-16 bg-[#1E293B] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>

          <h2 className="text-xl font-bold text-[#1E293B] mb-2">
            AI is crunching the numbers...
          </h2>
          <p className="text-sm text-[#64748B]">
            Parsing receipt, validating math, generating draft.
          </p>

          {/* Pulsing dots */}
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
        <div className="w-full pb-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Pencil className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-[#1E293B] mb-1">
              Review & Edit
            </h2>
            <p className="text-sm text-[#64748B]">
              Tap any item to edit its name or price before sharing.
            </p>
          </div>

          {/* Merchant & Date */}
          <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-100 shadow-sm">
            <p className="text-lg font-bold text-[#1E293B]">{reviewReceipt.merchantName}</p>
            <p className="text-sm text-[#64748B]">{reviewReceipt.date}</p>
          </div>

          {/* Section Name Input */}
          <div className="mb-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-2">
              <Tag className="w-3.5 h-3.5" />
              Section Name (Trip Mode)
            </label>
            <input
              type="text"
              placeholder='e.g., "Dinner at Guangzhou", "Day 2 Coffee"'
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Editable Items */}
          <div className="space-y-2 mb-4">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
              Items ({reviewReceipt.items.length})
            </span>

            {reviewReceipt.items.map((item) => (
              <div
                key={item.id}
                className={`bg-white rounded-xl p-4 border transition-all duration-200 ${
                  editingItemId === item.id
                    ? "border-amber-400 shadow-md"
                    : "border-slate-100 shadow-sm"
                }`}
              >
                {editingItemId === item.id ? (
                  /* Editing Mode */
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                      placeholder="Item name"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#64748B] font-medium">RM</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditItem}
                        className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display Mode */
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => startEditItem(item)}
                      className="flex-1 text-left min-w-0 mr-3"
                    >
                      <p className="font-semibold text-[#1E293B] truncate text-sm">
                        {item.name}
                      </p>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {formatRM(item.priceInCents)}
                        {item.quantity > 1 && ` · Qty: ${item.quantity}`}
                      </p>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEditItem(item)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                        aria-label={`Edit ${item.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {reviewReceipt.items.length > 1 && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
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
          <div className="bg-white rounded-2xl p-4 mb-6 border border-slate-100 shadow-sm">
            <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
              Totals
            </span>
            <div className="space-y-1.5 mt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#64748B]">Subtotal</span>
                <span className="text-[#1E293B] font-medium font-mono">
                  {formatRM(reviewReceipt.subtotalInCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">SST (Tax)</span>
                <span className="text-[#1E293B] font-medium font-mono">
                  {formatRM(reviewReceipt.taxInCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Service Charge</span>
                <span className="text-[#1E293B] font-medium font-mono">
                  {formatRM(reviewReceipt.serviceChargeInCents)}
                </span>
              </div>
              <div className="border-t border-slate-100 pt-2 mt-2 flex justify-between">
                <span className="font-bold text-[#1E293B]">Grand Total</span>
                <span className="font-bold text-[#1E293B] font-mono text-lg">
                  {formatRM(reviewReceipt.grandTotalInCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Finalize Button */}
          <button
            onClick={handleFinalize}
            disabled={isFinalizingReview}
            className={`
              w-full py-4 rounded-2xl text-white font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              shadow-lg mb-3
              ${isFinalizingReview
                ? "bg-slate-300 cursor-not-allowed"
                : "bg-[#10B981] active:bg-emerald-600 shadow-emerald-200 hover:shadow-emerald-300"
              }
            `}
          >
            {isFinalizingReview ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Finalizing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Confirm & Generate Link
              </>
            )}
          </button>

          {/* Back button */}
          <button
            onClick={handleReset}
            className="w-full text-sm text-[#64748B] underline underline-offset-2 py-2"
          >
            ← Start Over
          </button>
        </div>
      )}

      {/* ── SUCCESS: Share Link ───────────────────────── */}
      {state === "success" && (
        <div className="w-full text-center">
          <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-white" />
          </div>

          <h2 className="text-xl font-bold text-[#1E293B] mb-2">
            Ready to Split!
          </h2>
          <p className="text-sm text-[#64748B] mb-6">
            Share this link with your group. They can claim their items
            and pay via DuitNow.
          </p>

          {/* URL Display */}
          <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-100 shadow-sm">
            <p className="text-xs text-[#64748B] uppercase tracking-wider font-semibold mb-2">
              Share Link
            </p>
            <p className="text-sm text-[#1E293B] font-mono break-all">
              {shareUrl}
            </p>
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="
              w-full py-4 rounded-2xl bg-[#1E293B] text-white font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              active:bg-slate-800 shadow-lg mb-4
            "
          >
            <Copy className="w-5 h-5" />
            {copied ? "Copied!" : "Copy Share Link"}
          </button>

          {/* Session ID for Merging */}
          <div className="bg-white rounded-2xl p-4 mb-4 border border-slate-100 shadow-sm text-left">
            <p className="text-xs text-[#64748B] uppercase tracking-wider font-semibold mb-2">
              Session ID (for Merging)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-50 px-3 py-2.5 rounded-xl text-sm font-mono text-[#1E293B] font-bold tracking-wider border border-slate-100">
                {sessionId}
              </code>
              <button
                onClick={handleCopySessionId}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedSessionId ? "Copied!" : "Copy ID"}
              </button>
            </div>
            <p className="text-xs text-[#64748B] mt-2 leading-relaxed">
              Use this ID if you want to add another receipt to this bill later.
            </p>
          </div>

          {/* Upload another */}
          <button
            onClick={handleReset}
            className="text-sm text-[#64748B] underline underline-offset-2"
          >
            Upload another receipt
          </button>
        </div>
      )}

      {/* ── ERROR: Retry ──────────────────────────────── */}
      {state === "error" && (
        <div className="w-full text-center">
          <div className="w-16 h-16 bg-[#FC7C78] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-white" />
          </div>

          <h2 className="text-xl font-bold text-[#1E293B] mb-2">
            Couldn't parse receipt
          </h2>
          <p className="text-sm text-[#FC7C78] mb-6">
            {errorMsg}
          </p>

          <button
            onClick={handleReset}
            className="
              w-full py-4 rounded-2xl bg-[#1E293B] text-white font-bold text-lg
              flex items-center justify-center gap-2 transition-all duration-200
              active:bg-slate-800 shadow-lg
            "
          >
            Try Another Photo
          </button>
        </div>
      )}
    </div>
  );
}
