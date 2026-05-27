# Lemon Squeezy setup — Vibemeter Pro

Step-by-step to go from "no account" to "live checkout URL" so the `/pricing` CTA actually sells. Total time **~1-2 hours**, plus 1-3 business days for KYC review before payouts work.

The Vibemeter codebase already implements the license activation / validation / deactivation flow against LS's **license-key API**. You only need to (a) create the product and (b) wire the checkout URL into env.

---

## 0. Prerequisites

- **Email** for the account.
- **A bank or PayPal account that can receive USD**:
  - 中国大陆个人卡通常不能直接收 USD 国际打款。可选：
    - PayPal（手续费高、风控严，仅做应急）
    - Wise 多币种账户（推荐，开户快）
    - 香港 / 新加坡 / 美国实体银行
- **ID / business docs for KYC** (passport or company registration).

---

## 1. Account + Store

1. Sign up at <https://lemonsqueezy.com>.
2. Verify email.
3. **Settings → Account → Verify Identity**: complete KYC. Review takes a few hours to 3 business days. You can build product immediately; payouts unlock after approval.
4. **Stores → New Store**:
   - Name: `Vibemeter`
   - Currency: `USD`
   - Timezone: your local zone
   - Save.

---

## 2. Product — "Vibemeter Pro Founding"

1. **Products → New Product → Single Payment**.
2. Fill:
   - **Name**: `Vibemeter Pro`
   - **Variant name**: `Founding License`
   - **Price**: `39` USD
   - **Description**: short copy — runway meter, cache diagnostics, full history, 2 device activations, 1 year of updates. (Mirror the `/pricing` page.)
3. **License keys section — this is the key step**:
   - Toggle **Enable license keys** ON.
   - **Activation limit**: `2` (matches what the UI promises).
   - **Length**: `36 chars / 8-4-4-4-12` (default; matches what the activate API expects).
   - **Expiration**: pick one of:
     - "License never expires" → users keep activations forever, just no free upgrades after 1 year (manual policy).
     - Set to 365 days if you want hard cutoff at 1 year. Cleaner but harsher.
4. **Files** (optional): you can upload a zipped download here, but Vibemeter is installed via `install.sh` so leave this empty.
5. **Save**.

---

## 3. Wire checkout URL into Vibemeter

1. Open the product detail page in LS.
2. Click **Share** or grab the **Buy URL** — looks like `https://hirra.lemonsqueezy.com/buy/<UUID>`.
3. In the Vibemeter repo, add to `.env.local` (create if absent):
   ```
   NEXT_PUBLIC_VIBEMETER_CHECKOUT_URL=https://hirra.lemonsqueezy.com/buy/<UUID>
   ```
4. **`NEXT_PUBLIC_*` is build-time inlined.** After changing, run `npm run release` (or at minimum `npm run build`) — the previous release tarball does not have the URL baked in.
5. Verify: visit `/pricing` — the "Get Pro — $39 Founding License" button should now be an active violet link (not the disabled "Checkout coming soon" stub).

---

## 4. Test mode walkthrough

LS has a sandbox that doesn't charge real money. Use it before going live.

1. Toggle **test mode** in the top-right of the LS dashboard (yellow banner appears).
2. Visit `/pricing` from your Vibemeter, click **Get Pro**.
3. At LS checkout, use a test card:
   - Number: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits
   - Address: anything
4. Complete the purchase. LS shows the issued license key — copy it.
5. In Vibemeter **Settings → 订阅 / License**, paste the key, click **Activate**. Expected:
   - Button shows "激活中…" → "已激活 — Pro 已启用"
   - Panel switches to the Active state with masked key `****-****-XXXX`, "Last validated" timestamp.
   - The "Pricing" link in the dashboard header and the "Upgrade" pill in Settings header should disappear (since plan ≠ free).
6. Click **Deactivate this device** — panel returns to Free.
7. Re-activate the same key — should work (back to 2/2 slots after deactivate).
8. Try activating twice from two different devices (or wipe `~/.vibemeter/license-state.json` between activations to simulate) — third attempt should fail with `billing.error.activationLimit`.

---

## 5. Going live

1. Toggle **test mode OFF** in LS.
2. Re-open the product → grab the **production** checkout URL (often the same UUID, but verify).
3. Confirm `NEXT_PUBLIC_VIBEMETER_CHECKOUT_URL` points to the production URL.
4. `npm run release` — siney now serves the bundle with the live URL.
5. Make one real $39 purchase yourself to validate end-to-end (refund yourself from the LS dashboard afterward).

---

## 6. What our code expects from LS

- **License-key endpoints** (`/v1/licenses/activate`, `/validate`, `/deactivate`) — public, no API secret needed. ✓ implemented in `src/lib/license/lemonsqueezy.ts`.
- **`license_key.status` values** we handle: `active`, `expired`, `disabled`, `inactive`.
- **Activation limit / usage** surfaced from `license_key.activation_limit` / `activation_usage`.
- **`instance.id` / `instance.name`** echoed back on activate; we store them locally to call validate / deactivate later.
- Anything else (subscriptions, webhooks, tax breakdowns) — not consumed by the client.

**We do NOT need the main LS API secret** for any of this. Keep that secret on the LS dashboard only. The license-key endpoints authenticate by the license key itself.

---

## 7. Customer support runbook

- **Refund**: pricing page promises 14-day refund. Refund button is in LS dashboard → Orders → that order → Refund.
- **"My key doesn't work"**: ask the user to copy-paste the error message (it surfaces our i18n `errorKey`). Common causes:
  - `billing.error.invalidKey` — typo, or you refunded their order (refunds invalidate the license).
  - `billing.error.activationLimit` — they have 2 devices already; deactivate one in their Settings → Billing.
  - `billing.error.network` — their machine can't reach `api.lemonsqueezy.com`. Have them whitelist.
- **Subscription / team plans**: not implemented yet. The `Team` plan on /pricing is a `Coming Soon` placeholder.

---

## 8. Future — webhooks

Not needed today. If you later add subscriptions / team seats:

- LS supports webhooks for `order_created`, `subscription_created`, `subscription_payment_failed`, etc.
- Endpoint: add `src/app/api/license/webhook/route.ts` with HMAC signature verification using the LS signing secret.
- Use webhook events to update server-side state (e.g. revoke license on chargeback). For now, the client validates lazily every 7 days, which is good enough for a single-payment model.

---

## TL;DR

```bash
# After LS product is created:
echo 'NEXT_PUBLIC_VIBEMETER_CHECKOUT_URL=https://hirra.lemonsqueezy.com/buy/<UUID>' >> .env.local
npm run release
# Test in test mode → flip live → first real sale.
```
