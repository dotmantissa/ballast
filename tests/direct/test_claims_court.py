def hx(value):
    return "0x"+value.hex() if isinstance(value,bytes) else str(value)

import json
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import pytest

UNIT=10**18
TX='0x'+'a'*64
OTHER_TX='0x'+'b'*64
URLS=['https://explorer.example.org/receipt','https://records.example.net/incident']


@pytest.fixture
def court(direct_vm,direct_deploy,direct_alice,direct_bob,direct_charlie):
    direct_vm.sender=direct_alice
    contract=direct_deploy('contracts/claims_court.py',hx(direct_bob),hx(direct_charlie))
    from genlayer import Address,gl
    policy={'id':'p1','agent_id':'a1','operator':str(Address(hx(direct_bob))),'status':'active','starts_at':0,'ends_at':4102444800,'remaining':str(10*UNIT),'manifest_hash':'manifest1'}
    agent={'id':'a1','scope':'Only spend after explicit approval. Limit 1 GEN.','history_urls':[URLS[0]],'executor_address':str(Address(hx(direct_charlie)))}
    settled={}
    events={}
    direct_vm.ballast_claimant=str(Address(hx(direct_alice)))
    view=SimpleNamespace(get_final_policy=lambda _:policy,get_agent=lambda _:agent,get_final_agent_revision=lambda *args:agent,get_final_event_record=lambda key:events.get(key,{'paid':'0','loss':'0'}),get_final_settlement=lambda key:settled.get(key,{}))
    original_get=gl.nondet.web.get
    def get(url):
        if url.startswith('https://explorer-studio.genlayer.com/api/transactions/'):
            record={'hash':url.rsplit('/',1)[1],'status':'FINALIZED','from_address':agent['executor_address'],'triggered_by_hash':None}
            return SimpleNamespace(status=200,body=json.dumps({'transaction':record}).encode())
        return original_get(url)
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=lambda **kwargs:view,emit=MagicMock(return_value=MagicMock()))), patch.object(gl.nondet.web,'get',side_effect=get):
        yield contract,policy,settled,view,events


def file(court,vm):
    vm.value=UNIT//100
    return court[0].file_claim('p1',TX,1,UNIT,'The registered executor spent 1 GEN without approval and caused a realized loss to my account.',URLS)


def mock_finding(vm,field,value):
    vm.clear_mocks()
    vm.mock_web('https://.*',{'status':200,'body':'Public authoritative execution record, transaction and claimant details.'})
    vm.mock_llm('Ballast finding: '+field,json.dumps({'value':value,'reason':'The public sources identify this precise action and the supported result.','loss_wei':str(UNIT),'occurred_at':1,'event_ref':TX,'claimant':vm.ballast_claimant}))


def resolve(court,vm,cid,values=(True,True,False,100)):
    for field,value in zip(['harm','causation','scope','payout'],values):
        mock_finding(vm,field,value)
        court[0].resolve_finding(cid,field)


