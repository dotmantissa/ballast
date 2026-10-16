def hx(value):
    return "0x"+value.hex() if isinstance(value,bytes) else str(value)

import json
import hashlib
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
    with patch.object(gl, 'get_contract_at', return_value=SimpleNamespace(view=lambda **kwargs:view)):
        yield contract, view, policy_claim


def claim_record(c, policy_id, claim_id, claimant, payout, status='final'):
    policy=c.get_policy(policy_id)
    ref='0x'+'a'*64
    return {'id':claim_id,'status':status,'policy_id':policy_id,'operator':policy['operator'],
            'agent_id':policy['agent_id'],'payout':str(payout),'claimant':claimant,
            'incident_ref':ref,'incident_at':policy['starts_at'],
            'verified_incident_at':policy['starts_at'],'verified_loss':str(10*UNIT),
            'amount':str(10*UNIT),'event_key':hashlib.sha256(('genlayer-studio:'+ref+':'+claimant.lower()).encode()).hexdigest(),
            'findings':{'harm':True,'causation':True,'scope':False,'payout':100}}


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
    assert d['available']==str(10*UNIT)
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
    claim=claim_record(c,qid,'claim1',claimant,4*UNIT)
    view.get_claim=lambda _:claim
    c.settle_claim('claim1')
    assert c.get_policy(qid)['remaining']==str(6*UNIT)
    assert c.get_policy(qid)['status']=='active'
    assert c.get_dashboard()['reserved']==str(6*UNIT)
    assert c.get_account(claimant)['credit']==str(4*UNIT)
    assert c.get_dashboard()['junior']==str(16*UNIT+UNIT//2)
    assert c.get_settlement('claim1')['paid']==str(4*UNIT)
    with direct_vm.expect_revert('already settled'): c.settle_claim('claim1')
    claim['payout']='0';claim['id']='claim2'
    c.settle_claim('claim2')
    assert c.get_policy(qid)['remaining']==str(6*UNIT)


def test_unfinalized_and_oversize_settlement(pool,direct_vm,direct_bob):
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    claim=claim_record(c,qid,'c1',hx(direct_bob),11*UNIT,'challenge')
    view.get_claim=lambda _:claim
    with direct_vm.expect_revert('not final'): c.settle_claim('c1')
    claim['status']='final'
    with direct_vm.expect_revert('exceeds cover'):c.settle_claim('c1')


def test_expiry_cannot_release_open_claim(pool,direct_vm,direct_bob):
    c,view,prior=pool; qid=bind(pool,direct_vm,direct_bob)
    with direct_vm.expect_revert('cannot expire'):c.expire_policy(qid)
    direct_vm.warp('2035-01-01T00:00:00Z')
    prior['value']='open-claim'
    view.get_claim=lambda _: {'amount':str(UNIT)}
    c.expire_policy(qid)
    assert c.get_policy(qid)['status']=='runoff'
    assert c.get_dashboard()['reserved']==str(UNIT)
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


def test_junior_first_loss_senior_protection_and_live_loss_pricing(pool,direct_vm,direct_bob,direct_charlie):
    c,view,_=pool
    c.wire_court(hx(direct_bob))
    direct_vm.value=3*UNIT;c.stake('junior')
    direct_vm.value=10*UNIT;c.stake('senior')
    qid=quote(pool,direct_vm)
    direct_vm.value=UNIT//2;c.bind_policy(qid)
    d=c.get_dashboard()
    assert d['junior']==str(3*UNIT+4*UNIT//10)
    assert d['senior']==str(10*UNIT+UNIT//10)
    claim=claim_record(c,qid,'waterfall',hx(direct_charlie),5*UNIT)
    view.get_claim=lambda _:claim
    c.settle_claim('waterfall')
    d=c.get_dashboard()
    assert d['junior']=='0' and d['senior']==str(85*UNIT//10)
    assert d['reserved']==str(5*UNIT)
    record=c.get_operator_record(c.get_policy(qid)['operator'])
    assert record=={'claims':1,'settled_claims':1,'paid':str(5*UNIT)}
    next_quote=quote(pool,direct_vm)
    assert c.get_quote(next_quote)['rate_bps']==600
    claim['payout']='0';claim['id']='denied';c.settle_claim('denied')
    assert c.get_operator_record(claim['operator'])['claims']==1
    assert c.get_operator_record(claim['operator'])['settled_claims']==2
    direct_vm.value=UNIT
    c.stake('junior')
    assert c.get_dashboard()['junior_generation']==1
    assert c.get_dashboard()['junior']==str(UNIT)


def test_withdraw_emits_native_transfer_and_clears_credit(pool,direct_vm,direct_alice):
    import sys
    from unittest.mock import MagicMock
    c=pool[0]
    direct_vm.value=UNIT;c.stake('senior');c.redeem('senior',UNIT)
    emitter=MagicMock()
    module=sys.modules['_contract_underwriting']
    with patch.object(module,'_Recipient',return_value=emitter):
        c.withdraw()
    assert int(emitter.emit_transfer.call_args.kwargs['value'])==UNIT
    from genlayer import Address
    assert c.get_account(str(Address(hx(direct_alice))))['credit']=='0'
    assert c.get_dashboard()['credits']=='0'
    with direct_vm.expect_revert('No funds'):c.withdraw()


def test_agent_cannot_bind_overlapping_cover(pool,direct_vm,direct_bob):
    c=pool[0];bind(pool,direct_vm,direct_bob)
    qid=quote(pool,direct_vm)
    direct_vm.value=UNIT//2
    with direct_vm.expect_revert('already has active cover'):
        c.bind_policy(qid)


@pytest.mark.parametrize('bad',['https://[invalid','https://example.org:444/x','https://u:p@example.org/x','https://127.0.0.1/x'])
def test_quote_rejects_malformed_public_sources(pool,direct_vm,bad):
    with direct_vm.expect_revert('public HTTPS'):
        pool[0].quote_policy('a1',UNIT,[bad])


def test_canonical_compensation_ledger_blocks_second_award(pool,direct_vm,direct_bob,direct_charlie):
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    claim=claim_record(c,qid,'first',hx(direct_charlie),UNIT)
    view.get_claim=lambda _:claim
    c.settle_claim('first')
    event=c.get_event_record(claim['event_key'])
    assert event['paid']==str(UNIT) and event['loss']==str(10*UNIT)
    claim['id']='replayed'
    with direct_vm.expect_revert('already been compensated'):c.settle_claim('replayed')
    assert c.get_account(hx(direct_charlie))['credit']==str(UNIT)


def test_settlement_enforces_actual_loss_and_actual_event_dates(pool,direct_vm,direct_bob,direct_charlie):
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    claim=claim_record(c,qid,'invalid',hx(direct_charlie),UNIT)
    view.get_claim=lambda _:claim
    claim['verified_loss']=str(UNIT//2)
    with direct_vm.expect_revert('evidenced loss'):c.settle_claim('invalid')
    claim['verified_loss']=str(UNIT);claim['verified_incident_at']=claim['incident_at']-1
    with direct_vm.expect_revert('coverage period'):c.settle_claim('invalid')


def test_runoff_releases_unclaimed_cover_then_zero_settlement_releases_rest(pool,direct_vm,direct_bob,direct_charlie):
    c,view,prior=pool;qid=bind(pool,direct_vm,direct_bob)
    claim=claim_record(c,qid,'unavailable',hx(direct_charlie),0)
    claim['amount']=str(UNIT);view.get_claim=lambda _:claim;prior['value']='unavailable'
    direct_vm.warp('2035-01-01T00:00:00Z');c.expire_policy(qid)
    assert c.get_dashboard()['reserved']==str(UNIT)
    assert c.get_policy(qid)['status']=='runoff'
    c.settle_claim('unavailable')
    assert c.get_dashboard()['reserved']=='0' and c.get_policy(qid)['status']=='expired'


def test_settlement_uses_finalized_court_storage(pool,direct_vm,direct_bob,direct_charlie):
    from genlayer import gl
    from genlayer.py.public_abi import StorageType
    c,view,_=pool;qid=bind(pool,direct_vm,direct_bob)
    view.get_claim=lambda _:claim_record(c,qid,'final-state',hx(direct_charlie),UNIT)
    def select(**kwargs):
        assert kwargs.get('state')==StorageType.LATEST_FINAL
        return view
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=select)):
        c.settle_claim('final-state')


def test_junior_cannot_take_premium_and_leave_senior_with_its_risk(pool,direct_vm,direct_bob,direct_alice):
    c=pool[0];c.wire_court(hx(direct_bob))
    direct_vm.value=100*UNIT;c.stake('senior')
    direct_vm.value=UNIT;c.stake('junior')
    qid=quote(pool,direct_vm);direct_vm.value=UNIT//2;c.bind_policy(qid)
    d=c.get_dashboard()
    assert d['junior']==str(14*UNIT//10) and d['junior_locked']==d['junior']
    assert d['senior_locked']==str(91*UNIT//10)
    with direct_vm.expect_revert('reserved in this tranche'):c.redeem('junior',UNIT)
    assert c.get_dashboard()['junior']==str(14*UNIT//10)
    # Profits unlock only when no policy liability remains.
    direct_vm.warp('2035-01-01T00:00:00Z');c.expire_policy(qid)
    c.redeem('junior',UNIT)
    assert c.get_account(hx(direct_alice))['credit']==str(14*UNIT//10)


def test_new_capital_cannot_inherit_wiped_generation_shares(pool,direct_vm,direct_bob,direct_charlie,direct_alice):
    c,view,_=pool;c.wire_court(hx(direct_bob))
    direct_vm.value=UNIT;c.stake('junior')
    direct_vm.value=20*UNIT;c.stake('senior')
    qid=quote(pool,direct_vm);direct_vm.value=UNIT//2;c.bind_policy(qid)
    claim=claim_record(c,qid,'wipe',hx(direct_charlie),2*UNIT)
    view.get_claim=lambda _:claim;c.settle_claim('wipe')
    assert c.get_dashboard()['junior']=='0'
    with direct_vm.prank(direct_charlie):
        direct_vm.value=UNIT;c.stake('junior')
    assert c.get_dashboard()['junior_generation']==1
    assert c.get_account(hx(direct_charlie))['junior_value']==str(UNIT)
    assert c.get_account(hx(direct_alice))['junior_shares']=='0'
    old=c.get_generation_holding(hx(direct_alice),'junior',0)
    assert old=={'shares':str(UNIT),'value':'0','generation':0,'current':False}
    with direct_vm.expect_revert('Invalid share'):c.redeem('junior',UNIT)


def test_policy_allocations_keep_other_liabilities_funded(pool,direct_vm,direct_bob,direct_charlie):
    c,view,_=pool;c.wire_court(hx(direct_bob))
    direct_vm.value=4*UNIT;c.stake('junior')
    direct_vm.value=30*UNIT;c.stake('senior')
    first=quote(pool,direct_vm);direct_vm.value=UNIT//2;c.bind_policy(first)
    mock_risk(direct_vm);second=c.quote_policy('a2',10*UNIT,URLS[1:]);direct_vm.value=UNIT//2;c.bind_policy(second)
    original_second=c.get_policy(second)
    claim=claim_record(c,first,'loss-first',hx(direct_charlie),5*UNIT)
    view.get_claim=lambda _:claim;c.settle_claim('loss-first')
    assert c.get_policy(second)['junior_locked']==original_second['junior_locked']
    assert c.get_policy(second)['senior_locked']==original_second['senior_locked']
    d=c.get_dashboard()
    assert int(d['junior_locked'])<=int(d['junior'])
    assert int(d['senior_locked'])<=int(d['senior'])
    assert int(d['junior_locked'])+int(d['senior_locked'])>=int(d['reserved'])
    assert int(d['tvg'])==int(d['junior'])+int(d['senior'])+int(d['credits'])


def test_stale_manifest_quote_cannot_bind(pool,direct_vm,direct_bob):
    c,view,_=pool;c.wire_court(hx(direct_bob));qid=quote(pool,direct_vm)
    before=view.get_agent('a1');view.get_agent=lambda _: {**before,'manifest_hash':'new-revision'}
    direct_vm.value=UNIT//2
    with direct_vm.expect_revert('fresh quote'):c.bind_policy(qid)


def test_operator_quote_index_has_stable_earlier_page_cursor(pool,direct_vm,direct_alice):
    c=pool[0];ids=[quote(pool,direct_vm) for _ in range(52)]
    page=c.list_account_records(hx(direct_alice),'quotes',-1,50)
    later=quote(pool,direct_vm)
    older=c.list_account_records(hx(direct_alice),'quotes',page['next_cursor'],50)
    assert [q['id'] for q in page['items']+older['items']]==list(reversed(ids))
    assert later not in [q['id'] for q in older['items']]
    assert c.get_account(hx(direct_alice))['quotes']['total']==53
