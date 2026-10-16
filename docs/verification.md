# Verification record

## Local checks

All three contracts pass `genvm-lint check` with a concrete pinned runner. The direct suite contains 63 passing tests. It runs real GenLayer SDK storage and method code in direct mode. External response fixtures are confined to tests. Validator callbacks are explicitly exercised with independent matching and differing results.

The TypeScript utility suite has 25 passing tests for custody encryption, per user key isolation, tamper rejection, amount validation, public URL constraints and execution receipt interpretation. TypeScript checks and ESLint pass. A production Next.js build passed on Node 22 and on Vercel. The public application and data endpoint both return HTTP 200.

Neon migration completed successfully. Tables are namespaced for Ballast. No user records were inserted to simulate authentication.

## Studio

The production contract deployment and wiring execution results were checked, not inferred from lifecycle status. Final addresses and transaction hashes are in `deployments/studio.json`. The preceding empty pool is retained in `deployments/previous-studio.json`. All three final schemas, source hashes and cross contract links were verified after deployment. Contract schemas and live finalized state reads were verified. The application pool starts empty.

A separate deployment is used for network integration tests so test activity does not appear in the application. Live integration passed on 16 October 2026. It verified contract wiring, native staking, share redemption, actual receipt of withdrawn funds, immutable registration and independent validator rejection of unsupported cover. Transaction hashes are in `docs/integration-result.json`. The isolated deployment precedes the final overlapping policy and claimant reference guards; those guards have dedicated direct regression tests. The 24 hour application challenge window is covered by time travel in direct tests; it is never shortened in the deployed application contracts.

## Browser

Initial desktop verification at 1440 pixels returned HTTP 200, displayed the custom interface, reported no JavaScript errors and had no horizontal overflow. All five Playwright checks passed against https://ballast-cover.vercel.app in 20.1 seconds on the final deployed contract addresses. They cover desktop navigation, actual pool data, persisted dark theme, email only login and Escape closure, mobile navigation without horizontal overflow, private API rejection, foreign origin rejection, terms and privacy.

The headless browser uses locally extracted Ubuntu shared libraries in `/tmp/ballast-browser-deps` because this environment lacks the default Chromium dependencies. These files are outside the repository and are not application dependencies.

## Verification limits

The scan of tracked source and compiled browser bundles found none of the supplied secret values. Production contract hashes match their source files. Real email delivery and authenticated user interaction require access to the mailbox being verified; no authentication bypass is installed.

## Hosting and recovery

The public Next.js app and backend run on Vercel at https://ballast-cover.vercel.app. Server credentials are sensitive Vercel environment variables. The deployer key is not installed on the hosted app. A shared Neon cache reduces Studio reads and scopes each snapshot to its pool address. A stale snapshot is identified as such.

The observed Studio allowance was 500 requests per hour from this environment. Local Node HTTP requests also timed out while curl to the same endpoint succeeded. Local scripts support `BALLAST_CURL_RPC=1` to send the same SDK JSON RPC requests through curl, with request bodies on stdin. This option is confined to local tooling. Production uses the SDK’s ordinary HTTP transport.

The final production deployment is `dpl_BHWbrZ2t856R5Lr7EqYaZF9UEiML`. A separate API assertion confirmed that the hosted app uses all three final contract addresses, reports fresh network state and contains no seeded agents, claims or capital.
