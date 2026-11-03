import json
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import pytest
from test_claims_court import court as v1court, file, mock_finding
from test_underwriting import pool as v1pool, mock_risk, claim_record

UNIT = 10**18
URLS = ['https://records.example.org/history', 'https://peer.example.net/controls']


def hx(value):
    return '0x' + value.hex() if isinstance(value, bytes) else str(value)


@pytest.fixture
def assurance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    direct_vm.warp('2030-01-01T00:00:00Z')
    a = direct_deploy('contracts/v2/assurance.py', hx(direct_bob), hx(direct_charlie), hx(direct_bob))
    from genlayer import Address, gl
    agent = {'id':'a1', 'operator':str(Address(hx(direct_alice))), 'executor_address':str(Address(hx(direct_alice))), 'manifest_hash':'abc', 'scope':'Only approved transfers up to one GEN', 'history_urls':URLS}
    view = SimpleNamespace(get_agent=lambda _:agent, get_final_agent=lambda _:agent, get_final_agent_revision=lambda *_:agent)
    with patch.object(gl, 'get_contract_at', return_value=SimpleNamespace(view=lambda **_:view, emit=MagicMock(return_value=MagicMock()))):
        yield a, agent


def finding(vm, field, value='supported'):
    vm.clear_mocks()
    vm.mock_web('https://.*', {'status':200, 'body':'Attributable public operating evidence of implemented spending controls.'})
    vm.mock_llm('Ballast assurance finding: ' + field, json.dumps({'value':value, 'reason':'The cited public operating records corroborate this independently assessed finding.'}))


def complete(a, vm, value='supported'):
    aid = a.request_assessment('a1', URLS)
    for field in ['scope_clarity', 'spending_controls', 'behavior']:
        finding(vm, field, value)
        a.resolve_assessment_finding(aid, field)
    return aid


def test_independent_assurance_comparison_and_insufficient_history(assurance, direct_vm):
    a, _ = assurance
    aid = complete(a, direct_vm, 'insufficient')
    assert a.get_assessment(aid)['findings']['behavior'] == 'insufficient'
    assert direct_vm.run_validator()
    finding(direct_vm, 'behavior', 'supported')
    assert not direct_vm.run_validator()
    assert not a.get_passport('a1')['ready']


def test_assessment_requires_operator_or_opted_in_sponsor(assurance, direct_vm, direct_charlie, direct_bob):
    a, _ = assurance
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert('opted-in'):
            a.request_assessment('a1', URLS)
    a.set_monitoring('a1', True)
    with direct_vm.prank(direct_charlie):
        a.request_assessment('a1', URLS)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('Only the operator'):
            a.set_monitoring('a1', False)


def test_finality_is_authenticated_immutable_and_fresh(assurance, direct_vm):
    from genlayer import gl
    a, agent = assurance
    aid = complete(a, direct_vm)
    with direct_vm.expect_revert('challenge window'):
        a.finalize_assessment(aid)
    direct_vm.warp('2030-01-02T01:00:00Z')
    a.finalize_assessment(aid)
    payload = json.dumps(a.get_assessment(aid), sort_keys=True)
    with direct_vm.expect_revert('finalized assurance'):
        a.confirm_assessment(payload)
    with direct_vm.prank(gl.message.contract_address):
        a.confirm_assessment(payload)
    assert a.get_passport('a1')['ready']
    agent['manifest_hash'] = 'new'
    assert not a.get_passport('a1')['ready']
    agent['manifest_hash'] = 'abc'
    direct_vm.warp('2030-01-09T00:00:00Z')
    assert not a.get_passport('a1')['ready']


