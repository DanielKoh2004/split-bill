# PROJECT CONSTRAINTS: ZERO-FRICTION SPLIT BILL APP

## 1. Architectural Mandates
* **Separation of Concerns:** The OCR pipeline, the Math Engine, and the Payment Generator must be completely decoupled. They communicate only via strictly typed interfaces.
* **Stateless by Default:** The backend should process the receipt, calculate the split, generate the payment link, and then *forget* the transaction unless explicitly saved by the user. Do not build a persistent debt ledger.
* **Zero-Knowledge Principles:** Never log raw receipt images or unmasked user data. If data must be stored for dispute resolution, it must be cryptographically hashed or encrypted client-side. The server should only verify proofs, not hold raw financial data.

## 2. Technical Standards
* **Strict Typing:** Use TypeScript (or Pydantic if Python). Any data entering or leaving a module must be validated against a schema. Silent failures are unacceptable.
* **Deterministic Math Only:** NEVER use floating-point numbers for currency. All monetary values must be calculated and stored as integers (e.g., cents/sen). 
* **Fail Loudly:** If the OCR confidence is low, or if `sum(items) + tax + tip != total`, the system must throw a specific error, not attempt to guess or hallucinate the difference.

## 3. Localization
* **Target Market:** Malaysia/SEA. Default currency logic should handle MYR. Payment generation must prioritize local rails (DuitNow QR, Touch 'n Go eWallet deep links) over generic US-centric integrations.