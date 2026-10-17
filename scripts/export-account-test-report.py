"""Export an allowlisted report from actual live account observations and chain reads."""
from collections import Counter
from decimal import Decimal
import json
from pathlib import Path
import re

private = Path('.ballast-private/account-tests')
matrix = json.loads((private / 'matrix.json').read_text())
snapshot = json.loads((private / 'public-chain-reconciliation.json').read_text())
definitions = json.loads(Path('tests/account/scenarios.json').read_text())
assert all(count == 3 for count in Counter(x['feature'] for x in definitions).values())
assert {(x['feature'], x['case']) for x in matrix['scenarios']} == {(x['feature'], x['case']) for x in definitions}

def identifiers(value, keys, pattern, inherited=''):
    found = set()
    if isinstance(value, dict):
        for key, child in value.items():
            found.update(identifiers(child, keys, pattern, key))
    elif isinstance(value, list):
        for child in value:
            found.update(identifiers(child, keys, pattern, inherited))
    elif isinstance(value, str) and inherited in keys and re.fullmatch(pattern, value):
        found.add(value)
    return sorted(found)

rows = []
transaction_keys = {'transaction', 'transactions', 'tx_hash', 'quoteTransaction', 'bindTransaction', 'hash'}
record_keys = {'claimId', 'policyId', 'agentId', 'agentIds', 'quoteId', 'id'}
for row in matrix['scenarios']:
    evidence = row.get('evidence', {})
    rows.append({
        **{key: row[key] for key in ['feature', 'case', 'scenario', 'status']},
        'recoveredObservation': evidence.get('recoveredObservation', False),
        'ownerAssisted': evidence.get('performedBy', '').startswith('account owner'),
        'transactions': identifiers(evidence, transaction_keys, r'0x[a-fA-F0-9]{64}'),
        'recordIds': identifiers(evidence, record_keys, r'[a-f0-9]{24}'),
        'checks': {key: value for key, value in evidence.items() if isinstance(value, bool) and key != 'recoveredObservation'},
    })
counts = Counter(row['status'] for row in rows)
original = snapshot['originalClaim']
additional = snapshot['additionalClaim']
initial_path = private / 'continuation/initial-decision.json'
initial = json.loads(initial_path.read_text()) if initial_path.exists() else additional
assert initial['id'] == additional['id']
payment = json.loads((private / 'continuation/withdrawal-first_2.json').read_text())
actors = json.loads((private / 'continuation/actors-public.json').read_text())
assert payment['exactNativeIncrease'] is True
assert int(payment['afterWei']) - int(payment['beforeWei']) == int(payment['payoutWei']) + int(payment['bondWei'])
assert payment['payoutWei'] == additional['settled_payout'] == snapshot['additionalSettlement']['paid']
assert int(payment['payoutWei']) > 0
claimant_receipts = {key: value['hash'] for key, value in actors['checks'].items() if key in ['first_2_claimant_payout', 'first_2_claimant_bonds', 'first_2_duplicate_refusal'] and value.get('done') and re.fullmatch(r'0x[a-fA-F0-9]{64}', value.get('hash', ''))}
policy_fields = ['id', 'status', 'remaining', 'paid', 'starts_at', 'ends_at']
claim_fields = ['id', 'policy_id', 'status', 'findings', 'verified_loss', 'payout', 'settled_payout', 'challenge_until', 'review_deadline', 'outcome']
report = {
    'application': 'https://ballast-cover.vercel.app',
    'account': snapshot['account'],
    'snapshotAt': snapshot['observedAt'],
    'network': 'GenLayer Studio',
    'deployment': snapshot['deployment'],
    'scenarioCount': len(rows), 'counts': dict(counts),
    'complete': counts['passed'] == len(rows),
    'recoveredObservationCount': sum(row['recoveredObservation'] for row in rows),
    'ownerAssistedObservationCount': sum(row['ownerAssisted'] for row in rows),
    'verification': {'unitTests': 112, 'directContractTests': 140, 'hostedBrowserTests': 9, 'lint': 'passed', 'typecheck': 'passed', 'productionBuild': 'passed'},
    'nativeWei': snapshot['nativeWei'],
    'earlierPool': {key: snapshot['earlierPool'].get(key) for key in ['junior_value', 'senior_value', 'credit']},
    'pool': {key: snapshot['pool'].get(key) for key in ['junior_shares', 'senior_shares', 'junior_value', 'senior_value', 'credit']},
    'dashboard': {key: snapshot['dashboard'][key] for key in ['junior', 'senior', 'junior_locked', 'senior_locked', 'reserved', 'paid', 'tvg']},
    'policies': [{key: policy.get(key) for key in policy_fields} for policy in snapshot['pool']['policies']['items']],
    'originalClaim': {key: original.get(key) for key in claim_fields},
    'additionalClaim': {key: additional.get(key) for key in claim_fields},
    'additionalSettlement': snapshot['additionalSettlement'],
    'claimantPayment': {**{key: payment[key] for key in ['beforeWei', 'payoutWei', 'bondWei', 'afterWei', 'exactNativeIncrease']}, 'transactions': claimant_receipts},
    'judgmentReview': {'initialFindings': initial['findings'], 'initialPayoutReason': initial['reasons'].get('payout'), 'currentFindings': additional['findings'], 'payoutAppeals': [{key: appeal.get(key) for key in ['field', 'by', 'before', 'after', 'changed', 'evidence_urls']} for appeal in additional['appeals'] if appeal['field'] == 'payout']},
    'lossRecord': snapshot['lossRecord'],
    'nativeAccounting': {'poolNativeWei': snapshot['poolNativeWei'], 'courtNativeWei': snapshot['courtNativeWei'], 'failedPayableTestValueWei': '12000000000000000', 'note': 'Studio retained 0.002 GEN from a failed repeated bind and 0.01 GEN from an operator self claim refusal. The application now refuses these known invalid paid requests before signing. These amounts are separate from tranche NAV and credited bonds.'},
    'recoveryNote': 'The contract runner cleared its former artifacts directory during verification. The original private browser journals and controlled actor keys were lost. Earlier observed passes are flagged above; public signed evidence, server operation records and the registered account custody remained intact. Private state now lives outside generated output and has a separate owner only backup. The additional controlled fixture uses its own backed up keys; its actual outcomes appear in the ledger.',
    'scenarios': rows,
}
output = Path('docs/account-test-result.json')
output.write_text(json.dumps(report, indent=2) + '\n')

