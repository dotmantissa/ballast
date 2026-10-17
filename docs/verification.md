# Verification record

## Local checks

All three contracts pass GenVM lint with their concrete pinned runner. The current direct suite has 140 passing tests. It executes contract methods and SDK storage in direct mode, with controlled web and model results. Captured validator callbacks also receive independent matching and differing answers. These tests establish application behavior, not live validator decisions.

The Node 22 suite has 82 passing tests covering encrypted custody, public input validation, indexed record retrieval, safe public evidence rendering, capital redemption estimates, execution receipts, operation retries, exact signed transaction recovery, archived capital access and fixed confirmation repair routes. TypeScript and ESLint pass. The latest hosting and browser results are recorded below only after publication checks complete.

The Neon operation migration completed. Tables are namespaced for Ballast. No user records were inserted to simulate authentication. Signed broadcasts are encrypted before relay and are excluded from API responses.

## Studio runtime correction

The first review quote finalized with a leader execution timeout before a risk decision. A live read only probe returned the registered agent through the default storage view while the explicit finalized view timed out. Studio's host rejects that storage flag. The diagnostic contract is in `tests/integration/contracts/finality_probe.py`; deployment transaction `0x9662ca4f0e98e41639869facfe3438b960a8947634dea108bca1cb8c50cd9de1` created `0x4eC275600Aa613Fd716F5e0FCE58519Bb733aB70`. Its source registry is `0xc7e99F1D090bD0CA7c7Ed2b2d5F39E40e832713E`, with agent `892d26f427a05a5c100ce76e`. The failed quote is `0x52fa5074780d7c678bf34f96d75e3413454bc25c153e16966f0792ea6e1cfe55`. Neither failure is counted as a successful judgment.

The corrected contracts use [authenticated finalized message proofs](finality.md). Tests reject external or altered callbacks, require court proof before settlement, require a filing seal before expiry and prevent delayed confirmations from rewinding records. Application status alone cannot authorize payment.

## Real claims lifecycle

The maintainer workflow deploys a separate contract set, verifies its actual explorer source bytes, schemas and links, and reuses protected signed journals after interruption. It uses separate claimant and executor accounts and an intentionally insecure test vault. The claimant funds real native test GEN escrow. Approved history is executed before cover; a later unapproved native debit supplies the incident. Signed history and incident snapshots are published at immutable evidence commits. Model fixtures never replace risk or claim decisions.

The [completed Studio lifecycle](review-integration-result.json) passed on 17 October 2026. It established successful binding, all four real findings, an upheld operator scope appeal, mutual acceptance, finalization, authenticated decision and settlement confirmations, claimant native payout, bond withdrawals and recorded operator loss. The claimant received exactly 0.2 Studio GEN plus 0.02 GEN in returned bonds. The pool retained 0.8 GEN of cover and its 3.82 GEN native balance matched TVG exactly. All six judgments had at least two independent agree votes. The [receipt lineage record](review-finality-result.json) independently checks all five emitted confirmation and acknowledgment paths. The older `docs/integration-result.json` covers wiring, capital movement, registration and rejection of unsupported cover only. It is historical evidence and does not establish a successful claim.

The 24 hour challenge window is not shortened by a deployment flag. Both actual parties may voluntarily accept the current decision, using the same public method available to any case. Appeals clear both acceptances. Time travel is confined to direct tests.

## Production transition

Original production capital remains in its immutable pool. The transition inspection found 20 Studio GEN and no policies or claims there. Holder initiated redemption and withdrawal remain accessible in Capital, using the archived address. No account is migrated automatically. Archived contracts retain their earlier code and rules; new safeguards apply to the corrected deployment. The custody master key is preserved. The corrected application pool was source verified and empty before promotion. The [transition readback](deployment-transition.json) records both deployments and the earlier native balance.

## Browser and hosting

The public app is https://ballast-cover.vercel.app. Email delivery and authenticated interaction require the actual mailbox; no bypass is installed. Browser tests cover public data, navigation, theme persistence, email only authentication, mobile bounds, sticky navigation, hostile public URLs, older record lookup and confirmation recovery. Headless Chromium uses locally extracted system libraries under `/tmp/ballast-browser-deps`, which are not application dependencies.

Hosting credentials are server environment variables. The deployer key is not installed on Vercel. Public cache entries are scoped to the exact pool address and stale data is identified. Current deployment hashes, verification times and transaction hashes are in `deployments/studio.json`; the preceding pool remains in `deployments/previous-studio.json` after promotion.

## Operational limits

The observed Studio allowance is 500 requests per hour from this environment. Local scripts support `BALLAST_CURL_RPC=1` when Node HTTP cannot reach the same endpoint. It sends the identical SDK requests through curl with bodies on stdin and paced capacity retries. Production uses the SDK transport.

Clean test runners explicitly select SDK v0.2.16 because gltest 0.29.2 requests an asset removed from newer release bundles. The selected bundle contains the concrete runner pinned by these contracts. This is a test loader selection, not a floating contract dependency.

A successful execution is checked separately from transaction lifecycle status. A finalized transaction can still contain an execution error. Unknown broadcasts are reconciled using their saved identity; a fresh attempt requires a confirmed terminal failure. Independent security audit and mainnet economic guarantees are outside these verification results.
