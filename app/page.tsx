"use client";

import { useState, useRef, useCallback } from "react";
import { Camera, Loader2, CheckCircle2, Copy, AlertCircle } from "lucide-react";
import { sanitizeImage } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// constraints.md compliance:
//   ✅ Client-side EXIF strip via sanitizeImage (Module 4)
//   ✅ No raw File sent to API — only sanitized base64
//   ✅ No persistent storage — ephemeral session only
//   ✅ Stateless — session ID returned, no user accounts
// ─────────────────────────────────────────────────────────────

type FlowState = "idle" | "loading" | "success" | "error";

/** Convert a Blob to a base64 string (no data URI prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:image/...;base64," prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

export default function HostUploadPage() {
  const [state, setState] = useState<FlowState>("idle");
  const [sessionId, setSessionId] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [duitNowId, setDuitNowId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shareUrl =
    typeof window !== "undefined" && sessionId
      ? `${window.location.origin}/split/${sessionId}`
      : "";

  // ── Handle file selection ──────────────────────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setState("loading");
      setErrorMsg("");

      try {
        // Step B: Client-side sanitization (CRITICAL — constraints.md)
        // Strips EXIF (GPS, timestamps, camera model), compresses to 1500px
        const sanitizedBlob = await sanitizeImage(file);

        // Convert sanitized blob to base64
        const base64 = await blobToBase64(sanitizedBlob);

        const cleanId = duitNowId.replace(/[^\d+]/g, '');

        // POST to our API route
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, payeeDuitNowId: cleanId }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        setSessionId(data.sessionId);
        setState("success");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong";
        setErrorMsg(msg);
        setState("error");
      }

      // Reset file input so user can re-select the same file
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [duitNowId],
  );

  // ── Copy share link ────────────────────────────────────
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // ── Reset to upload again ──────────────────────────────
  const handleReset = () => {
    setState("idle");
    setSessionId("");
    setErrorMsg("");
    setCopied(false);
  };

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col items-center justify-center px-5">
      {/* ── IDLE: Upload State ─────────────────────────── */}
      {state === "idle" && (
        <div className="w-full text-center">
          <div className="w-16 h-16 bg-[#10B981] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Camera className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-[#1E293B] mb-2">
            Split the Bill
          </h1>
          <p className="text-sm text-[#64748B] mb-8 leading-relaxed">
            Snap a photo of your receipt. AI will parse it and
            generate a share link for your group.
          </p>

          {/* DuitNow ID Input */}
          <div className="w-full mb-6">
            <label className="block text-sm font-semibold text-[#1E293B] mb-2 text-left">
              Your DuitNow ID (Phone Number)
            </label>
            <input
              type="text"
              placeholder="e.g. +60123456789"
              value={duitNowId}
              onChange={(e) => setDuitNowId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#10B981] text-center text-lg font-medium"
            />
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={!duitNowId.trim()}
            className="hidden"
            id="receipt-upload"
          />

          {/* Upload target area */}
          <label
            htmlFor={duitNowId.trim() ? "receipt-upload" : undefined}
            onClick={() => {
              if (!duitNowId.trim()) setErrorMsg("Please enter your DuitNow ID first.");
            }}
            className={`
              block w-full py-16 rounded-3xl border-2 border-dashed transition-all duration-200
              ${duitNowId.trim()
                ? "border-[#10B981] bg-emerald-50/50 cursor-pointer hover:bg-emerald-50 hover:border-[#059669] active:scale-[0.98]"
                : "border-slate-300 bg-slate-50 opacity-60 cursor-not-allowed"
              }
            `}
          >
            <Camera className={`w-10 h-10 mx-auto mb-3 ${duitNowId.trim() ? "text-[#10B981]" : "text-slate-400"}`} />
            <span className={`text-lg font-bold ${duitNowId.trim() ? "text-[#10B981]" : "text-slate-500"}`}>
              Snap Receipt
            </span>
            <span className="block text-xs text-[#64748B] mt-1">
              EXIF data will be stripped automatically
            </span>
          </label>
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
            Parsing receipt, validating math, generating session.
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
              active:bg-slate-800 shadow-lg mb-3
            "
          >
            <Copy className="w-5 h-5" />
            {copied ? "Copied!" : "Copy Share Link"}
          </button>

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
            Couldn&apos;t parse receipt
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
