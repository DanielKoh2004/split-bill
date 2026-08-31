<div align="center">

# 🍽️ SPLIT-BILL

### *One table. One receipt. Everyone pays their share.*

**A Malaysian group-settlement app that turns a receipt into a live shared bill — then turns the final balance back into DuitNow.**

`RECEIPT → PEOPLE → CLAIMS → BALANCES → PAYMENT`

</div>

---

# 🧾 Tonight's Table

Imagine this:

You are six people deep into dinner.

The waiter drops one giant receipt.

Then someone says:

> “Okay… who had what?”

Five minutes later, everyone's opening calculator apps.

**Split-Bill removes that moment.**

```text
             THE OLD WAY

    Receipt
       ↓
   "Who ate this?"
       ↓
   Mental math
       ↓
   Calculator
       ↓
   "Wait, did you include SST?"
       ↓
   Someone owes RM0.37
       ↓
   😭


             THE SPLIT-BILL WAY

    📸 Receipt
       ↓
    AI parsing
       ↓
    👥 Claim items
       ↓
    🧮 Exact reconciliation
       ↓
    🇲🇾 DuitNow QR
       ↓
    ✅ Done
```

---

# ✦ SEE IT BEFORE YOU READ IT

The existing product screenshots are intentionally kept here — **these are the real UI designs from the repository, not mock placeholders.**

### ☀️ Light / 🌙 Dark

<table>
<tr>
<td align="center"><b>LIGHT · ENGLISH</b><br><br><img src="./public/docs/default_light_english_1774798917799.png" width="430"></td>
<td align="center"><b>DARK · ENGLISH</b><br><br><img src="./public/docs/dark_mode_english_1774798931920.png" width="430"></td>
</tr>
<tr>
<td align="center"><b>LIGHT · 中文</b><br><br><img src="./public/docs/light_mode_chinese_1774798959449.png" width="430"></td>
<td align="center"><b>DARK · 中文</b><br><br><img src="./public/docs/dark_mode_chinese_1774798949185.png" width="430"></td>
</tr>
</table>

<br>

*The interface supports instant Light/Dark and English/Simplified Chinese switching without a full-page reload.*

---

# 🍜 THE RECEIPT IS THE DATABASE

Split-Bill starts with the physical source document.

```text
┌───────────────────────────────┐
│         RESTAURANT            │
│                               │
│ Chicken Rice       RM 12.00   │
│ Nasi Lemak         RM 10.00   │
│ Pizza             RM 24.00   │
│ Milo              RM  4.50   │
│                               │
│ SST                RM  2.83   │
│ Service Charge     RM  4.05   │
│ ───────────────────────────── │
│ TOTAL              RM 57.38   │
└───────────────────────────────┘
                │
                ▼
         structured receipt
```

The receipt parser turns the image into structured line items that the rest of the system can reason about.

That means the user does not have to rebuild the bill manually.

---

# 👥 WHO ATE WHAT?

The interaction model is deliberately closer to **shopping cart ownership** than a traditional “split equally” calculator.

### Exclusive

```text
Chicken Rice
     │
     └────────► Daniel
                 RM 12.00
```

### Shared

```text
Pizza
 │
 ├────► Daniel   1/2
 └────► Aidan    1/2
```

The claim engine supports both modes while preventing an item from becoming simultaneously exclusive and fractional.

---

# ⚠️ THE LAST SLICE PROBLEM

What happens when everyone taps **Claim** at almost the same time?

```text
Daniel ──┐
Aidan  ──┤
Sean   ──┼──► CLAIM PIZZA
YT     ──┤
Guest  ──┘
```

A normal read → modify → write flow can race.

Split-Bill moves the critical operation into **atomic Lua execution in the KV layer**.

```text
Daniel ──┐
Aidan  ──┤
Sean   ──┼──► ATOMIC CLAIM
YT     ──┤        │
Guest  ──┘        ▼
              CONSISTENT STATE
```

The implementation includes dedicated claim scripts for exclusive and shared-item operations, including cross-mode protection.

---

# 🧮 MONEY HAS NO DECIMALS

Not internally, anyway.

```text
RM 10.00
   ↓
1000 sen
```

Why?

Because this:

```text
10.00 / 3
```

is not a clean monetary representation.

But this is:

```text
1000 / 3
```

```text
333 + 333 + 334 = 1000
```

The reconciliation engine works in integer sen/cents and systematically distributes the remainder so that the final participant balances still equal the receipt total.

> **The bill should reconcile to the last sen.**

---

# 🍕 SHARED FOOD ≠ SHARED TAX CHAOS

Taxes and service charges also need to follow the bill.

```text
                    RECEIPT
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
       LINE ITEMS            CHARGES
            │                SST / SERVICE
            └──────────┬──────────┘
                       ▼
                 FINAL BALANCES
```

Changing a parsed item can therefore propagate through its downstream charge allocation rather than leaving stale amounts behind.

---

# 🇲🇾 PAYMENT, WITHOUT ANOTHER WALLET

The final step uses **DuitNow QR** rather than inventing another payment ecosystem.

```text
          HOST'S QR
             │
             ▼
        EMVCo parsing
             │
             ▼
       merchant details
             │
             ▼
        inject amount
             │
             ▼
        rebuilt QR
             │
             ▼
       existing bank app
```

