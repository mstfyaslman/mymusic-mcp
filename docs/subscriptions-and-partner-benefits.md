# MyMusic subscriptions, entitlements, and partner benefits

## Product model

MyMusic sells its own membership. A membership may include:
- MyMusic-native premium features.
- A clearly described partner benefit, voucher, sponsored access, or add-on, but only where MyMusic has a written commercial agreement and the provider authorizes the distribution method.
- Optional partner benefits selected by the member where the provider requires member consent or account linking.

Do not promise YouTube Premium, Anghami Premium, or another third-party paid tier until the corresponding provider agreement, eligibility rules, fulfilment method, and per-member cost are confirmed.

## Important provider restrictions

- YouTube family memberships are for up to five additional members of the manager's household. All members must live at the same residential address. Do not use a family plan as a general resale pool for unrelated MyMusic subscribers.
- Do not collect a member's Google, Anghami, or other third-party password. Do not create, share, or resell consumer accounts in a way the provider does not authorize.
- A partner bundle must be backed by a provider-approved commercial agreement, voucher/API/partner fulfilment, or other expressly authorized channel.

## Payment and activation lifecycle

1. The member signs in through a real server-verified account. Browser localStorage is never an identity or entitlement authority.
2. The server creates a pending order with an immutable plan ID, price, currency, billing period, and selected optional benefits.
3. The payment provider checkout is created server-side. API credentials are Cloudflare secrets and must never be sent to the browser or committed to Git.
4. The payment provider sends a server-to-server webhook. Verify the provider's documented signature/authentication, amount, currency, merchant/order reference, and final captured/paid state.
5. Process webhook events idempotently. A repeated event must not extend the subscription twice or issue a partner benefit twice.
6. Only after verified payment, write the membership entitlement and expiry to a server-side database/KV with a unique payment reference.
7. If an optional partner benefit is selected and eligible, fulfil it using the partner's authorized API/voucher workflow. Store only the provider reference and fulfilment state, never third-party passwords.
8. If partner fulfilment fails, keep the MyMusic membership state accurate and create a retry/refund/support task for the partner component. Never claim the external benefit was activated when it was not.
9. On refunds, chargebacks, cancellation, or expiry, update entitlements according to the plan terms and provider agreement. Keep an auditable payment and entitlement ledger.

## Revenue accounting

For every paid order, record separately:
- Gross amount collected.
- Payment-provider fees and taxes where applicable.
- Partner wholesale cost or voucher cost.
- Refunds/chargebacks.
- Net amount payable to the site owner.

Do not silently charge a member for an optional service. The plan page and checkout must clearly state whether a partner service is included, optional, or unavailable. The member should understand the bundle terms and any recurring renewal.

## Current implementation status

The current MyMusic repository has local-only profile preferences. The health endpoint reports authentication and payments as disabled. Therefore automatic paid membership activation is not production-ready yet.

Production activation is blocked until all of the following exist:
- A real authentication/session provider and server-side member database.
- A merchant account with the chosen payment provider (for example Paymob or Fawry Accept).
- Provider-specific checkout and verified webhook implementation.
- Cloudflare production secrets and any required KV/D1 bindings.
- Confirmed subscription prices, billing terms, refund/cancellation policy, and tax treatment.
- A signed partner agreement and documented fulfilment method for every third-party premium benefit.

Never change the health endpoint to report payments or partner benefits as enabled until end-to-end verification has been completed in the provider's test environment and production configuration.