def test_file_records_exact_inputs_and_bond(court,direct_vm):
    cid=file(court,direct_vm); c=court[0].get_claim(cid)
    assert c['evidence_urls']==URLS and c['status']=='filed'
    assert c['claim_bond']==str(UNIT//100)
    assert court[0].get_policy_claim('p1')==cid
    assert court[0].list_claims(0,10)==[c]
    assert court[0].get_config()['claim_count']==1


def test_claim_access_bond_period_and_cap(court,direct_vm,direct_bob):
    c,policy,*_=court
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('third party'):file(court,direct_vm)
    direct_vm.value=0
    with direct_vm.expect_revert('exact claim bond'):
        c.file_claim('p1',TX,1,UNIT,'A sufficiently detailed statement about the exact harmful action.',URLS)
    policy['remaining']='1'
    with direct_vm.expect_revert('exceeds'):file(court,direct_vm)
    policy['remaining']=str(10*UNIT);policy['starts_at']=10
    with direct_vm.expect_revert('coverage period'):file(court,direct_vm)


def test_source_diversity_and_active_claim(court,direct_vm):
    c=court[0];direct_vm.value=UNIT//100
    with direct_vm.expect_revert('two source hosts'):
        c.file_claim('p1',TX,1,UNIT,'A sufficiently detailed statement about the exact harmful action.',[URLS[0],URLS[0]+'/more'])
    file(court,direct_vm)
    with direct_vm.expect_revert('open claim'):file(court,direct_vm)


def test_four_findings_resolve_separately_and_compare(court,direct_vm):
    cid=file(court,direct_vm)
    with direct_vm.expect_revert('three boolean'):court[0].resolve_finding(cid,'payout')
    resolve(court,direct_vm,cid)
    assert court[0].get_claim(cid)['status']=='challenge'
    assert direct_vm.run_validator()
    mock_finding(direct_vm,'payout',75)
    assert not direct_vm.run_validator()
    assert not direct_vm.run_validator(leader_error=ValueError('failed'))
    with direct_vm.expect_revert('not available'):court[0].resolve_finding(cid,'harm')
    with direct_vm.expect_revert('not closed'):court[0].finalize_claim(cid)


@pytest.mark.parametrize('field,value',[('harm','true'),('causation',1),('scope',None),('payout',True),('payout',55)])
def test_strict_types_and_payout_enum(court,direct_vm,field,value):
    cid=file(court,direct_vm)
    if field=='payout':
        for f,v in [('harm',True),('causation',True),('scope',False)]:
            mock_finding(direct_vm,f,v);court[0].resolve_finding(cid,f)
    mock_finding(direct_vm,field,value)
    with direct_vm.expect_revert('LLM_ERROR'):court[0].resolve_finding(cid,field)


def test_unavailable_evidence_does_not_deny(court,direct_vm):
    cid=file(court,direct_vm)
    direct_vm.mock_web('https://.*',{'status':404,'body':'Missing record'})
    with direct_vm.expect_revert('TRANSIENT'):court[0].resolve_finding(cid,'harm')
    assert court[0].get_claim(cid)['findings']=={}


@pytest.mark.parametrize('values,payout', [((True,True,False,75),3*UNIT//4),((False,True,False,100),0),((True,False,False,100),0),((True,True,True,100),0)])
def test_finalization_gate_and_correct_bond_recipient(court,direct_vm,direct_alice,values,payout):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid,values)
    direct_vm.warp('2035-01-01T00:00:00Z')
    court[0].finalize_claim(cid)
    c=court[0].get_claim(cid)
    assert c['status']=='final' and c['payout']==str(payout)
    assert court[0].get_bond_credit(c['claimant'] if payout else c['operator'])==str(UNIT//100)
    with direct_vm.expect_revert():court[0].finalize_claim(cid)


def test_scoped_appeal_reopens_dependent_payout(court,direct_vm):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid)
    mock_finding(direct_vm,'scope',True);direct_vm.value=UNIT//100
    court[0].appeal_finding(cid,'scope','The approval record was overlooked and changes the interpretation of the registered scope.',URLS)
    c=court[0].get_claim(cid)
    assert c['status']=='reviewing' and 'payout' not in c['findings']
    assert c['findings']['harm'] is True and c['findings']['causation'] is True
    assert c['appeals'][0]['changed'] is True
    mock_finding(direct_vm,'payout',0);court[0].resolve_finding(cid,'payout')
    with direct_vm.expect_revert('already appealed'):
        court[0].appeal_finding(cid,'scope','A detailed and repeated argument cannot reopen the same finding twice.',URLS)


def test_appeal_access_exact_bond_and_deadline(court,direct_vm,direct_charlie):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid)
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert('Only the claimant'):court[0].appeal_finding(cid,'harm','A detailed argument about the public evidence and why the harm finding should change.',URLS)
    direct_vm.value=1
    with direct_vm.expect_revert('exact appeal bond'):court[0].appeal_finding(cid,'harm','A detailed argument about the public evidence and why the harm finding should change.',URLS)
    direct_vm.warp('2035-01-01T00:00:00Z')
    with direct_vm.expect_revert('closed'):court[0].appeal_finding(cid,'harm','A detailed argument about the public evidence and why the harm finding should change.',URLS)


def test_rejected_appeal_bond_goes_to_other_party(court,direct_vm):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid)
    mock_finding(direct_vm,'harm',True);direct_vm.value=UNIT//100
    court[0].appeal_finding(cid,'harm','The claimant asks for a second look at the same public execution evidence.',URLS)
    c=court[0].get_claim(cid)
    assert court[0].get_bond_credit(c['operator'])==str(UNIT//100)


def test_existing_settlement_allows_new_claim_and_incident_replay_blocked(court,direct_vm):
    cid=file(court,direct_vm);court[2][cid]={'paid':'0'}
    retry=file(court,direct_vm)
    assert retry!=cid
    court[2][retry]={'paid':'0'}
    other=court[0].file_claim('p1',OTHER_TX,1,UNIT,'A second distinct and sufficiently detailed incident statement with evidence.',URLS)
    assert other!=cid


def test_missing_claim_page_and_empty_bond_credit(court,direct_vm):
    with direct_vm.expect_revert('not found'):court[0].get_claim('missing')
    with direct_vm.expect_revert('Invalid page'):court[0].list_claims(-1,10)
    with direct_vm.expect_revert('No bond credit'):court[0].withdraw_bonds()


def test_boolean_validator_requires_independent_exact_agreement(court,direct_vm):
    cid=file(court,direct_vm);mock_finding(direct_vm,'harm',True)
    court[0].resolve_finding(cid,'harm')
    assert direct_vm.run_validator()
    mock_finding(direct_vm,'harm',False)
    assert not direct_vm.run_validator()


def test_bond_withdrawal_emits_exact_amount_once(court,direct_vm):
    import sys
    from unittest.mock import MagicMock
    cid=file(court,direct_vm);resolve(court,direct_vm,cid)
    direct_vm.warp('2035-01-01T00:00:00Z');court[0].finalize_claim(cid)
    c=court[0].get_claim(cid);emitter=MagicMock()
    with patch.object(sys.modules['_contract_claims_court'],'_Recipient',return_value=emitter):
        court[0].withdraw_bonds()
    assert int(emitter.emit_transfer.call_args.kwargs['value'])==UNIT//100
    assert court[0].get_bond_credit(c['claimant'])=='0'
    with direct_vm.expect_revert('No bond credit'):court[0].withdraw_bonds()


def test_a_wrong_claimant_does_not_consume_someone_elses_reference(court,direct_vm,direct_charlie):
    first=file(court,direct_vm)
    court[2][first]={'paid':'0'}
    with direct_vm.prank(direct_charlie):
        second=file(court,direct_vm)
    assert first!=second


def test_same_claimant_cannot_replay_incident_under_another_policy(court,direct_vm):
    first=file(court,direct_vm)
    court[2][first]={'paid':'0'}
    court[1]['id']='p2'
    c=court[0].get_claim(first)
    court[4][c['event_key']]={'paid':str(UNIT),'loss':str(UNIT)}
    with direct_vm.expect_revert('already been compensated'):
        court[0].file_claim('p2',TX,1,UNIT,'The registered executor spent 1 GEN without approval and caused a realized loss to my account.',URLS)


@pytest.mark.parametrize('bad',['https://[invalid','https://example.org:444/x','https://u:p@example.org/x','https://127.0.0.1/x'])
def test_contract_rejects_malformed_evidence(court,direct_vm,bad):
    direct_vm.value=UNIT//100
    with direct_vm.expect_revert('public HTTPS'):
        court[0].file_claim('p1',TX,1,UNIT,'A sufficiently detailed and evidenced incident statement for the court.',[bad,URLS[1]])


def test_default_port_and_case_do_not_count_as_different_hosts(court,direct_vm):
    direct_vm.value=UNIT//100
    with direct_vm.expect_revert('two source hosts'):
        court[0].file_claim('p1',TX,1,UNIT,'A sufficiently detailed and evidenced incident statement for the court.',['https://example.org/a','https://EXAMPLE.org:443/b'])


def at(vm, seconds):
    from datetime import datetime, timezone
    vm.warp(datetime.fromtimestamp(seconds,timezone.utc).isoformat())


def test_overdue_unreachable_case_can_close_and_refund_bond(court,direct_vm,direct_charlie):
    cid=file(court,direct_vm);c=court[0].get_claim(cid)
    direct_vm.mock_web('https://.*',{'status':404,'body':'gone'})
    with direct_vm.expect_revert('TRANSIENT'):court[0].resolve_finding(cid,'harm')
    with direct_vm.expect_revert('overdue'):court[0].close_unresolved_claim(cid)
    at(direct_vm,c['review_deadline'])
    with direct_vm.prank(direct_charlie):court[0].close_unresolved_claim(cid)
    closed=court[0].get_claim(cid)
    assert closed['status']=='final' and closed['outcome']=='evidence_timeout' and closed['payout']=='0'
    assert court[0].get_bond_credit(c['claimant'])==c['claim_bond']
    with direct_vm.expect_revert('overdue'):court[0].close_unresolved_claim(cid)


def test_claimant_can_withdraw_and_other_party_cannot(court,direct_vm,direct_bob):
    cid=file(court,direct_vm)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('Only the claimant'):court[0].withdraw_claim(cid)
    court[0].withdraw_claim(cid)
    assert court[0].get_claim(cid)['outcome']=='withdrawn'


def test_repair_sources_preserves_deadline_and_does_not_need_old_history(court,direct_vm):
    from genlayer import gl
    cid=file(court,direct_vm);deadline=court[0].get_claim(cid)['review_deadline']
    new=['https://archive.example.org/receipt','https://ledger.example.net/event']
    court[0].add_evidence(cid,new)
    assert court[0].get_claim(cid)['review_deadline']==deadline
    mock_finding(direct_vm,'harm',True)
    original=gl.nondet.web.get
    def fetch(url):
        if url in URLS:return SimpleNamespace(status=404,body=b'gone')
        return original(url)
    with patch.object(gl.nondet.web,'get',side_effect=fetch):court[0].resolve_finding(cid,'harm')
    assert court[0].get_claim(cid)['findings']['harm'] is True


def test_each_party_keeps_appeal_right_after_favorable_preemption(court,direct_vm,direct_bob):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid,(False,True,False,0))
    direct_vm.value=UNIT//100;mock_finding(direct_vm,'harm',False)
    with direct_vm.prank(direct_bob):
        court[0].appeal_finding(cid,'harm','The operator requests that the existing no harm finding be upheld based on the records.',URLS)
    mock_finding(direct_vm,'harm',True)
    court[0].appeal_finding(cid,'harm','The claimant supplies better evidence proving the realized loss and correct incident time.',URLS)
    c=court[0].get_claim(cid)
    assert c['findings']['harm'] is True and c['status']=='reviewing'
    assert len(c['appeals'])==2
    mock_finding(direct_vm,'payout',100);court[0].resolve_finding(cid,'payout')
    with direct_vm.expect_revert('already appealed'):
        court[0].appeal_finding(cid,'harm','The same party cannot repeat the same appeal and extend the case without a bound.',URLS)


def test_dependent_payout_fetches_successful_appeal_sources(court,direct_vm):
    from genlayer import gl
    cid=file(court,direct_vm);resolve(court,direct_vm,cid,(True,True,True,0))
    new=['https://approvals.example.org/denial','https://receipts.example.net/limits']
    direct_vm.value=UNIT//100;mock_finding(direct_vm,'scope',False)
    court[0].appeal_finding(cid,'scope','The newly published denial and permission records prove this transaction exceeded authority.',new)
    mock_finding(direct_vm,'payout',100)
    original=gl.nondet.web.get
    fetched=[]
    def fetch(url):fetched.append(url);return original(url)
    with patch.object(gl.nondet.web,'get',side_effect=fetch):court[0].resolve_finding(cid,'payout')
    assert set(new).issubset(fetched)
    assert set(new).issubset(court[0].get_claim(cid)['effective_evidence_urls'])


def test_assessment_receives_policy_dates_and_rejects_false_submitted_time(court,direct_vm):
    from genlayer import gl
    cid=file(court,direct_vm)
    mock_finding(direct_vm,'harm',True)
    captured=[]
    def assess(prompt,**kwargs):
        context=json.loads(prompt.split('Context: ',1)[1].split('\nSources: ',1)[0])
        captured.append(context)
        return {'value':True,'reason':'The actual event happened before the insured period, despite the submitted timestamp.',
                'loss_wei':str(UNIT),'occurred_at':-1,'event_ref':TX,'claimant':direct_vm.ballast_claimant}
    with patch.object(gl.nondet,'exec_prompt',side_effect=assess):court[0].resolve_finding(cid,'harm')
    assert captured[0]['policy']['starts_at']==court[1]['starts_at']
    assert captured[0]['policy']['ends_at']==court[1]['ends_at']
    assert court[0].get_claim(cid)['findings']['harm'] is False


def test_positive_harm_consensus_compares_loss_and_time_not_only_boolean(court,direct_vm):
    cid=file(court,direct_vm);mock_finding(direct_vm,'harm',True);court[0].resolve_finding(cid,'harm')
    assert direct_vm.run_validator()
    direct_vm.clear_mocks();direct_vm.mock_web('https://.*',{'status':200,'body':'A complete independently retrieved public receipt.'})
    direct_vm.mock_llm('Ballast finding: harm',json.dumps({'value':True,'reason':'The same event has a different independently assessed loss.', 'loss_wei':str(UNIT//2),'occurred_at':1,'event_ref':TX,'claimant':direct_vm.ballast_claimant}))
    assert not direct_vm.run_validator()


def test_payout_cannot_exceed_verified_loss(court,direct_vm):
    from genlayer import gl
    cid=file(court,direct_vm)
    mock_finding(direct_vm,'harm',True)
    payload={'value':True,'reason':'The receipts prove only half the requested loss in native GEN.', 'loss_wei':str(UNIT//2),'occurred_at':1,'event_ref':TX,'claimant':direct_vm.ballast_claimant}
    with patch.object(gl.nondet,'exec_prompt',return_value=payload):court[0].resolve_finding(cid,'harm')
    for field,value in [('causation',True),('scope',False),('payout',100)]:
        mock_finding(direct_vm,field,value);court[0].resolve_finding(cid,field)
    c=court[0].get_claim(cid);at(direct_vm,c['challenge_until']);court[0].finalize_claim(cid)
    assert court[0].get_claim(cid)['payout']==str(UNIT//2)


@pytest.mark.parametrize('alias',['receipt:a transaction',' '+TX,TX+' ',TX+'/0','genlayer:'+TX])
def test_arbitrary_incident_aliases_are_rejected(court,direct_vm,alias):
    direct_vm.value=UNIT//100
    with direct_vm.expect_revert('exact Studio transaction hash'):
        court[0].file_claim('p1',alias,1,UNIT,'The registered executor spent 1 GEN without approval and caused a realized loss.',URLS)


def test_event_identity_survives_agent_policy_and_hash_case_aliases(court,direct_vm):
    cid=file(court,direct_vm);c=court[0].get_claim(cid)
    court[2][cid]={'paid':str(UNIT)};court[4][c['event_key']]={'paid':str(UNIT),'loss':str(UNIT)}
    court[1]['id']='p2';court[1]['agent_id']='other-agent'
    with direct_vm.expect_revert('already been compensated'):
        court[0].file_claim('p2',TX.upper(),1,UNIT,'The same realized loss cannot be compensated again under a new policy or agent.',URLS)


def test_all_authoritative_court_reads_use_finalized_projections(court,direct_vm):
    from genlayer import gl
    view=court[3]
    def select(**kwargs):
        assert kwargs == {}
        return view
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=select)):
        cid=file(court,direct_vm);mock_finding(direct_vm,'harm',True);court[0].resolve_finding(cid,'harm')


def test_only_both_parties_can_waive_challenge_time_and_appeals_reset_consent(court,direct_vm,direct_bob,direct_charlie):
    cid=file(court,direct_vm);resolve(court,direct_vm,cid)
    court[0].accept_decision(cid)
    with direct_vm.expect_revert('not closed'):court[0].finalize_claim(cid)
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert('Only a party'):court[0].accept_decision(cid)
    mock_finding(direct_vm,'payout',100);direct_vm.value=UNIT//100
    with direct_vm.prank(direct_bob):
        court[0].appeal_finding(cid,'payout','Please independently confirm the payout against the original public transaction and loss records.',URLS)
        assert court[0].get_claim(cid)['acceptances']==[]
        court[0].accept_decision(cid)
    with direct_vm.expect_revert('not closed'):court[0].finalize_claim(cid)
    court[0].accept_decision(cid);court[0].finalize_claim(cid)
    assert court[0].get_claim(cid)['payout']==str(UNIT)


def test_account_index_recovers_old_unresolved_claim_past_public_window(court,direct_vm,direct_charlie):
    c=court[0];first=file(court,direct_vm)
    # Distinct policies and losses populate real court storage; SDK peers supply policy metadata only.
    for i in range(52):
        direct_vm.value=UNIT//100
        c.file_claim('policy-'+str(i),'0x'+format(i+100,'064x'),1,UNIT,'A distinct sufficiently evidenced transaction and realized claimant loss.',URLS)
    account=c.get_claim(first)['claimant']
    latest=c.list_account_claims(account,True,-1,50)
    assert first not in [item['id'] for item in latest['items']]
    older=c.list_account_claims(account,True,latest['next_cursor'],50)
    assert first in [item['id'] for item in older['items']]
    assert latest['total']==53 and older['next_cursor'] is None
    # Removing a non-last entry must retain all other unresolved cases and their positions.
    c.withdraw_claim(first)
    assert c.get_account_cases(account)['unresolved']['total']==53
    court[2][first]={'policy_id':'p1','paid':'0'}
    c.acknowledge_settlement(first)
    assert c.get_account_cases(account)['unresolved']['total']==52
    one=c.list_account_claims(account,True,-1,1)['items'][0]
    c.withdraw_claim(one['id'])
    court[2][one['id']]={'policy_id':one['policy_id'],'paid':'0'}
    c.acknowledge_settlement(one['id'])
    assert c.get_account_cases(account)['unresolved']['total']==51
    assert c.get_account_cases(account)['claims']['total']==53


def test_final_decision_stays_recoverable_until_financial_settlement(court,direct_vm):
    cid=file(court,direct_vm);court[0].withdraw_claim(cid)
    account=court[0].get_claim(cid)['claimant']
    assert court[0].get_account_cases(account)['unresolved']['items'][0]['id']==cid
    with direct_vm.expect_revert('Finalized pool'):court[0].acknowledge_settlement(cid)
    court[2][cid]={'policy_id':'p1','paid':'0'};court[0].acknowledge_settlement(cid)
    assert court[0].get_claim(cid)['status']=='settled'
    assert court[0].get_account_cases(account)['unresolved']['items']==[]


def test_distinct_cases_can_file_concurrently_and_exposure_ends_only_at_settlement(court,direct_vm,direct_charlie):
    c=court[0];first=file(court,direct_vm)
    with direct_vm.prank(direct_charlie):
        second=c.file_claim('p1',OTHER_TX,1,UNIT,'A separate claimant lost their own native funds in another executor debit.',URLS)
    assert first!=second
    assert c.get_policy_exposure('p1')=={'requested':str(2*UNIT),'open_count':2}
    c.withdraw_claim(first)
    assert c.get_policy_exposure('p1')['requested']==str(2*UNIT)
    court[2][first]={'policy_id':'p1','paid':'0'}
    c.acknowledge_settlement(first)
    assert c.get_policy_exposure('p1')=={'requested':str(UNIT),'open_count':1}
    assert c.get_claim(first)['settled_payout']=='0'


def test_each_party_retains_its_own_evidence_repair_budget(court,direct_vm,direct_bob):
    c=court[0];cid=file(court,direct_vm)
    for i in range(3):
        c.add_evidence(cid,[f'https://repair{i}.example.org/a',f'https://repair{i}.example.net/b',f'https://repair{i}.example.org/c',f'https://repair{i}.example.net/d'])
    with direct_vm.expect_revert('twelve'):
        c.add_evidence(cid,['https://last.example.org/a','https://last.example.net/b'])
    with direct_vm.prank(direct_bob):
        c.add_evidence(cid,['https://operator.example.org/a','https://operator.example.net/b'])
    case=c.get_claim(cid)
    assert len(case['effective_evidence_urls'])==16
    assert case['review_deadline']==case['created_at']+7*86400


def test_worst_case_fair_appeals_have_a_finite_seventy_day_bound(court,direct_vm,direct_bob):
    c=court[0];cid=file(court,direct_vm);created=c.get_claim(cid)['created_at']
    at(direct_vm,c.get_claim(cid)['review_deadline']-1)
    resolve(court,direct_vm,cid)
    # Both sides use payout rights in every revision and change each boolean once.
    for revision in range(7):
        for operator in [False,True]:
            at(direct_vm,c.get_claim(cid)['challenge_until']-1)
            mock_finding(direct_vm,'payout',100);direct_vm.value=UNIT//100
            if operator:
                with direct_vm.prank(direct_bob):c.appeal_finding(cid,'payout','Please reconsider the supported fraction using the full public debit and permission records.',URLS)
            else:
                c.appeal_finding(cid,'payout','Please reconsider the supported fraction using the full public debit and permission records.',URLS)
        if revision==6:break
        field=['harm','causation','scope'][revision//2]
        before=c.get_claim(cid)['findings'][field]
        at(direct_vm,c.get_claim(cid)['challenge_until']-1)
        mock_finding(direct_vm,field,not before);direct_vm.value=UNIT//100
        if revision%2:
            with direct_vm.prank(direct_bob):c.appeal_finding(cid,field,'Please reconsider this specific finding against the public debit and permission records.',URLS)
        else:
            c.appeal_finding(cid,field,'Please reconsider this specific finding against the public debit and permission records.',URLS)
        at(direct_vm,c.get_claim(cid)['review_deadline']-1)
        mock_finding(direct_vm,'payout',100);c.resolve_finding(cid,'payout')
    case=c.get_claim(cid)
    assert len(case['appeals'])==20
    assert case['eligibility_revision']==6
    assert case['challenge_until']-created<=70*86400
    at(direct_vm,case['challenge_until']);c.finalize_claim(cid)
    assert c.get_claim(cid)['status']=='final'


@pytest.mark.parametrize('change',[{'triggered_by_hash':OTHER_TX},{'from_address':'0x'+'f'*40},{'hash':OTHER_TX},{'status':'ACCEPTED'}])
def test_positive_model_output_cannot_make_a_child_or_unrelated_transaction_canonical(court,direct_vm,change):
    from genlayer import gl
    cid=file(court,direct_vm);mock_finding(direct_vm,'harm',True)
    original_get=gl.nondet.web.get
    def get(url):
        response=original_get(url)
        if url.startswith('https://explorer-studio.genlayer.com/api/transactions/'):
            payload=json.loads(response.body);payload['transaction'].update(change)
            return SimpleNamespace(status=200,body=json.dumps(payload).encode())
        return response
    with patch.object(gl.nondet.web,'get',side_effect=get):court[0].resolve_finding(cid,'harm')
    assert court[0].get_claim(cid)['findings']['harm'] is False
    assert court[0].get_claim(cid)['verified_loss']=='0'


def test_unavailable_canonical_chain_record_is_recoverable_not_a_denial(court,direct_vm):
    from genlayer import gl
    cid=file(court,direct_vm);mock_finding(direct_vm,'harm',True)
    original_get=gl.nondet.web.get
    def get(url):
        if url.startswith('https://explorer-studio.genlayer.com/api/transactions/'):
            return SimpleNamespace(status=503,body=b'Unavailable')
        return original_get(url)
    with patch.object(gl.nondet.web,'get',side_effect=get):
        with direct_vm.expect_revert('TRANSIENT'):court[0].resolve_finding(cid,'harm')
    assert court[0].get_claim(cid)['findings']=={}
    court[0].resolve_finding(cid,'harm')
    assert court[0].get_claim(cid)['findings']['harm'] is True


def test_final_decision_is_unavailable_until_authenticated_confirmation(court,direct_vm):
    from genlayer import gl
    c=court[0];cid=file(court,direct_vm)
    c.withdraw_claim(cid)
    with direct_vm.expect_revert('pending'):c.get_final_claim(cid)
    decision=c._decision(c.get_claim(cid));payload=json.dumps(decision,sort_keys=True)
    with direct_vm.expect_revert('Only a finalized'):c.confirm_claim(payload)
    with direct_vm.prank(gl.message.contract_address):
        c.confirm_claim(payload);c.confirm_claim(payload)
        with direct_vm.expect_revert('immutable'):
            c.confirm_claim(json.dumps({**decision,'payout':str(UNIT)},sort_keys=True))
    assert c.get_final_claim(cid)==decision
    c.publish_final_claim(cid)
    assert c.list_account_claims(c.get_claim(cid)['claimant'],True,-1,50)['total']==1


def test_filing_seal_is_cumulative_immutable_and_authenticated(court,direct_vm):
    from genlayer import gl
    c,policy,*_=court
    first=file(court,direct_vm)
    direct_vm.value=UNIT//100
    second=c.file_claim('p1',OTHER_TX,1,UNIT,'A second separate actual native debit needs its own full case commitment.',URLS)
    c.withdraw_claim(first)
    with direct_vm.expect_revert('still open'):c.seal_policy('p1')
    direct_vm.warp('2100-01-10T00:00:00Z')
    c.seal_policy('p1')
    assert c.get_final_policy_seal('p1')=={}
    payload=c.policy_seals['p1']
    assert json.loads(payload)['total_requested']==str(2*UNIT)
    with direct_vm.expect_revert('Only a finalized'):c.confirm_policy_seal(payload)
    with direct_vm.prank(gl.message.contract_address):
        with direct_vm.expect_revert('immutable'):c.confirm_policy_seal(json.dumps({'policy_id':'p1','total_requested':'0'},sort_keys=True))
        c.confirm_policy_seal(payload)
    assert c.get_final_policy_seal('p1')['total_requested']==str(2*UNIT)
    c.seal_policy('p1')
    assert c.policy_seals['p1']==payload
    # Even if a clock fixture moves backwards, sealing permanently closes filing.
    direct_vm.warp('2030-01-01T00:00:00Z')
    with direct_vm.expect_revert('not open'):
        c.file_claim('p1','0x'+'c'*64,1,UNIT,'A sufficiently detailed statement cannot reopen a sealed filing window.',URLS)
    assert c.get_claim(second)['status']=='filed'


def test_all_court_confirmations_wait_for_parent_finality(court,direct_vm):
    from genlayer import gl
    c=court[0];cid=file(court,direct_vm);emitter=MagicMock()
    view=court[3]
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=lambda:view,emit=emitter)):
        c.withdraw_claim(cid)
        emitter.assert_called_with(on='finalized')
        payload=emitter.return_value.confirm_claim.call_args.args[0]
        with direct_vm.prank(gl.message.contract_address):c.confirm_claim(payload)
        direct_vm.warp('2100-01-10T00:00:00Z');c.seal_policy('p1')
        seal=emitter.return_value.confirm_policy_seal.call_args.args[0]
        with direct_vm.prank(gl.message.contract_address):c.confirm_policy_seal(seal)
        assert all(call.kwargs=={'on':'finalized'} for call in emitter.call_args_list)
        emitter.return_value.expire_policy.assert_called_with('p1')
