# Registered account checks

The live account journey planned 78 scenarios, three per area. 73 passed; 5 were not run because the owner asked to close testing. The [result ledger](account-test-result.json) retains each outcome and available transaction references.

The closing public chain reads started at 2026-10-17T12:46:57.677Z. The account used real email authentication and the normal Ballast relay. Controlled counterparties supplied their own Studio test funds and actual transaction evidence.

| Area | Passed | Other results |
| :--- | ---: | :--- |
| email sign in | 3/3 | None |
| account and funds | 3/3 | None |
| executor authorization | 3/3 | None |
| agent registration | 3/3 | None |
| manifest revisions | 3/3 | None |
| risk quotes | 3/3 | None |
| coverage binding | 3/3 | None |
| capital contributions | 3/3 | None |
| capital redemption | 3/3 | None |
| pool withdrawals | 3/3 | None |
| claim filing | 3/3 | None |
| additional evidence | 3/3 | None |
| four findings | 3/3 | None |
| scoped appeals | 3/3 | None |
| decision and settlement | 3/3 | None |
| bond withdrawal | 3/3 | None |
| loss history | 0/3 | 3 not run |
| claim recovery | 3/3 | None |
| policy expiry | 1/3 | 2 not run |
| records and filtering | 3/3 | None |
| activity and retries | 3/3 | None |
| navigation and accessibility | 3/3 | None |
| themes and account UI | 3/3 | None |
| dialog accessibility | 3/3 | None |
| earlier pool redemption | 3/3 | None |
| earlier pool withdrawal | 3/3 | None |

The original claim `ab49942be3d9a29c2253d38a` is `challenge`. Its actual findings are `{"causation": true, "harm": true, "payout": 100, "scope": false}`. Its first controlled claimant key was lost during the runner cleanup, so that case retains its normal contract deadlines. Nobody supplied consent on its behalf.

The additional case `4c4a3238148445a1ca9e696c` is `settled` and its recorded paid amount is 0.1 GEN. Its earlier withdrawn case settled for zero before the uncompensated event was filed again. The report links actual receipts for the independent appeals, settlement and compensation replay refusal.

The controlled claimant withdrew 0.1 GEN of payout and 0.04 GEN of bonds. Their native balance increased by exactly that sum. A subsequent replay against a different active policy, using a capitalized transaction hash, was refused because the loss was already compensated. That direct refusal retained another 0.01 GEN of the controlled claimant's test funds on Studio. It did not debit the registered account.

Its initial payout finding was 0 percent. The reason treated spending outside the agent mandate as outside policy cover, despite the other three findings establishing the covered peril. The ledger preserves that initial reason and the actual outcomes of any payout appeals, including the accepted evidence URLs.

Quotes, findings and appeals use the equivalence principle through custom validator comparison. Each validator fetches the sources and assesses independently. Quotes compare the risk band; claims compare one finding at a time, with exact loss and event time for positive harm. Explanations may differ. Deterministic capital and payment operations do not invoke model comparison.

The account holds 44.109 native GEN. Its earlier senior position remains 5 GEN. Current reserved cover is 0.1 GEN; allocated backing and premiums remain locked under the contract rules.

Two initial payable refusal tests left 0.012 GEN in the Studio contracts. The new server preflight rejects known invalid premium and bond submissions before signing. Live checks verified unchanged account balances for stale quotes, repeated binding and operator self claims.

40 earlier observed passes were reconstructed after the runner removed the original private journals. Those rows are labelled individually. Two successful earlier pool actions were performed by the account owner and explicitly confirmed during testing. The remaining checks record their own live observations.

Verification also passed 112 unit tests, 140 direct contract tests, lint, type checking, the production build and nine hosted browser checks. Direct tests use controlled SDK stand ins. Four browser regressions supply controlled public records, while the other five read the live deployment. Live account scenarios use actual application responses and Studio outcomes. The live cursor tests cover the current small dataset; the separate direct tests cover records beyond 50.

Private sessions, signing keys and request credentials are excluded from this report. The recovery checklist remains local and Git ignored.
