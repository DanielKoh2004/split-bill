// ─────────────────────────────────────────────────────────────
// Module 1 (AI): Receipt Parser
//
// Takes a sanitized base64 receipt image, sends it to an LLM
// Vision API, and returns a strictly validated JSON object that
// the Math Engine can consume directly.
//
// The LLM is instructed to output all currency as integer cents.
// After parsing, a mathematical reconciliation gate catches any
// hallucinated math before it reaches the split calculator.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";

// ═════════════════════════════════════════════════════════════
// Zod Schema — strict contract between OCR/LLM and Math Engine
// ═════════════════════════════════════════════════════════════

export const ParsedReceiptItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  priceInCents: z.number().int(),
});

export const ParsedReceiptSchema = z.object({
  merchantName: z.string().min(1),
  date: z.string().regex(
    /^\d{4}-\d{2}-\d{2}/,
    "Date must be ISO 8601 format (YYYY-MM-DD...)",
  ),
  items: z.array(ParsedReceiptItemSchema).nonempty(),
  subtotalInCents: z.number().int().nonnegative(),
  taxInCents: z.number().int().nonnegative(),
  serviceChargeInCents: z.number().int().nonnegative(),
  grandTotalInCents: z.number().int().positive(),
});

export type ParsedReceiptItem = z.infer<typeof ParsedReceiptItemSchema>;
export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;

// ═════════════════════════════════════════════════════════════
// Custom Error — Mathematical Reconciliation Failure
// ═════════════════════════════════════════════════════════════

export class MathReconciliationError extends Error {
  constructor(
    public readonly check: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `Math reconciliation failed [${check}]: expected ${expected}, got ${actual} (off by ${actual - expected})`,
    );
    this.name = "MathReconciliationError";
  }
}

// ═════════════════════════════════════════════════════════════
// Validation Gate — catches LLM hallucinated math
// ═════════════════════════════════════════════════════════════

/**
 * Validates the mathematical integrity of a parsed receipt.
 *
 * Two checks:
 *   1. sum(item.priceInCents) === subtotalInCents
 *   2. subtotalInCents + taxInCents + serviceChargeInCents === grandTotalInCents
 *
 * priceInCents is the total line price (already includes quantity).
 * Discounts are negative line items and naturally subtract from the sum.
 *
 * @throws {MathReconciliationError} if any check fails.
 *         We do NOT attempt to fix the LLM's bad math.
 */
export function validateParsedReceipt(receipt: ParsedReceipt): void {
  // Check 1: Sum of line prices must equal subtotal
  const computedSubtotal = receipt.items.reduce(
    (sum, item) => sum + item.priceInCents,
    0,
  );

  if (computedSubtotal !== receipt.subtotalInCents) {
    throw new MathReconciliationError(
      "ITEM_SUM_VS_SUBTOTAL",
      receipt.subtotalInCents,
      computedSubtotal,
    );
  }

  // Check 2: Subtotal + tax + service === grand total
  const computedGrand =
    receipt.subtotalInCents +
    receipt.taxInCents +
    receipt.serviceChargeInCents;

  if (computedGrand !== receipt.grandTotalInCents) {
    throw new MathReconciliationError(
      "SUBTOTAL_TAX_SERVICE_VS_GRAND",
      receipt.grandTotalInCents,
      computedGrand,
    );
  }
}

// ═════════════════════════════════════════════════════════════
// LLM System Prompt — instructs the model to output integer cents
// ═════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a receipt OCR parser for a Malaysian split-bill application. Parse the receipt image and return a single JSON object. No markdown, no commentary.

SCHEMA:
{
  "merchantName": string,
  "date": "YYYY-MM-DD",
  "items": [
    { "name": string, "quantity": integer, "priceInCents": integer }
  ],
  "subtotalInCents": integer,
  "taxInCents": integer,
  "serviceChargeInCents": integer,
  "grandTotalInCents": integer
}

RULES:
1. CURRENCY: Convert ALL values to integers in the smallest unit (Sen). "RM 15.50" → 1550. Never output floats.

2. LINE PRICES: "priceInCents" is the TOTAL line price for that item row (unit price × quantity), already in cents. Set "quantity" to the number of units.

3. DISCOUNTS: If the receipt shows a discount, include it as a separate line item with a NEGATIVE priceInCents. Example: { "name": "Member Discount", "quantity": 1, "priceInCents": -500 }.

4. MATH INTEGRITY (mandatory):
   - sum(items[].priceInCents) MUST equal subtotalInCents.
   - subtotalInCents + taxInCents + serviceChargeInCents MUST equal grandTotalInCents.
   - If tax or service charge is not shown on the receipt, set them to 0.

5. ACCURACY: Never fabricate items that do not appear on the receipt. If a value is unreadable, use your best estimate.`;

// ═════════════════════════════════════════════════════════════
// LLM Service — calls Vision API to parse receipt image
// ═════════════════════════════════════════════════════════════

export interface LLMProviderConfig {
  provider: "openai" | "gemini";
  apiKey: string;
  model?: string;
}

/**
 * Sends a sanitized receipt image to an LLM Vision API and returns
 * a validated ParsedReceipt.
 *
 * Flow:
 *   1. Build the multimodal prompt with the base64 image.
 *   2. Call the LLM API.
 *   3. Parse the JSON response with the Zod schema.
 *   4. Run the mathematical reconciliation gate.
 *   5. Return the validated receipt or throw.
 *
 * @param imageBase64 - Base64-encoded image string (no data URI prefix).
 * @param config - LLM provider configuration.
 * @throws {z.ZodError} if the LLM output doesn't match the schema.
 * @throws {MathReconciliationError} if the math doesn't add up.
 */
export async function parseReceiptImage(
  imageBase64: string,
  config: LLMProviderConfig,
): Promise<ParsedReceipt> {
  const rawJson = await callLLMVisionAPI(imageBase64, config);

  // Step 1: Parse & validate against Zod schema (throws ZodError if invalid)
  const parsed = ParsedReceiptSchema.parse(rawJson);

  // Step 2: Mathematical reconciliation gate (throws MathReconciliationError)
  validateParsedReceipt(parsed);

  return parsed;
}

// ── LLM API Callers ─────────────────────────────────────────

async function callLLMVisionAPI(
  imageBase64: string,
  config: LLMProviderConfig,
): Promise<unknown> {
  if (config.provider === "openai") {
    return callOpenAI(imageBase64, config);
  } else {
    return callGemini(imageBase64, config);
  }
}

async function callOpenAI(
  imageBase64: string,
  config: LLMProviderConfig,
): Promise<unknown> {
  const model = config.model ?? "gpt-4o";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: "Parse this receipt. Output ONLY the JSON object, no other text.",
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response content");
  }

  return JSON.parse(content);
}

async function callGemini(
  imageBase64: string,
  config: LLMProviderConfig,
): Promise<unknown> {
  const model = config.model ?? "gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
            {
              text: "Parse this receipt. Output ONLY the JSON object, no other text.",
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 2000,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini returned empty response content");
  }

  return JSON.parse(content);
}
