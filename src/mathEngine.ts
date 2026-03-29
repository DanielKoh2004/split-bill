// ─────────────────────────────────────────────────────────────
// Module 1: Core Math Engine — Split Bill Application
// All monetary values are integers (Malaysian Sen / cents).
// Zero floating-point currency arithmetic. Zero external libs.
// ─────────────────────────────────────────────────────────────

// ── Interfaces ──────────────────────────────────────────────

export interface ReceiptItem {
  id: string;
  name: string;
  priceInCents: number; // integer, e.g. RM 15.50 → 1550
  sectionName?: string; // Trip Mode: categorize items by receipt/section
}

export interface Receipt {
  items: ReceiptItem[];
  subtotalInCents: number;
  taxInCents: number;
  serviceChargeInCents: number;
  grandTotalInCents: number;
}

/** Exclusive claim: one user takes full ownership of one unit of an item. */
export interface UserClaim {
  userId: string;
  itemId: string;
}

/**
 * Fractional claim: multiple users share ownership of one item unit.
 * Each sharer gets price / totalSharers, with remainder distributed round-robin.
 */
export interface FractionalClaim {
  userId: string;
  itemId: string;
  shares: number;       // always 1 for now (could support 2/N in future)
  totalSharers: number; // capped at 10
}

/** Type guard for FractionalClaim */
function isFractional(claim: UserClaim | FractionalClaim): claim is FractionalClaim {
  return "totalSharers" in claim && (claim as FractionalClaim).totalSharers > 0;
}

// ── Custom Error ────────────────────────────────────────────

export class ReconciliationError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `Reconciliation failed: expected ${expected} sen but got ${actual} sen (off by ${actual - expected} sen)`,
    );
    this.name = "ReconciliationError";
  }
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Returns a comparator that sorts users by subtotal descending,
 * breaking ties by userId ascending (lexicographic).
 */
