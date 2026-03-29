import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import type { SessionData } from "@/src/privacy";

// ─────────────────────────────────────────────────────────────
// POST /api/claim — Atomic item claim (exclusive or split mode)
// GET  /api/claim — Poll all claims for a session
// ─────────────────────────────────────────────────────────────

// ── Exclusive Claim Lua ─────────────────────────────────────
// KEYS[1] = sessionId
// ARGV[1] = itemId, ARGV[2] = guestId, ARGV[3] = new qty, ARGV[4] = max qty, ARGV[5] = guestName
const CLAIM_LUA = `
local sessionStr = redis.call('GET', KEYS[1])
if not sessionStr then return -2 end
local session = cjson.decode(sessionStr)

local itemId = ARGV[1]
local guestId = ARGV[2]
local quantity = tonumber(ARGV[3])
local maxQty = tonumber(ARGV[4])
local guestName = ARGV[5]

local splitCheck = 'split:' .. itemId .. ':'
for k, _ in pairs(session) do
  if type(k) == 'string' and string.sub(k, 1, string.len(splitCheck)) == splitCheck then
    return -4 -- Item is being split
  end
end

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

-- Store guest name
if guestName and guestName ~= '' then
  session['name:' .. guestId] = guestName
end

local newSessionStr = cjson.encode(session)
redis.call('SET', KEYS[1], newSessionStr, 'EX', 7200)

local hashKey = 'claims:' .. KEYS[1]
if quantity == 0 then
  redis.call('HDEL', hashKey, itemId .. ':' .. guestId)
else
  redis.call('HSET', hashKey, itemId .. ':' .. guestId, quantity)
  redis.call('EXPIRE', hashKey, 7200)
end

-- Also store name in hash for quick lookups
if guestName and guestName ~= '' then
  redis.call('HSET', hashKey, 'name:' .. guestId, guestName)
  redis.call('EXPIRE', hashKey, 7200)
end

return 1
`;

// ── Split (Fractional) Claim Lua ────────────────────────────
// KEYS[1] = sessionId
// ARGV[1] = itemId, ARGV[2] = guestId, ARGV[3] = join(1) or leave(0), ARGV[4] = maxSharers(10), ARGV[5] = guestName
const SPLIT_CLAIM_LUA = `
local sessionStr = redis.call('GET', KEYS[1])
if not sessionStr then return -2 end
local session = cjson.decode(sessionStr)

local itemId = ARGV[1]
local guestId = ARGV[2]
local joinOrLeave = tonumber(ARGV[3])
local maxSharers = tonumber(ARGV[4])

local splitPrefix = 'split:' .. itemId .. ':'
local myKey = splitPrefix .. guestId
local guestName = ARGV[5]

local exclusiveCheck = 'claim:' .. itemId .. ':'
for k, _ in pairs(session) do
  if type(k) == 'string' and string.sub(k, 1, string.len(exclusiveCheck)) == exclusiveCheck then
    return -4 -- Item is exclusively claimed
  end
end

-- Count current sharers (excluding self)
local currentSharers = 0
for k, v in pairs(session) do
  if type(k) == 'string' and string.sub(k, 1, string.len(splitPrefix)) == splitPrefix and k ~= myKey then
    if tonumber(v) == 1 then
      currentSharers = currentSharers + 1
    end
  end
end

if joinOrLeave == 1 then
  -- Joining
  if currentSharers + 1 > maxSharers then
    return -3
  end
  session[myKey] = 1
else
  -- Leaving
  session[myKey] = nil
end

-- Store guest name
if guestName and guestName ~= '' then
  session['name:' .. guestId] = guestName
end

local newSessionStr = cjson.encode(session)
redis.call('SET', KEYS[1], newSessionStr, 'EX', 7200)

-- Mirror in hash
local hashKey = 'claims:' .. KEYS[1]
if joinOrLeave == 0 then
  redis.call('HDEL', hashKey, 'split:' .. itemId .. ':' .. guestId)
else
  redis.call('HSET', hashKey, 'split:' .. itemId .. ':' .. guestId, 1)
  redis.call('EXPIRE', hashKey, 7200)
end

-- Name in hash
if guestName and guestName ~= '' then
  redis.call('HSET', hashKey, 'name:' .. guestId, guestName)
  redis.call('EXPIRE', hashKey, 7200)
end

return 1
`;

const MAX_SPLIT_SHARERS = 10;

export async function POST(request: NextRequest) {
  try {
    const { sessionId, guestId, itemId, quantity, mode, guestName } = await request.json();

    if (!sessionId || !guestId || !itemId) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }

    if (!guestName || typeof guestName !== "string" || guestName.trim().length === 0) {
      return NextResponse.json(
        { error: "Guest name is required." },
        { status: 400 },
      );
    }

    const claimMode = mode === "split" ? "split" : "exclusive";

    // Look up item from stored receipt
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

    if (claimMode === "split") {
      // Split mode: only for qty-1 items
      if (item.quantity !== 1) {
        return NextResponse.json(
          { error: "Split mode is only available for single-quantity items." },
          { status: 400 },
        );
      }

      const joinOrLeave = quantity > 0 ? 1 : 0;

      const result = await kv.eval(
        SPLIT_CLAIM_LUA,
        [sessionId],
        [itemId, guestId, joinOrLeave.toString(), MAX_SPLIT_SHARERS.toString(), guestName.trim()],
      );

      if (result === -2) {
        return NextResponse.json({ error: "Session logic expired." }, { status: 404 });
      }
      if (result === -3) {
        return NextResponse.json(
          { error: `Max ${MAX_SPLIT_SHARERS} people can share an item.` },
          { status: 409 },
        );
      }
      if (result === -4) {
        return NextResponse.json(
          { error: "Item is already claimed in a different mode." },
          { status: 409 },
        );
      }

      return NextResponse.json({ success: true });
    } else {
      // Exclusive mode (original behavior)
      if (quantity == null || !Number.isInteger(quantity) || quantity < 0) {
        return NextResponse.json(
          { error: "quantity must be a non-negative integer." },
          { status: 400 },
        );
      }

      const result = await kv.eval(
        CLAIM_LUA,
        [sessionId],
        [itemId, guestId, quantity.toString(), item.quantity.toString(), guestName.trim()],
      );

      if (result === -1) {
        return NextResponse.json(
          { error: "Conflict: not enough remaining quantity." },
          { status: 409 },
        );
      }

      if (result === -2) {
        return NextResponse.json({ error: "Session logic expired." }, { status: 404 });
      }
      if (result === -4) {
        return NextResponse.json(
          { error: "Item is already claimed in a different mode." },
          { status: 409 },
        );
      }

      return NextResponse.json({ success: true });
    }
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
