def hx(value):
    return "0x"+value.hex() if isinstance(value,bytes) else str(value)

import json
from types import SimpleNamespace
from unittest.mock import patch
import pytest

UNIT = 10**18
URLS = ['https://records.example.org/agent', 'https://peer.example.net/report']


@pytest.fixture
def pool(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy('contracts/underwriting.py', hx(direct_bob))
    from genlayer import Address, gl
    operator = str(Address(hx(direct_alice)))
    agent = {'id':'a1','name':'Test agent','operator':operator,'manifest_hash':'abc','scope':'Spend only with approval','history_urls':URLS[:1]}
    policy_claim = {'value':''}
    settlements = {}
    view = SimpleNamespace(get_agent=lambda _:agent, get_loss_record=lambda _:{'claims':0,'paid':'0'}, get_policy_claim=lambda _:policy_claim['value'], get_settlement=lambda key:settlements.get(key, {}))
    with patch.object(gl, 'get_contract_at', return_value=SimpleNamespace(view=lambda:view)):
        yield contract, view, policy_claim


def mock_risk(vm, band='medium', reason='The source shows a bounded spend permission and limited operating history.'):
    vm.clear_mocks()
    vm.mock_web('https://.*', {'status':200, 'body':'Public execution history corroborates the registered agent scope.'})
    vm.mock_llm('Assess Ballast', json.dumps({'band':band,'reason':reason}))


def quote(pool, vm, limit=10*UNIT):
    mock_risk(vm)
    return pool[0].quote_policy('a1',limit,URLS[1:])


def bind(pool, vm, court):
    contract = pool[0]
    contract.wire_court(hx(court))
    vm.value = 20*UNIT; contract.stake('junior')
    qid = quote(pool, vm)
    vm.value = int(contract.get_quote(qid)['premium'])
    contract.bind_policy(qid)
    vm.value = 0
    return qid


def test_stake_share_price_and_redeem(pool,direct_vm,direct_alice):
    c = pool[0]
    from genlayer import Address
    account = str(Address(hx(direct_alice)))
    direct_vm.value = 20*UNIT; c.stake('junior')
    assert c.get_dashboard()['tvg'] == str(20*UNIT)
    assert c.get_account(account)['junior_value'] == str(20*UNIT)
    c.redeem('junior', 5*UNIT)
    assert c.get_account(account)['credit'] == str(5*UNIT)
    assert c.get_dashboard()['junior'] == str(15*UNIT)
    assert c.get_dashboard()['tvg'] == str(20*UNIT)
    with direct_vm.expect_revert('Invalid share'):
        c.redeem('junior',30*UNIT)


@pytest.mark.parametrize('tranche,value',[('wrong',UNIT),('junior',0),('senior',1)])
def test_invalid_stake(pool,direct_vm,tranche,value):
    direct_vm.value = value
    with direct_vm.expect_revert(): pool[0].stake(tranche)


def test_quote_independent_validator_and_schema(pool,direct_vm):
    c = pool[0]; qid = quote(pool,direct_vm)
    q = c.get_quote(qid)
    assert q['band'] == 'medium' and q['premium'] == str(UNIT//2)
    assert direct_vm.run_validator()
    mock_risk(direct_vm,'high')
    assert not direct_vm.run_validator()
    assert not direct_vm.run_validator(leader_error=ValueError('failure'))
    assert c.list_quotes(0,50) == [q]


@pytest.mark.parametrize('band',['low','high','declined'])
def test_risk_rates(pool,direct_vm,band):
    mock_risk(direct_vm,band)
    qid=pool[0].quote_policy('a1',10*UNIT,URLS[1:])
    assert pool[0].get_quote(qid)['band'] == band


def test_quote_access_limits_and_sources(pool,direct_vm,direct_bob):
    c=pool[0]
    for amount in [0,100*UNIT+1]:
        with direct_vm.expect_revert('Cover must'): c.quote_policy('a1',amount,URLS[1:])
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('registered operator'): c.quote_policy('a1',UNIT,URLS[1:])
    for urls in [[],['http://bad'],URLS*2]:
        with direct_vm.expect_revert(): c.quote_policy('a1',UNIT,urls)


@pytest.mark.parametrize('result',[{'band':'unknown','reason':'A long enough reason'}, {'band':'high','reason':''}, {'band':True,'reason':'A long enough reason'}])
def test_invalid_llm_result(pool,direct_vm,result):
    direct_vm.mock_web('https://.*',{'status':200,'body':'a'*40})
    direct_vm.mock_llm('Assess Ballast',json.dumps(result))
    with direct_vm.expect_revert('LLM_ERROR'): pool[0].quote_policy('a1',UNIT,URLS[1:])


def test_external_failure_does_not_price_quote(pool,direct_vm):
    direct_vm.mock_web('https://.*', {'status':503,'body':'unavailable'})
    with direct_vm.expect_revert('EXTERNAL'): pool[0].quote_policy('a1',UNIT,URLS[1:])
    assert pool[0].list_quotes(0,10)==[]


def test_binding_reserves_full_limit_and_rejects_reuse(pool,direct_vm,direct_bob):
    c=pool[0]; qid=bind(pool,direct_vm,direct_bob)
    d=c.get_dashboard()
    assert d['reserved']==str(10*UNIT)
    assert d['premiums']==str(UNIT//2)
    assert d['available']==str(10*UNIT+UNIT//2)
    assert c.list_policies(0,10)[0]['manifest_hash']=='abc'
    with direct_vm.expect_revert('not available'): c.bind_policy(qid)
    with direct_vm.expect_revert('reserved'): c.redeem('junior',20*UNIT)


def test_bind_requires_exact_premium_and_capital(pool,direct_vm,direct_bob):
    c=pool[0];c.wire_court(hx(direct_bob));qid=quote(pool,direct_vm)
    direct_vm.value=1
    with direct_vm.expect_revert('exact quoted'):c.bind_policy(qid)
    direct_vm.value=UNIT//2
    with direct_vm.expect_revert('unreserved'):c.bind_policy(qid)


def test_settlement_partial_and_denied_preserve_cover(pool,direct_vm,direct_bob,direct_charlie):
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    from genlayer import Address
    claimant=str(Address(hx(direct_charlie)))
    claim={'id':'claim1','status':'final','policy_id':qid,'operator':c.get_policy(qid)['operator'],'agent_id':'a1','payout':str(4*UNIT),'claimant':claimant}
    view.get_claim=lambda _:claim
    c.settle_claim('claim1')
    assert c.get_policy(qid)['remaining']==str(6*UNIT)
    assert c.get_policy(qid)['status']=='active'
    assert c.get_dashboard()['reserved']==str(6*UNIT)
    assert c.get_account(claimant)['credit']==str(4*UNIT)
    assert c.get_dashboard()['junior']==str(16*UNIT+UNIT//2)
    assert c.get_settlement('claim1')['paid']==str(4*UNIT)
    with direct_vm.expect_revert('already settled'): c.settle_claim('claim1')
    claim['payout']='0'
    c.settle_claim('claim2')
    assert c.get_policy(qid)['remaining']==str(6*UNIT)


def test_unfinalized_and_oversize_settlement(pool,direct_vm,direct_bob):
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    claim={'status':'challenge','policy_id':qid,'operator':c.get_policy(qid)['operator'],'agent_id':'a1','payout':str(11*UNIT),'claimant':hx(direct_bob)}
    view.get_claim=lambda _:claim
    with direct_vm.expect_revert('not final'): c.settle_claim('c1')
    claim['status']='final'
    with direct_vm.expect_revert('exceeds cover'):c.settle_claim('c1')


def test_expiry_cannot_release_open_claim(pool,direct_vm,direct_bob):
    c,_,prior=pool; qid=bind(pool,direct_vm,direct_bob)
    with direct_vm.expect_revert('cannot expire'):c.expire_policy(qid)
    direct_vm.warp('2035-01-01T00:00:00Z')
    prior['value']='open-claim'
    with direct_vm.expect_revert('existing claim'):c.expire_policy(qid)
    prior['value']=''
    c.expire_policy(qid)
    assert c.get_dashboard()['reserved']=='0'
    assert c.get_policy(qid)['status']=='expired'


def test_quote_expiry_and_wire_lock(pool,direct_vm,direct_bob):
    c=pool[0];qid=quote(pool,direct_vm);c.wire_court(hx(direct_bob))
    with direct_vm.expect_revert('locked'):c.wire_court(hx(direct_bob))
    direct_vm.warp('2035-01-01T00:00:00Z')
    with direct_vm.expect_revert('not available'):c.bind_policy(qid)


def test_pagination_and_missing_items(pool,direct_vm):
    c=pool[0]
    for fn in [c.list_quotes,c.list_policies]:
        with direct_vm.expect_revert('Invalid page'):fn(-1,10)
        assert fn(0,10)==[]
    for fn in [c.get_quote,c.get_policy]:
        with direct_vm.expect_revert('not found'):fn('missing')
    with direct_vm.expect_revert('No funds'):c.withdraw()