function subtotalDescComparator(
  subtotals: Map<string, number>,
): (a: string, b: string) => number {
  return (a: string, b: string): number => {
    const diff = (subtotals.get(b) ?? 0) - (subtotals.get(a) ?? 0);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * Distributes `total` among `userIds` proportionally to their subtotals.
 * Uses multiply-before-divide: Math.floor((userSubtotal * total) / sumSubtotals)
 * Remainder cents are handed out round-robin sorted by highest subtotal desc.
 *
 * If sumSubtotals is 0, returns all zeros (division-by-zero guard).
 */
function distributeProportionally(
  total: number,
  userIds: string[],
  subtotals: Map<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const uid of userIds) {
    result.set(uid, 0);
  }

  const sumSubtotals = userIds.reduce(
    (acc, uid) => acc + (subtotals.get(uid) ?? 0),
    0,
  );

  // Division-by-zero guard: if nobody spent anything, nothing to distribute
  if (sumSubtotals === 0) {
    return result;
  }

  let allocated = 0;
  for (const uid of userIds) {
    const userSub = subtotals.get(uid) ?? 0;
    const share = Math.floor((userSub * total) / sumSubtotals);
    result.set(uid, share);
    allocated += share;
  }

  // Distribute remainder cents round-robin, highest subtotal first
  let remainder = total - allocated;
  const sorted = [...userIds].sort(subtotalDescComparator(subtotals));
  let idx = 0;
  while (remainder > 0) {
    const uid = sorted[idx % sorted.length];
    result.set(uid, (result.get(uid) ?? 0) + 1);
    remainder--;
    idx++;
  }

  return result;
}

// ── Core Function ───────────────────────────────────────────

/**
 * Calculates the exact split for a receipt given user claims.
 * 
 * Supports two claim types:
 * - `UserClaim`: exclusive ownership — each claim is 1 unit of the item
 * - `FractionalClaim`: joint ownership — price divided by totalSharers
 *
 * @returns A record mapping userId → total amount owed in cents/sen.
 * @throws {ReconciliationError} if the receipt totals are inconsistent or
 *         the final per-user sums don't reconcile to grandTotalInCents.
 */
export function calculateSplit(
  receipt: Receipt,
  claims: (UserClaim | FractionalClaim)[],
): Record<string, number> {
  // ── Input Validation ──────────────────────────────────────
  const expectedGrand =
    receipt.subtotalInCents +
    receipt.taxInCents +
    receipt.serviceChargeInCents;

  if (expectedGrand !== receipt.grandTotalInCents) {
    throw new ReconciliationError(receipt.grandTotalInCents, expectedGrand);
  }

  // ── Build a price lookup from the receipt ─────────────────
  const itemPrices = new Map<string, number>();
  for (const item of receipt.items) {
    itemPrices.set(item.id, item.priceInCents);
  }

  // User subtotals (before tax/service)
  const userSubtotals = new Map<string, number>();
  const allUserIds = new Set<string>();

  for (const claim of claims) {
    allUserIds.add(claim.userId);
  }
  for (const uid of allUserIds) {
    userSubtotals.set(uid, 0);
  }

  // ── Step A: Separate claims into exclusive and fractional ─
  // Group exclusive claims by itemId
  const exclusiveClaimants = new Map<string, string[]>();
  // Group fractional claims by itemId
  const fractionalClaimants = new Map<string, { userId: string; totalSharers: number }[]>();

  for (const claim of claims) {
    if (isFractional(claim)) {
      if (!fractionalClaimants.has(claim.itemId)) {
        fractionalClaimants.set(claim.itemId, []);
      }
      fractionalClaimants.get(claim.itemId)!.push({
        userId: claim.userId,
        totalSharers: claim.totalSharers,
      });
    } else {
      if (!exclusiveClaimants.has(claim.itemId)) {
        exclusiveClaimants.set(claim.itemId, []);
      }
      exclusiveClaimants.get(claim.itemId)!.push(claim.userId);
    }
  }

  // ── Step B: Process exclusive claims (unchanged logic) ────
  for (const [itemId, claimantIds] of exclusiveClaimants) {
    const price = itemPrices.get(itemId);
    if (price === undefined) {
      throw new Error(`Item "${itemId}" not found in receipt items`);
    }

    const numClaimants = claimantIds.length;
    const baseShare = Math.floor(price / numClaimants);
    const remainder = price % numClaimants;

    for (const uid of claimantIds) {
      userSubtotals.set(uid, (userSubtotals.get(uid) ?? 0) + baseShare);
    }

    if (remainder > 0) {
      const sorted = [...claimantIds].sort(
        subtotalDescComparator(userSubtotals),
      );
      for (let i = 0; i < remainder; i++) {
        const uid = sorted[i % sorted.length];
        userSubtotals.set(uid, (userSubtotals.get(uid) ?? 0) + 1);
      }
    }
  }

  // ── Step C: Process fractional claims ─────────────────────
  for (const [itemId, sharers] of fractionalClaimants) {
    const price = itemPrices.get(itemId);
    if (price === undefined) {
      throw new Error(`Item "${itemId}" not found in receipt items`);
    }

    // All sharers of the same item should have the same totalSharers,
    // but we use the first one's value as the canonical count.
    const totalSharers = sharers[0].totalSharers;
    const baseShare = Math.floor(price / totalSharers);
    const remainder = price % totalSharers;

    // Give each sharer the base share
    const sharerUserIds = sharers.map((s) => s.userId);
    for (const uid of sharerUserIds) {
      userSubtotals.set(uid, (userSubtotals.get(uid) ?? 0) + baseShare);
    }

    // Distribute remainder cents round-robin
    if (remainder > 0) {
      const sorted = [...sharerUserIds].sort(
        subtotalDescComparator(userSubtotals),
      );
      for (let i = 0; i < remainder; i++) {
        const uid = sorted[i % sorted.length];
        userSubtotals.set(uid, (userSubtotals.get(uid) ?? 0) + 1);
      }
    }
  }

  // ── Sanity check: user subtotals must equal receipt subtotal ─
  const computedSubtotal = [...userSubtotals.values()].reduce(
    (a, b) => a + b,
    0,
  );
  if (computedSubtotal !== receipt.subtotalInCents) {
    throw new ReconciliationError(receipt.subtotalInCents, computedSubtotal);
  }

  // ── Step D: Proportional tax & service charge ─────────────
  const userIdList = [...allUserIds];

  const taxShares = distributeProportionally(
    receipt.taxInCents,
    userIdList,
    userSubtotals,
  );

  const serviceShares = distributeProportionally(
    receipt.serviceChargeInCents,
    userIdList,
    userSubtotals,
  );

  // ── Assemble final totals ─────────────────────────────────
  const result: Record<string, number> = {};
  for (const uid of userIdList) {
    result[uid] =
      (userSubtotals.get(uid) ?? 0) +
      (taxShares.get(uid) ?? 0) +
      (serviceShares.get(uid) ?? 0);
  }

  // ── Step E: Reconciliation ────────────────────────────────
  const finalSum = Object.values(result).reduce((a, b) => a + b, 0);
  if (finalSum !== receipt.grandTotalInCents) {
    throw new ReconciliationError(receipt.grandTotalInCents, finalSum);
  }

  return result;
}
