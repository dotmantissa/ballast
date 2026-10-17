These checks use a real email session and the deployed Studio contracts. They create public records and move test GEN. They are deliberately separate from the ordinary browser suite.

The scenario file defines three checks for each feature. Results, account snapshots, executor keys and exact request journals stay under the ignored `.ballast-private/account-tests` directory with owner only permissions. A passed check is skipped on recovery. Failed broadcasts must be reconciled before another attempt. The harness records each browser action before continuing its original request to the real backend; it never supplies a response.

The registered account signs through Ballast’s normal authenticated relay. `scripts/account-test-actors.ts` prepares three controlled executors and a distinct claimant. It never reads the registered account’s signing key. Signed public evidence includes only actual receipts and deliberately controlled vault activity. The source vault has an insecure spend method for these tests.

Private state lives outside the contract runner’s generated output. Critical journals and actor keys also have an owner only backup under `.git/ballast-account-tests-backup`. Creating actors requires `BALLAST_CREATE_ACCOUNT_ACTORS=1`; a missing file never silently replaces an existing identity. Keep the private run directory and its backup until every test commitment has been reconciled.

To resume an authorized journey, use Node 22 and the existing protected browser state:

```sh
BALLAST_LIVE_ACCOUNT_TEST=1 \
BALLAST_ACCOUNT_EMAIL=your.authorized.email \
BALLAST_ACCOUNT_ADDRESS=0xYourPublicStudioAddress \
node scripts/account-test-browser.mjs
```

If the session has expired, the console uses the real Privy email code. Commands are JSON, for example `{"action":"register","executor":"first","case":1}` or `{"action":"quote","executor":"first","case":1}`. Use `{"action":"exit"}` to close it. The console checks the authenticated account before allowing a test action.

The current journey includes owner assisted observations of the earlier pool’s successful redemption and withdrawal. Those two operations belong to the account owner, as confirmed during the session. The remaining earlier pool checks use empty positions or excessive amounts and preserve its remaining senior position. The complete run report distinguishes successful checks, contract refusals, validator disagreement and cases blocked by real time windows.
