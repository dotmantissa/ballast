# Ballast

A little weight. A steadier course.

Ballast is capital set aside for the moment an autonomous agent spends beyond its authority and someone else bears the cost. An operator declares the agent’s scope before buying cover. Capital providers back that promise. GenLayer validators decide claims from public evidence, and either side can challenge a specific finding.

The first version covers one narrow peril: unauthorized agent spend. Limits stop at 100 Studio GEN. Policies last 30 days, with another 7 days to file a claim about an incident during that term. This is an experimental discretionary cover pool. Studio funds have no monetary value. Ballast is not a regulated insurance product.

## Use it

The app is live at [ballast cover](https://ballast-cover.vercel.app).

Sign in with an email code. Open your account menu to add 25 test GEN from the Studio faucet. No browser wallet is needed. Ballast creates a custodial account, encrypts its signing key and submits the actions you request. Do not send real assets to it.

Operators register a JSON manifest with a name, detailed scope, executor address and whole number `spend_limit_gen`. Public execution history accompanies the manifest. The original text and its SHA 256 hash stay together in the registry. To request a quote, add relevant public peer evidence and choose a limit. Validators assess a risk band and explain why. A quote lasts one hour. An agent can hold one active Ballast policy at a time. Binding pays the premium and reserves the full coverage limit.

Claimants select a policy, identify the incident, explain the loss and supply public evidence from at least two hosts. The workspace submits the four reviews in sequence while it is open and resumes them when the claimant returns. Each finding has a stable request key, so refreshing does not submit it twice. A filing bond is 1% of the requested amount, with a minimum of 0.01 GEN. Successful claims return that bond. Otherwise it goes to the operator.

Capital providers choose junior or senior exposure. Junior capital absorbs losses first. When both tranches hold capital, junior receives 80% of premiums and senior receives 20%. A sole funded tranche receives the whole premium. Shares track the value of each tranche. Redemptions cannot consume reserved capital. Redemptions and claim payouts become credits that recipients withdraw.

## Why four findings matter

“Should we pay?” is too broad a question for useful validator comparison. Ballast asks four smaller questions.

1. Did a realized, measurable harm occur to the claimant during the policy period?
2. Did the registered agent cause that exact harm?
3. Was the action permitted by its original declared scope?
4. What fraction of the claimed loss does the evidence support?

Each finding has its own transaction and independent validator assessment. The first three answers are strict booleans. The payout answer is one of 0, 25, 50, 75 or 100 percent. Validators fetch the sources themselves, rerun the assessment and compare that finding alone. Wording may differ; the decision must match exactly. A valid JSON shape is never treated as evidence that a leader is right.

V1 pays only when harm and causation are true and scope is false. The payout is bounded by the requested loss and remaining cover. Unavailable evidence causes the assessment to fail, rather than silently rejecting the claimant.

## Appeals and settlement

The claimant or operator can bond an appeal for one finding during a 24 hour challenge period. The appeal bond is 1% of the claim, with a minimum of 0.01 GEN. A changed finding returns it; an unchanged finding awards it to the other party. Each finding may be appealed once. A changed boolean invalidates the dependent payout finding, which must be resolved again. Completed revised findings start a fresh challenge period.

After the window closes, anyone can finalize the claim and settle it with the pool. A rejected claim leaves the policy intact. Incident references are scoped to the agent and claimant, so another party cannot consume your reference and the same claimant cannot reuse it under a later policy. A payment reduces remaining cover. Settlements update the pool’s authoritative operator loss record immediately, so a missed registry synchronization cannot hide a loss from the next quote.

Accounting uses synchronous reads of final decisions. It does not assume that a queued write to another contract succeeded. Native withdrawals are emitted on finalization; their receipts remain inspectable.

## Contracts

`contracts/agent_registry.py` stores immutable manifests, executor identity, operator identity and access to the authoritative loss record.

`contracts/underwriting.py` prices quotes, binds policies, accepts capital, reserves limits, allocates losses and credits recipients. Base premium rates are 2%, 5% and 10% for low, medium and high risk. Each paid claim adds one percentage point, up to ten additional points. Total rates cannot exceed 20%.

`contracts/claims_court.py` stores incidents, retrieves public evidence, resolves findings independently, handles scoped appeals and finalizes decisions.

Live addresses, source hashes, deployment transactions and wiring transactions are recorded in [the Studio deployment record](deployments/studio.json). All three use a concrete pinned GenVM runner. The deploy script saves each transaction hash before waiting and can resume without sending a duplicate deployment.

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

Direct contract tests cover permissions, validation, reserve accounting, rejected claims, partial payouts, expiry, evidence failures, strict model output types and appeals. They also invoke captured validator callbacks with independent answers to verify both agreement and disagreement. Network tests use actual Studio transactions and public web requests against a separate deployment. Test fixtures remain in the test environment and never populate the application pool.

For a fresh Studio deployment, start with an empty address record, provide `GENLAYER_DEPLOYER_KEY` in the local environment and run `npm run deploy:contracts`. The integration deployment can use a separate record through `BALLAST_DEPLOYMENT_FILE`. Local tooling also supports `BALLAST_CURL_RPC=1` when the environment’s Node HTTP transport cannot reach Studio; curl must be installed. See [verification notes](docs/verification.md) for commands, results and the limits of what was exercised.

## Operational notes

The server verifies Privy access tokens and requires a verified email account. Each account has its own AES 256 GCM encrypted signing key, bound to its user ID. Submission records use idempotency keys and a database lock to serialize each signer. If a broadcast cannot be confirmed, the operation is marked uncertain and is not automatically resubmitted. Reconcile the recorded sender nonce with Studio before repeating it.

The public overview shares a Neon cache of finalized contract reads for two minutes to respect Studio rate limits. Cached data is time stamped; stale data is identified when the network is unavailable. It displays the latest 50 entries in each ledger. Activity polling shows actual receipt status and validator votes. An accepted or finalized transaction can contain an execution error; the app keeps those outcomes distinct.

The source is tested, but has not had an independent security audit. Hosted credentials supplied through a conversation should be rotated. Back up the custody master key before changing infrastructure. Keep private evidence and personal information out of public submissions.

Architecture and visual decisions are recorded in [architecture](docs/architecture.md) and [design](docs/design.md).
