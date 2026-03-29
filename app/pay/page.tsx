"use client";

import { useEffect, useState, useMemo } from "react";
import { ChevronLeft, Download, CheckCircle2, Copy, Info } from "lucide-react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { modifyEMVCoPayload } from "@/src/duitnowQR";
import { calculateSplit, FractionalClaim, UserClaim } from "@/src/mathEngine";
import { useAppContext } from "@/src/ThemeContext";
import ToggleBar from "@/app/components/ToggleBar";

interface PendingBill {
  sessionId: string;
  merchantName: string;
  originalQrString: string;
  userTotal: number;
}

export default function GlobalPayPage() {
  const { t } = useAppContext();
  const [bills, setBills] = useState<PendingBill[]>([]);
  const [mounted, setMounted] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("pending_bills");
    if (stored) {
      try {
        setBills(JSON.parse(stored));
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted || bills.length === 0) return;

    let isSubscribed = true;

    async function fetchLiveTotals() {
      const updatedBills = await Promise.all(
        bills.map(async (b) => {
          try {
            const guestId = localStorage.getItem(`guestId_${b.sessionId}`);
            if (!guestId) return b;

            const res = await fetch(`/api/session/status?sessionId=${b.sessionId}`, {
              headers: { "x-qr-proof": b.originalQrString },
            });
            if (!res.ok) {
              if (res.status === 404) {
                return { ...b, isDead: true };
              }
              return b;
            }

            const data = await res.json();
            const rawClaims = data.claims || {};
            const allClaims: (UserClaim | FractionalClaim)[] = [];
            const itemSplits = new Map<string, Set<string>>();

            for (const [key, val] of Object.entries(rawClaims)) {
              if (key.startsWith("name:")) continue;
              if (key.startsWith("split:")) {
                const [, itemId, uid] = key.split(":");
                if (!itemSplits.has(itemId)) itemSplits.set(itemId, new Set());
                itemSplits.get(itemId)!.add(uid);
              } else {
                const [itemId, uid] = key.split(":");
                const qty = Number(val);
                for (let i = 0; i < qty; i++) {
                  allClaims.push({ userId: uid, itemId });
                }
              }
            }

            for (const [itemId, users] of Array.from(itemSplits.entries())) {
              const totalSharers = users.size;
              for (const uid of Array.from(users)) {
                allClaims.push({
                  userId: uid,
                  itemId,
                  shares: 1,
                  totalSharers,
                } as FractionalClaim);
              }
            }

            if (data.receipt && data.receipt.items) {
              for (const item of data.receipt.items) {
                const isSplit = itemSplits.has(item.id);
                // exclusive claims count
                const claimedQty = allClaims.filter(c => c.itemId === item.id && !('totalSharers' in c)).length;
                if (!isSplit && claimedQty < item.quantity) {
                  for (let i = 0; i < item.quantity - claimedQty; i++) {
                    allClaims.push({ userId: "unclaimed", itemId: item.id });
                  }
                }
              }
            }

            const totals = calculateSplit(data.receipt, allClaims);
            const userTotal = totals[guestId] || 0;
            return { ...b, userTotal, isDead: false };
          } catch (e) {
            return b;
          }
        })
      );

      const aliveBills = updatedBills.filter(ub => !(ub as any).isDead);

      // check if anything actually changed to prevent infinite loops
      const hasChanges = 
        aliveBills.length !== bills.length || 
        aliveBills.some((ub, i) => ub.userTotal !== bills[i].userTotal);

      if (isSubscribed && hasChanges) {
        setBills(aliveBills);
        localStorage.setItem("pending_bills", JSON.stringify(aliveBills));
      }
    }

    fetchLiveTotals();
    const timer = setInterval(fetchLiveTotals, 5000);

    return () => {
      isSubscribed = false;
      clearInterval(timer);
    };
  }, [mounted, bills]);

  // Grouping Engine
  const groups = useMemo(() => {
    const map = new Map<string, { merchantNames: string[]; sessionIds: string[]; hostTotal: number; originalQrString: string }>();

    for (const b of bills) {
        if (b.userTotal <= 0) continue;
        
        const existing = map.get(b.originalQrString);
        if (existing) {
            existing.merchantNames.push(b.merchantName);
            existing.merchantNames = Array.from(new Set(existing.merchantNames));
            existing.sessionIds.push(b.sessionId);
            existing.hostTotal += b.userTotal;
        } else {
            map.set(b.originalQrString, {
                originalQrString: b.originalQrString,
                merchantNames: [b.merchantName],
                sessionIds: [b.sessionId],
                hostTotal: b.userTotal
            });
        }
    }
    return Array.from(map.values());
  }, [bills]);

  const markAsPaid = (originalQrString: string, sessionIds: string[]) => {
      const confirmed = window.confirm("Are you sure? This will remove the bill from your device permanently.");
      if (!confirmed) return;

      const remaining = bills.filter(b => !sessionIds.includes(b.sessionId));
      setBills(remaining);
      localStorage.setItem("pending_bills", JSON.stringify(remaining));
  };

  const copyAmount = async (amount: number, id: string) => {
      try {
          await navigator.clipboard.writeText((amount / 100).toFixed(2));
          setCopiedAmount(id);
          setTimeout(() => setCopiedAmount(null), 2000);
      } catch {}
  };

  const downloadQR = (id: string, name: string) => {
    const canvas = document.getElementById(`qr-${id}`) as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `splitbill-${name}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  function formatRM(cents: number) {
    return `RM ${(cents / 100).toFixed(2)}`;
  }

  if (!mounted) return null;

  return (
    <div className="max-w-md mx-auto min-h-screen bg-themed relative pb-20">
      <ToggleBar />

      <header className="px-5 pt-8 pb-4 flex items-center gap-4">
        <Link href="/" className="w-10 h-10 bg-card-themed rounded-full flex items-center justify-center shadow-card-themed text-secondary-themed hover:text-primary-themed border border-themed no-underline">
           <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-primary-themed">{t.viewAllPendingBills}</h1>
          <p className="text-sm text-secondary-themed">{bills.length} active sessions</p>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="px-5 mt-10 text-center text-secondary-themed">
           <CheckCircle2 className="w-12 h-12 mx-auto text-[#10B981] mb-3" />
           <p className="font-semibold text-lg text-primary-themed">All settled up!</p>
           <p className="text-sm mt-1">You have no pending bills left to pay.</p>
        </div>
      ) : (
        <div className="px-5 space-y-6 mt-2">
            
          {/* Info Banner */}
          <div className="bg-blue-500/10 p-3 rounded-xl mb-4 flex gap-3 items-start border border-blue-500/20">
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium leading-snug">
              {t.bankSecurityNote}
            </p>
          </div>

          {groups.map((group, idx) => {
              const qrPayload = modifyEMVCoPayload(group.originalQrString, group.hostTotal);
              const groupId = `group-${idx}`;

              return (
                  <div key={idx} className="bg-card-themed rounded-3xl p-6 shadow-card-themed border border-themed">
                      <div className="mb-4">
                          <h2 className="text-lg font-bold text-primary-themed">Payment Group</h2>
                          <div className="space-y-1 mt-2">
                              {bills.filter(b => group.sessionIds.includes(b.sessionId)).map((b, i) => (
                                  <div key={i} className="flex items-center text-sm font-medium text-secondary-themed before:content-['•'] before:mr-2 before:text-muted-themed">
                                      {b.merchantName}: {formatRM(b.userTotal)}
                                  </div>
                              ))}
                          </div>
                      </div>

                      <div className="flex justify-center mb-6">
                        <div className="bg-white p-5 rounded-2xl shadow-card-themed border border-themed">
                            <QRCodeCanvas
                            id={`qr-${groupId}`}
                            value={qrPayload}
                            size={200}
                            level="M"
                            bgColor="#FFFFFF"
                            fgColor="#1E293B"
                            />
                        </div>
                      </div>

                      <div className="bg-elevated-themed rounded-2xl p-4 mb-4">
                        <div className="flex justify-between items-center">
                            <span className="font-bold text-primary-themed text-sm">{t.totalToPay}</span>
                            <div className="flex items-center gap-2">
                                {copiedAmount === groupId && (
                                <span className="text-xs font-bold text-[#10B981] animate-[fadeIn_0.2s]">
                                    {t.copied}
                                </span>
                                )}
                                <button
                                onClick={() => copyAmount(group.hostTotal, groupId)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20 transition-colors active:bg-[#10B981]/30"
                                >
                                <span className="text-xl font-bold">
                                    {formatRM(group.hostTotal)}
                                </span>
                                <Copy className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                         <button
                           onClick={() => downloadQR(groupId, "payment")}
                           className="py-3 rounded-xl bg-elevated-themed text-secondary-themed font-semibold flex items-center justify-center gap-2 transition-all hover:text-primary-themed text-sm"
                         >
                            <Download className="w-4 h-4" /> {t.saveQrToGallery}
                         </button>
                         <button
                           onClick={() => markAsPaid(group.originalQrString, group.sessionIds)}
                           className="py-3 rounded-xl bg-[#10B981] text-white font-semibold flex items-center justify-center gap-2 transition-all active:bg-emerald-600 text-sm"
                         >
                            <CheckCircle2 className="w-4 h-4" /> Mark as Paid
                         </button>
                      </div>
                  </div>
              );
          })}
        </div>
      )}
    </div>
  );
}