def test_bond_record_survives_transient_review_and_refunds_at_fixed_deadline(assurance, direct_vm, direct_bob):
    from genlayer import Address
    a, _ = assurance
    aid = complete(a, direct_vm)
    deadline = a.get_assessment(aid)['review_deadline']
    with direct_vm.prank(direct_bob):
        direct_vm.value = UNIT//100
        a.challenge_finding(aid, 'behavior', 'The public signed execution evidence contradicts the registered spending authority.', URLS)
    direct_vm.value = 0
    direct_vm.clear_mocks()
    direct_vm.mock_web('https://.*', {'status':503, 'body':'unavailable'})
    with direct_vm.expect_revert('TRANSIENT'):
        a.resolve_challenge(aid, 0)
    assert a.get_assessment(aid)['challenges'][0]['status'] == 'pending'
    assert a.get_assessment(aid)['review_deadline'] == deadline
    direct_vm.warp('2030-01-09T00:00:00Z')
    a.close_assessment(aid)
    assert a.get_assessment(aid)['status'] == 'disputed'
    assert a.get_bond_credit(str(Address(hx(direct_bob)))) == str(UNIT//100)
    with direct_vm.expect_revert('overdue'):
        a.close_assessment(aid)


def test_public_and_operator_challenges_are_independent_and_bounded(assurance, direct_vm, direct_bob):
    a, agent = assurance
    aid = complete(a, direct_vm)
    window = a.get_assessment(aid)['challenge_until']
    reason = 'The public evidence establishes a different interpretation of this particular finding.'
    with direct_vm.prank(direct_bob):
        direct_vm.value = UNIT//100
        a.challenge_finding(aid, 'behavior', reason, URLS)
    direct_vm.value = 0
    finding(direct_vm, 'behavior', 'contradicted')
    a.resolve_challenge(aid, 0)
    direct_vm.value = UNIT//100
    a.challenge_finding(aid, 'behavior', reason, URLS)
    direct_vm.value = 0
    finding(direct_vm, 'behavior', 'contradicted')
    a.resolve_challenge(aid, 1)
    assert a.get_assessment(aid)['challenge_until'] == window
    assert not a.get_passport('a1')['ready']
    direct_vm.value = UNIT//100
    with direct_vm.expect_revert('slot is already used'):
        a.challenge_finding(aid, 'behavior', reason, URLS)
    assert a.get_bond_credit(agent['operator']) == '0'


@pytest.fixture
def court(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    def deploy(path, *args):
        return direct_deploy(path.replace('contracts/', 'contracts/v2/'), *args)
    yield from v1court.__wrapped__(direct_vm, deploy, direct_alice, direct_bob, direct_charlie)


@pytest.mark.parametrize('facts,loss,expected', [((True, True, False), UNIT, UNIT), ((True, True, False), UNIT//2, UNIT//2), ((True, True, True), UNIT, 0), ((False, True, False), UNIT, 0)])
def test_v2_award_is_calculated_without_payout_model(court, direct_vm, facts, loss, expected):
    a = court[0]
    cid = file(court, direct_vm)
    for field, value in zip(['harm','causation','scope'], facts):
        mock_finding(direct_vm, field, value)
        a.resolve_finding(cid, field)
    if facts[0]:
        c = a.get_claim(cid)
        c['verified_loss'] = str(loss)
        a.claims[cid] = json.dumps(c, sort_keys=True)
    assert a.get_claim(cid)['status'] == 'challenge'
    with direct_vm.expect_revert('not available'):
        a.resolve_finding(cid, 'payout')
    direct_vm.warp('2035-01-01T00:00:00Z')
    a.finalize_claim(cid)
    assert a.get_claim(cid)['payout'] == str(expected)
    assert set(a.get_claim(cid)['findings']) == {'harm','causation','scope'}


@pytest.fixture
def pool(direct_vm, direct_deploy, direct_alice, direct_bob):
    def deploy(path, *args):
        return direct_deploy(path.replace('contracts/', 'contracts/v2/'), *args, hx(direct_bob), [])
    for c, view, cases in v1pool.__wrapped__(direct_vm, deploy, direct_alice, direct_bob):
        passport = {'id':'assessment1', 'revision':1}
        view.get_passport = lambda _: {'ready':True, 'final_assessment':passport}
        yield c, view, cases, passport


def test_quote_binds_exact_passport_and_rejects_revision_change(pool, direct_vm, direct_charlie):
    c, view, _, passport = pool
    c.wire_court(hx(direct_charlie))
    direct_vm.value = 20*UNIT
    c.stake('junior')
    mock_risk(direct_vm)
    qid = c.quote_policy('a1', UNIT, URLS)
    assert c.get_quote(qid)['assessment_id'] == 'assessment1'
    passport['revision'] = 2
    direct_vm.value = int(c.get_quote(qid)['premium'])
    with direct_vm.expect_revert('Assessment changed'):
        c.bind_policy(qid)
    view.get_passport = lambda _: {'ready':False}
    with direct_vm.expect_revert('fresh finalized'):
        c.quote_policy('a1', UNIT, URLS)


def test_legacy_compensation_and_history_are_not_reset(pool, direct_vm, direct_bob):
    c, view, _, _ = pool
    c.legacy_pools.append(hx(direct_bob))
    view.get_operator_record = lambda _: {'claims':2, 'settled_claims':3, 'paid':str(UNIT)}
    view.get_final_operator_record = view.get_operator_record
    view.get_event_record = lambda _: {'paid':str(UNIT), 'loss':str(UNIT)}
    view.get_final_event_record = view.get_event_record
    assert c.get_risk_record(hx(direct_bob))['claims'] == 2
    assert c.get_final_event_record('event')['paid'] == str(UNIT)
    view.get_agent_policy = lambda _: {'status':'active'}
    view.get_final_agent_policy = view.get_agent_policy
    with direct_vm.expect_revert('legacy active'):
        c._legacy_cover('a1')
