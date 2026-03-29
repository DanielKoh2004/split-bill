import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { SessionData } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// POST /api/claim — Atomic item claim via Redis Lua script
// GET  /api/claim — Poll all claims for a session
// ─────────────────────────────────────────────────────────────

// Lua script: atomically validate availability then set the claim directly inside the session JSON.
// KEYS[1] = sessionId
// ARGV[1] = itemId, ARGV[2] = guestId, ARGV[3] = new qty, ARGV[4] = max qty
const CLAIM_LUA = `
local sessionStr = redis.call('GET', KEYS[1])
if not sessionStr then return -2 end
local session = cjson.decode(sessionStr)

local itemId = ARGV[1]
local guestId = ARGV[2]
local quantity = tonumber(ARGV[3])
local maxQty = tonumber(ARGV[4])

local othersClaimed = 0
local prefix = 'claim:' .. itemId .. ':'
local myKey = prefix .. guestId

for k, v in pairs(session) do
  if type(k) == 'string' and string.sub(k, 1, string.len(prefix)) == prefix and k ~= myKey then
    othersClaimed = othersClaimed + tonumber(v)
  end
end

if othersClaimed + quantity > maxQty then
  return -1
end

if quantity == 0 then
  session[myKey] = nil
else
  session[myKey] = quantity
end

local newSessionStr = cjson.encode(session)
redis.call('SET', KEYS[1], newSessionStr, 'EX', 7200)

-- We also maintain the Hash to fulfill the "Keep the GET endpoint exactly the same" requirement seamlessly
local hashKey = 'claims:' .. KEYS[1]
if quantity == 0 then
  redis.call('HDEL', hashKey, itemId .. ':' .. guestId)
else
  redis.call('HSET', hashKey, itemId .. ':' .. guestId, quantity)
  redis.call('EXPIRE', hashKey, 7200)
end

return 1
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

    // Atomic evaluation of the claim against JSON payload
    const result = await kv.eval(
      CLAIM_LUA,
      [sessionId],
      [itemId, guestId, quantity.toString(), item.quantity.toString()],
    );

    if (result === -1) {
      return NextResponse.json(
        { error: "Conflict: not enough remaining quantity." },
        { status: 409 },
      );
    }
    
    if (result === -2) {
      return NextResponse.json(
        { error: "Session logic expired." },
        { status: 404 },
      );
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
