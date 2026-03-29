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
}

export interface Receipt {
  items: ReceiptItem[];
  subtotalInCents: number;
  taxInCents: number;
  serviceChargeInCents: number;
  grandTotalInCents: number;
}

export interface UserClaim {
  userId: string;
  itemId: string;
  fraction?: number; // DEPRECATED — never used. Engine counts claimants by array length.
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
 * @returns A record mapping userId → total amount owed in cents/sen.
 * @throws {ReconciliationError} if the receipt totals are inconsistent or
 *         the final per-user sums don't reconcile to grandTotalInCents.
 */
export function calculateSplit(
  receipt: Receipt,
  claims: UserClaim[],
): Record<string, number> {
  // ── Input Validation ──────────────────────────────────────
  const expectedGrand =
    receipt.subtotalInCents +
    receipt.taxInCents +
    receipt.serviceChargeInCents;

  if (expectedGrand !== receipt.grandTotalInCents) {
    throw new ReconciliationError(receipt.grandTotalInCents, expectedGrand);
  }

  // ── Step A: Compute item subtotals per user ───────────────
  // Group claims by itemId
  const itemClaimants = new Map<string, string[]>();
  for (const claim of claims) {
    if (!itemClaimants.has(claim.itemId)) {
      itemClaimants.set(claim.itemId, []);
    }
    itemClaimants.get(claim.itemId)!.push(claim.userId);
  }

  // Build a price lookup from the receipt
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

  // ── Step A + B: Integer division + penny distribution ─────
  for (const [itemId, claimantIds] of itemClaimants) {
    const price = itemPrices.get(itemId);
    if (price === undefined) {
      throw new Error(`Item "${itemId}" not found in receipt items`);
    }

    const numClaimants = claimantIds.length;
    const baseShare = Math.floor(price / numClaimants);
    const remainder = price % numClaimants;

    // Give everyone the base share
    for (const uid of claimantIds) {
      userSubtotals.set(uid, (userSubtotals.get(uid) ?? 0) + baseShare);
    }

    // Distribute remainder cents round-robin sorted by highest subtotal desc,
    // userId as tie-breaker
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

  // ── Sanity check: user subtotals must equal receipt subtotal ─
  const computedSubtotal = [...userSubtotals.values()].reduce(
    (a, b) => a + b,
    0,
  );
  if (computedSubtotal !== receipt.subtotalInCents) {
    throw new ReconciliationError(receipt.subtotalInCents, computedSubtotal);
  }

  // ── Step C: Proportional tax & service charge ─────────────
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

  // ── Step D: Reconciliation ────────────────────────────────
  const finalSum = Object.values(result).reduce((a, b) => a + b, 0);
  if (finalSum !== receipt.grandTotalInCents) {
    throw new ReconciliationError(receipt.grandTotalInCents, finalSum);
  }

  return result;
}