The repository has a dedicated `duitnowQR.ts` module and tests around QR handling.

The payment flow is therefore:

**claim first → calculate exactly → pay through the rail everyone already has.**

---

# ⏳ THE BILL EXPIRES

A restaurant bill is an event, not a permanent social record.

```text
      CREATE
        ↓
      SHARE
        ↓
      CLAIM
        ↓
      SETTLE
        ↓
       ⌛
      EXPIRE
```

The current design uses short-lived KV storage with a **2-hour TTL** for temporary session state.

The project also applies privacy controls around uploaded receipt images, including metadata handling and a 500 KB upload limit.

> **Dinner ends. The session should end with it.**

---

# 🗺️ FROM ONE DINNER TO A WHOLE TRIP

Trip Mode treats multiple dinners as one eventual settlement.

```text
FRI NIGHT      RM 42.80
SAT BRUNCH     RM 18.50
SAT DINNER     RM 67.30
COFFEE         RM 11.20
               ────────
TOTAL         RM139.80
```

Distinct sessions can be combined into a payment hub so the user does not need to manually reconcile four separate micro-debts.

---

# 🎨 TWO LANGUAGES. TWO THEMES. ONE BILL.

The interface was built with a custom theme/context system and a dedicated i18n layer.

```text
                 SPLIT-BILL
                     │
             ┌───────┴───────┐
             ▼               ▼
          VISUAL            LANGUAGE
             │               │
        ┌────┴────┐       ┌──┴───┐
        ▼         ▼       ▼      ▼
      LIGHT     DARK     EN     中文
```

The four existing screenshots above demonstrate all four combinations.

---

# 🧠 ARCHITECTURE, IN ONE MEAL

```text
                         USER
                          │
                          ▼
                  ┌──────────────┐
                  │  NEXT.JS UI  │
                  └──────┬───────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     RECEIPT           CLAIMS           PAYMENT
      PARSER           ENGINE             QR
        │                │                │
        ▼         ┌──────┴──────┐         ▼
    STRUCTURED    │   ATOMIC    │      EMVCo
       BILL       │ LUA / KV    │      REBUILD
        │         └──────┬──────┘         │
        └────────────────┼────────────────┘
                         ▼
                  MATH / RECONCILE
                         │
                         ▼
                    FINAL BALANCE
                         │
                         ▼
                     DUITNOW
```

---

# 🧰 TECHNOLOGY

| Layer | Choice |
|---|---|
| Web framework | **Next.js 15** |
| UI | **React 19** |
| Language | **TypeScript 5** |
| Styling | **Tailwind CSS 4** |
| Ephemeral state | **Vercel KV** |
| QR decoding | **jsQR** |
| QR generation | **qrcode.react** |
| Validation | **Zod** |
| Icons | **Lucide React** |
| Testing | **Vitest** |

The dependency manifest in the repository confirms this application stack.

---

# 📦 PROJECT MAP

```text
split-bill/
│
├── app/                 → routes + application UI
│
├── src/
│   ├── receiptParser.ts → receipt → structured items
│   ├── mathEngine.ts    → exact monetary reconciliation
│   ├── duitnowQR.ts     → EMVCo QR parsing / rebuilding
│   ├── privacy.ts       → privacy helpers
│   ├── rateLimit.ts     → request protection
│   ├── ThemeContext.tsx → theme state
│   ├── i18n.ts          → localization
│   └── *.test.ts        → automated tests
│
├── public/docs/         → product screenshots
├── constraints.md       → implementation constraints
└── package.json
```

---

# 🚀 RUN LOCALLY

```bash
git clone https://github.com/DanielKoh2004/split-bill.git
cd split-bill
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Run tests:

```bash
npm test
```

Production:

```bash
npm run build
npm start
```

Configure the required `.env.local` values for the project's KV and receipt-processing integrations.

---

# 🧪 THE INTERESTING ENGINEERING PARTS

This project looks simple from the outside.

Underneath, it combines several surprisingly serious problems:

| Problem | Engineering response |
|---|---|
| Messy receipt image | Structured receipt parser |
| Multiple people claiming simultaneously | Atomic Lua operations |
| Shared-item ownership | Explicit fractional claims |
| Floating-point currency | Integer sen arithmetic |
| Tax / service allocation | Proportional reconciliation |
| Payment interoperability | EMVCo / DuitNow reconstruction |
| Temporary personal data | TTL-based ephemeral state |
| QR manipulation | Strict parsing + validation |

That's what makes the project more than a “split calculator”.

---

# 🥢 THE DESIGN PHILOSOPHY

### **Less typing.**

Start from the receipt.

### **Less arguing.**

Everyone claims their own items.

### **Less rounding.**

Calculate in sen.

### **Less infrastructure.**

Use existing payment rails.

### **Less data retention.**

Let the session expire.

---

# 🍽️ ONE LAST RECEIPT

```text
╭──────────────────────────────────────╮
│              SPLIT-BILL              │
│                                      │
│    Scan it.                          │
│    Claim it.                         │
│    Split it.                         │
│    Settle it.                        │
│                                      │
│    And get back to dinner.           │
╰──────────────────────────────────────╯
```

<div align="center">

### **Split the bill. Keep the dinner.**

[GitHub Repository →](https://github.com/DanielKoh2004/split-bill)

</div>
