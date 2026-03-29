import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { SessionData } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// POST /api/claim — Atomic item claim via Redis Lua script
// GET  /api/claim — Poll all claims for a session
// ─────────────────────────────────────────────────────────────

// Lua script: atomically validate availability then set the claim.
// KEYS[1] = "claims:{sessionId}"
// ARGV[1] = itemId, ARGV[2] = guestId, ARGV[3] = new qty, ARGV[4] = max qty
const CLAIM_LUA = `
local key     = KEYS[1]
local itemId  = ARGV[1]
local guestId = ARGV[2]
local newQty  = tonumber(ARGV[3])
local maxQty  = tonumber(ARGV[4])

local all = redis.call('HGETALL', key)
local othersTotal = 0

for i = 1, #all, 2 do
  local fParts = all[i]
  local sep    = string.find(fParts, ':', 1, true)
  if sep then
    local fItem  = string.sub(fParts, 1, sep - 1)
    local fGuest = string.sub(fParts, sep + 1)
    if fItem == itemId and fGuest ~= guestId then
      othersTotal = othersTotal + tonumber(all[i + 1])
    end
  end
end

if othersTotal + newQty > maxQty then
  return redis.error_reply('CONFLICT: only ' .. tostring(maxQty - othersTotal) .. ' remaining')
end

local field = itemId .. ':' .. guestId
if newQty == 0 then
  redis.call('HDEL', key, field)
else
  redis.call('HSET', key, field, newQty)
end
redis.call('EXPIRE', key, 7200)
return newQty
`;

export async function POST(request: NextRequest) {
  try {
    const { sessionId, guestId, itemId, quantity } = await request.json();

    if (!sessionId || !guestId || !itemId || quantity == null) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
      return NextResponse.json(
        { error: "quantity must be a non-negative integer." },
        { status: 400 },
      );
    }

    // Look up max quantity from the stored receipt (don't trust the client)
    const session = await kv.get<SessionData>(sessionId);
    if (!session || !session.receiptJson) {
      return NextResponse.json(
        { error: "Session expired or not found." },
        { status: 404 },
      );
    }

    const items = (session.receiptJson as any).items as Array<{
      id: string;
      quantity: number;
    }>;
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json(
        { error: `Item "${itemId}" not found in session.` },
        { status: 404 },
      );
    }

    const claimsKey = `claims:${sessionId}`;
    try {
      await kv.eval(
        CLAIM_LUA,
        [claimsKey],
        [itemId, guestId, quantity.toString(), item.quantity.toString()],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("CONFLICT")) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── GET: Poll all claims for a session ──────────────────────

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId query parameter." },
      { status: 400 },
    );
  }

  const claimsKey = `claims:${sessionId}`;
  const raw = await kv.hgetall(claimsKey);

  return NextResponse.json({ claims: raw ?? {} });
}
