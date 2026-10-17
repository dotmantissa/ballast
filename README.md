# Ballast

A little weight. A steadier course.

Ballast is capital set aside for the moment an autonomous agent spends beyond its authority and someone else bears the cost. An operator declares the agent’s scope before buying cover. Capital providers back that promise. GenLayer validators decide claims from public evidence, and either side can challenge a specific finding.

The first version covers one narrow peril: an unauthorized debit of a third party’s own native GEN funds in an exact top level GenLayer Studio transaction by the insured executor. Limits stop at 100 Studio GEN. Policies last 30 days, with another 7 days to file a claim about an incident during that term. This is an experimental discretionary cover pool. Studio funds have no monetary value. Ballast is not a regulated insurance product.

## Use it

The app is live at [ballast cover](https://ballast-cover.vercel.app).

Sign in with an email code. Open your account menu to add 25 test GEN from the Studio faucet. No browser wallet is needed. Ballast creates a custodial account, encrypts its signing key and submits the actions you request. Do not send real assets to it.

Operators register a JSON manifest with a name, detailed scope, executor address and whole number `spend_limit_gen`. Public execution history accompanies the manifest. The original text, its raw hash and a canonical JSON hash stay together in the registry. Executor identity stays the same across formatting changes and manifest revisions. The executor must register itself or explicitly authorize the operator first. Old revisions stay immutable; cover binds one exact revision. To request a quote, add relevant public peer evidence and choose a limit. Validators assess a risk band and explain why. A quote lasts one hour. An executor can hold one active or runoff Ballast policy at a time. Binding pays the premium and reserves the full coverage limit.

Claimants select or look up a policy, provide the exact native debit transaction hash and timestamp including seconds, explain the loss and supply public evidence from at least two normalized hosts. The workspace submits the four reviews in sequence while it is open and resumes them when the claimant returns. Account recovery uses every unresolved case, including older records outside the public page. Each finding has a stable request key; safely failed attempts can retry, while uncertain broadcasts are reconciled using their saved signed identity. A filing bond is 1% of the requested amount, with a minimum of 0.01 GEN. Successful claims return that bond. An adjudicated rejection awards it to the operator. Withdrawal or an evidence timeout returns it to the claimant without deciding that no harm occurred.

Existing capital stays in the earlier pool when immutable contracts are replaced. Sign in and open Capital to see earlier positions, redeem those shares and withdraw their credit. Nothing is moved automatically, and earlier shares do not become shares in the new pool. The earlier contract keeps its original code and rules; this app offers withdrawal access to it, with new capital and cover directed to the corrected pool. The earlier pool address remains public in the deployment archive.

Capital providers choose junior or senior exposure. Junior capital absorbs losses first. When both tranches hold capital, junior receives 80% of premiums and senior receives 20%. A sole funded tranche receives the whole premium. Shares track the value of each tranche. Each policy locks its own backing and premium allocation in each tranche until that liability ends. Junior cannot take its premium and immediately leave senior with the risk. Redemptions preserve these locks. A wiped out tranche starts a separate share generation when fresh capital arrives; old holders cannot block recapitalization or dilute the new generation. Redemptions and claim payouts become credits that recipients withdraw.

## Why four findings matter

“Should we pay?” is too broad a question for useful validator comparison. Ballast asks four smaller questions.

1. Did a realized, measurable harm occur to the claimant during the policy period?
2. Did the registered agent cause that exact harm?
3. Was the action permitted by its original declared scope?
4. What fraction of the claimed loss does the evidence support?

Each finding has its own transaction and independent validator assessment. The first three answers are strict booleans. The payout answer is one of 0, 25, 50, 75 or 100 percent. Validators fetch the sources themselves, rerun the assessment and compare that finding alone. Wording may differ; the decision must match exactly. Positive harm also compares the independently established loss and event time exactly, against the authoritative coverage dates. A valid JSON shape is never treated as evidence that a leader is right.

V1 pays only when harm and causation are true and scope is false. The payout is bounded by the requested loss and remaining cover. One unavailable source does not block review when two reachable hosts still corroborate the case. Otherwise the review pauses for evidence repair, rather than silently rejecting the claimant.

## Appeals and settlement

The claimant or operator can bond an appeal for one finding during a 24 hour challenge period. The appeal bond is 1% of the claim, with a minimum of 0.01 GEN. A changed finding returns it; an unchanged finding awards it to the other party. Each party has its own appeal for each boolean finding and each payout revision. One party cannot consume the other’s opportunity. All accepted appeal evidence is fetched again for dependent assessments. A changed boolean invalidates the dependent payout finding, which must be resolved again. Completed revised findings start a fresh challenge period.

Both parties may explicitly accept a complete decision to waive the remaining challenge time. Any appeal clears both acceptances. After the window closes or both parties accept, anyone can finalize the claim and settle it with the pool. A rejected claim leaves the policy intact. Loss identity uses the exact native debit transaction and claimant, independently of agent registrations, policy IDs or free text. One award per claimant and transaction is allowed across policies. Harm assessment independently checks the official Studio record for a finalized top level transaction sent by the insured executor. Child transfer receipts cannot create another loss identity. If that authoritative record is unavailable, review pauses for retry under the same deadline. The pool tracks actual compensation and checks independently verified loss and dates again at settlement. A payment reduces remaining cover. Settlements update the pool’s authoritative operator loss record immediately, so a missed registry synchronization cannot hide a loss from the next quote.

Distinct losses may be filed concurrently. They share one aggregate policy limit. Finalized settlements consume it in settlement order; an assessed award may be paid partially or receive zero after the limit is exhausted. Every case can still record a settlement and leave the recovery queue.

Incomplete review has a fixed seven day deadline. Either party can add replacement evidence under its own twelve URL allowance. Evidence edits and partial findings do not extend the clock. Changed eligibility gives dependent payout review seven days; finite independent appeal rights bound the full case to 70 days of review and challenge time. Anyone can close an overdue review; the claimant may also withdraw an unfinished case. After the filing window, runoff retains only the lesser of remaining cover and combined unsettled requests. Unused backing is released.

Accounting consumes authenticated confirmations emitted only after source transactions finalize. A court status alone cannot authorize payment. Studio does not currently support its explicit finalized cross contract storage flag; [the finality design](docs/finality.md) explains the message provenance, immutable records and recovery paths used instead. Expiry requires a finalized filing seal. Native withdrawals are emitted on finalization; their receipts remain inspectable.

## Contracts

`contracts/agent_registry.py` stores immutable manifests, executor identity, operator identity and access to the authoritative loss record.

`contracts/underwriting.py` prices quotes, binds policies, accepts capital, reserves limits, allocates losses and credits recipients. Base premium rates are 2%, 5% and 10% for low, medium and high risk. Each paid claim adds one percentage point, up to ten additional points. Total rates cannot exceed 20%.

`contracts/claims_court.py` stores incidents, retrieves public evidence, resolves findings independently, handles scoped appeals and finalizes decisions.

Live addresses, source hashes, deployment transactions and wiring transactions are recorded in [the Studio deployment record](deployments/studio.json). All three use a concrete pinned GenVM runner. Local tooling saves signed bytes in an ignored owner only journal before broadcast. A resumed deployment reconciles that identity or rebroadcasts only the identical bytes.

Total value governed is tranche capital plus pending pool credits. Premiums are already inside tranche values. Coverage reserves are commitments within that capital, so they are not added a second time. Appeal and filing bonds sit separately in the court.

## Run locally

Use Node 22 or newer and Python 3.12 or newer. Copy `.env.example` to `.env.local` and supply your own credentials. Generate a 32 byte custody master key and keep a secure backup. Existing signing keys cannot be recovered without it.

```sh
npm ci
python3 -m pip install -r requirements.txt
npm run db:migrate
npm run dev
```

The frontend uses Next.js, Figtree, IBM Plex Mono and Lucide icons. Fonts are served locally. A custom hull mark appears in navigation and the tab icon. Light and dark themes persist in your browser. The coverage waterline is drawn in SVG. The application has no seeded agents, claims, policy records or fabricated market data.

Privy must permit email authentication and the deployment’s domain. Only its public app ID reaches the browser. Its secret, the database connection and the custody master key belong in server environment variables. The deployer key is used only by local deployment tooling and is not needed by the hosted app.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run lint:contracts
npm run test:contracts
npm run build
```

Direct contract tests cover permissions, validation, reserve accounting, rejected claims, partial payouts, expiry, evidence failures, strict model output types and appeals. They also invoke captured validator callbacks with independent answers to verify both agreement and disagreement. Network tests use actual Studio transactions and public web requests against a separate deployment. The maintainer lifecycle command is `npm run test:integration`. It uses a protected signed transaction journal, separate test actors and an intentionally insecure test vault. It publishes actual signed history and incident snapshots to a dedicated evidence branch, then requests real validator decisions. It never replaces a declined quote or rejected claim with an approved fixture. The earlier unsupported cover smoke exercise remains available as `npm run test:integration:smoke`. Test fixtures remain in the test environment and never populate the application pool.

The [review exercise](docs/review-integration-result.json) completed a real claim for 0.2 Studio GEN, including a scoped appeal, settlement and claimant receipt of native funds. [Regression coverage](docs/reviewer-remediation.md) maps the review findings to the changes and evidence.

For a fresh Studio deployment, start with an empty address record, provide `GENLAYER_DEPLOYER_KEY` in the local environment and run `npm run deploy:contracts`. The integration deployment can use a separate record through `BALLAST_DEPLOYMENT_FILE`. Local tooling also supports `BALLAST_CURL_RPC=1` when the environment’s Node HTTP transport cannot reach Studio; curl must be installed. See [verification notes](docs/verification.md) for commands, results and the limits of what was exercised.

## Operational notes

The server verifies Privy access tokens and requires a verified email account. Each account has its own AES 256 GCM encrypted signing key, bound to its user ID. Submission records use idempotency keys and a database lock to serialize each signer. Signed transaction bytes are encrypted and persisted with a deterministic hash before broadcast. Unknown broadcasts are reconciled or resent with the identical bytes and nonce. Only confirmed cancellation, finalized execution failure or failure before signing permits a fresh attempt. Attempts are fenced, retain history and use retry backoff. Raw payloads never enter API responses.

The public overview shares a Neon cache of finalized contract reads for two minutes to respect Studio rate limits. Cached data is time stamped; stale data is identified when the network is unavailable. It initially displays the latest 50 entries in each ledger, with earlier pages and direct ID lookup. Account records have dedicated indexes, and recovery follows all unresolved pages. Activity polling shows actual receipt status and validator votes. An accepted or finalized transaction can contain an execution error; the app keeps those outcomes distinct.

The source is tested, but has not had an independent security audit. Hosted credentials supplied through a conversation should be rotated. Back up the custody master key before changing infrastructure. Keep private evidence and personal information out of public submissions.

Architecture and visual decisions are recorded in [architecture](docs/architecture.md) and [design](docs/design.md).
