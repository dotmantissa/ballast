def hx(value):
    return "0x"+value.hex() if isinstance(value,bytes) else str(value)

import json
from types import SimpleNamespace
from unittest.mock import patch
import pytest

UNIT=10**18
URLS=['https://explorer.example.org/receipt','https://records.example.net/incident']


@pytest.fixture
def court(direct_vm,direct_deploy,direct_alice,direct_bob,direct_charlie):
    direct_vm.sender=direct_alice
    contract=direct_deploy('contracts/claims_court.py',hx(direct_bob),hx(direct_charlie))
    from genlayer import Address,gl
    policy={'id':'p1','agent_id':'a1','operator':str(Address(hx(direct_bob))),'status':'active','starts_at':0,'ends_at':4102444800,'remaining':str(10*UNIT)}
    agent={'id':'a1','scope':'Only spend after explicit approval. Limit 1 GEN.','history_urls':[URLS[0]],'executor_address':str(Address(hx(direct_charlie)))}
    settled={}
    view=SimpleNamespace(get_policy=lambda _:policy,get_agent=lambda _:agent,get_settlement=lambda key:settled.get(key,{}))
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=lambda:view)):
        yield contract,policy,settled


def file(court,vm):
    vm.value=UNIT//100
    return court[0].file_claim('p1','receipt:abc123',1,UNIT,'The registered executor spent 1 GEN without approval and caused a realized loss to my account.',URLS)


def mock_finding(vm,field,value):
    vm.clear_mocks()
    vm.mock_web('https://.*',{'status':200,'body':'Public authoritative execution record, transaction and claimant details.'})
    vm.mock_llm('Ballast finding: '+field,json.dumps({'value':value,'reason':'The public sources identify this precise action and the supported result.'}))


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
    c,policy,_=court
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('third party'):file(court,direct_vm)
    direct_vm.value=0
    with direct_vm.expect_revert('exact claim bond'):
        c.file_claim('p1','receipt:abc123',1,UNIT,'A sufficiently detailed statement about the exact harmful action.',URLS)
    policy['remaining']='1'
    with direct_vm.expect_revert('exceeds'):file(court,direct_vm)
    policy['remaining']=str(10*UNIT);policy['starts_at']=10
    with direct_vm.expect_revert('coverage period'):file(court,direct_vm)


def test_source_diversity_and_active_claim(court,direct_vm):
    c=court[0];direct_vm.value=UNIT//100
    with direct_vm.expect_revert('two source hosts'):
        c.file_claim('p1','receipt:abcdef',1,UNIT,'A sufficiently detailed statement about the exact harmful action.',[URLS[0],URLS[0]+'/more'])
    file(court,direct_vm)
    with direct_vm.expect_revert('earlier claim'):file(court,direct_vm)


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
    with direct_vm.expect_revert('EXTERNAL'):court[0].resolve_finding(cid,'harm')
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
    with direct_vm.expect_revert('appealed again'):
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
    with direct_vm.expect_revert('already claimed'):file(court,direct_vm)
    other=court[0].file_claim('p1','receipt:def456',1,UNIT,'A second distinct and sufficiently detailed incident statement with evidence.',URLS)
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
    with direct_vm.expect_revert('already claimed'):
        court[0].file_claim('p2','receipt:abc123',1,UNIT,'The registered executor spent 1 GEN without approval and caused a realized loss to my account.',URLS)