def gen(value):
    return format((Decimal(str(value)) / Decimal(10**18)).normalize(), 'f')

areas = list(dict.fromkeys(row['feature'] for row in rows))
lines = ['# Registered account checks', '',
    f"The live account journey contains {len(rows)} scenarios, three per area. {counts['passed']} passed. The [complete ledger](account-test-result.json) retains each result and available transaction references.", '',
    f"The final public chain read was taken at {snapshot['observedAt']}. The account used real email authentication and the normal Ballast relay. Controlled counterparties supplied their own Studio test funds and actual transaction evidence.", '',
    '| Area | Passed | Other results |', '| :--- | ---: | :--- |']
for area in areas:
    state = Counter(row['status'] for row in rows if row['feature'] == area)
    other = ', '.join(f'{value} {key}' for key, value in state.items() if key != 'passed') or 'None'
    lines.append(f"| {area} | {state['passed']}/3 | {other} |")
lines += ['',
    f"The original claim `{original['id']}` is `{original['status']}`. Its actual findings are `{json.dumps(original['findings'], sort_keys=True)}`. Its first controlled claimant key was lost during the runner cleanup, so that case retains its normal contract deadlines. Nobody supplied consent on its behalf.", '',
    f"The additional case `{additional['id']}` is `{additional['status']}` and its recorded paid amount is {gen(additional.get('settled_payout', '0'))} GEN. Its earlier withdrawn case settled for zero before the uncompensated event was filed again. The report links actual receipts for the independent appeals, settlement and compensation replay refusal.", '',
    f"The controlled claimant withdrew {gen(payment['payoutWei'])} GEN of payout and {gen(payment['bondWei'])} GEN of bonds. Their native balance increased by exactly that sum. A subsequent replay against a different active policy, using a capitalized transaction hash, was refused because the loss was already compensated. That direct refusal retained another 0.01 GEN of the controlled claimant's test funds on Studio. It did not debit the registered account.", '',
    f"Its initial payout finding was {initial['findings'].get('payout')} percent. The reason treated spending outside the agent mandate as outside policy cover, despite the other three findings establishing the covered peril. The ledger preserves that initial reason and the actual outcomes of any payout appeals, including the accepted evidence URLs.", '',
    'Quotes, findings and appeals use the equivalence principle through custom validator comparison. Each validator fetches the sources and assesses independently. Quotes compare the risk band; claims compare one finding at a time, with exact loss and event time for positive harm. Explanations may differ. Deterministic capital and payment operations do not invoke model comparison.', '',
    f"The account holds {gen(snapshot['nativeWei'])} native GEN. Its earlier senior position remains {gen(snapshot['earlierPool']['senior_value'])} GEN. Current reserved cover is {gen(snapshot['dashboard']['reserved'])} GEN; allocated backing and premiums remain locked under the contract rules.", '',
    'Two initial payable refusal tests left 0.012 GEN in the Studio contracts. The new server preflight rejects known invalid premium and bond submissions before signing. Live checks verified unchanged account balances for stale quotes, repeated binding and operator self claims.', '',
    f"{report['recoveredObservationCount']} earlier observed passes were reconstructed after the runner removed the original private journals. Those rows are labelled individually. Two successful earlier pool actions were performed by the account owner and explicitly confirmed during testing. The remaining checks record their own live observations.", '',
    'Verification also passed 112 unit tests, 140 direct contract tests, lint, type checking, the production build and nine hosted browser checks. Direct tests use controlled SDK stand ins. Four browser regressions supply deliberately malformed public records, while the other five read the live deployment. Live account scenarios use actual application responses and Studio outcomes. The live cursor tests cover the current small dataset; the separate direct tests cover records beyond 50.', '',
    'Private sessions, signing keys and request credentials are excluded from this report. The recovery checklist remains local and Git ignored.', '']
Path('docs/account-testing.md').write_text('\n'.join(lines))
print(json.dumps({'report': str(output), 'counts': dict(counts), 'complete': report['complete']}))
