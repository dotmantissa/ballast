def hx(value):
    return "0x"+value.hex() if isinstance(value,bytes) else str(value)

import hashlib
import json
from types import SimpleNamespace
from unittest.mock import patch
import pytest


@pytest.fixture
def registry(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    return direct_deploy('contracts/agent_registry.py')


@pytest.fixture
def manifest(direct_alice):
    return json.dumps({'name': 'Refund helper', 'scope': 'Issue refunds only after explicit customer approval.', 'executor_address': hx(direct_alice), 'spend_limit_gen': 2})


def test_registration_is_immutable_and_hashed(registry, manifest, direct_alice):
    agent_id = registry.register_agent(manifest, ['https://example.org/history'])
    agent = registry.get_agent(agent_id)
    assert agent['raw_manifest_hash'] == hashlib.sha256(manifest.encode()).hexdigest()
    canonical = json.loads(manifest)
    canonical['executor_address'] = agent['executor_address']
    assert agent['manifest_hash'] == hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',', ':')).encode()).hexdigest()
    assert agent['manifest'] == manifest
    from genlayer import Address
    assert agent['operator'] == str(Address(hx(direct_alice)))
    assert registry.list_agents(0, 20) == [agent]
    assert registry.list_agents(5, 20) == []
    assert registry.get_config()['agent_count'] == 1


def test_reject_duplicate_and_bad_pages(registry, manifest, direct_vm):
    registry.register_agent(manifest, ['https://example.org/history'])
    with direct_vm.expect_revert('already registered'):
        registry.register_agent(manifest, ['https://example.org/history'])
    for offset, limit in [(-1, 2), (0, 0), (0, 51)]:
        with direct_vm.expect_revert('Invalid page'):
            registry.list_agents(offset, limit)
    with direct_vm.expect_revert('not found'):
        registry.get_agent('missing')


@pytest.mark.parametrize('change', [ {'name':''}, {'scope':'short'}, {'executor_address':'bad'}, {'spend_limit_gen':True}, {'spend_limit_gen':-1}, {'spend_limit_gen':101} ])
def test_bad_manifest(registry, manifest, direct_vm, change):
    data = json.loads(manifest); data.update(change)
    with direct_vm.expect_revert():
        registry.register_agent(json.dumps(data), ['https://example.org/history'])


@pytest.mark.parametrize('raw', ['x'*30, '[]' + ' '*30, 'x'*16001, '{}'], ids=['invalid','array','too_long','too_short'])
def test_invalid_json_and_length(registry, direct_vm, raw):
    with direct_vm.expect_revert():
        registry.register_agent(raw, ['https://example.org/history'])


@pytest.mark.parametrize('urls', [[], ['http://example.org'], ['https://example.org']*5])
def test_invalid_history(registry, manifest, direct_vm, urls):
    with direct_vm.expect_revert():
        registry.register_agent(manifest, urls)


def test_wiring_is_once_and_owner_only(registry, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('locked'):
            registry.wire_underwriting(hx(direct_bob))
    registry.wire_underwriting(hx(direct_bob))
    with direct_vm.expect_revert('locked'):
        registry.wire_underwriting(hx(direct_bob))


def test_loss_is_verified_and_recorded_once(registry, direct_vm, direct_bob, direct_alice):
    with direct_vm.expect_revert('not wired'):
        registry.sync_loss('p1')
    registry.wire_underwriting(hx(direct_bob))
    assert registry.get_config()['underwriting'] == hx(direct_bob)
    policy = {}
    view = SimpleNamespace(get_settlement=lambda _: policy, get_operator_record=lambda op:json.loads(registry.losses.get(op, '{"claims":0,"paid":"0"}')))
    from genlayer import gl
    with patch.object(gl, 'get_contract_at', return_value=SimpleNamespace(view=lambda **kwargs: view)):
        with direct_vm.expect_revert('not settled'):
            registry.sync_loss('p1')
        policy.update({'operator':hx(direct_alice), 'paid':'20'})
        registry.sync_loss('p1')
        assert registry.get_loss_record(hx(direct_alice)) == {'claims':1, 'paid':'20'}
        with direct_vm.expect_revert('already recorded'):
            registry.sync_loss('p1')


def test_whitespace_and_key_order_cannot_create_another_identity(registry, manifest, direct_vm):
    aid=registry.register_agent(manifest,['https://EXAMPLE.org:443/history#fragment'])
    assert registry.get_agent(aid)['history_urls']==['https://example.org/history']
    for variant in [manifest+'\n',json.dumps(json.loads(manifest),sort_keys=True,indent=2)]:
        with direct_vm.expect_revert('already registered'):
            registry.register_agent(variant,['https://example.org/history'])


def test_executor_must_authorize_operator_and_cannot_be_stolen(registry, manifest, direct_vm, direct_alice, direct_bob, direct_charlie):
    data=json.loads(manifest);data['executor_address']=hx(direct_bob)
    with direct_vm.expect_revert('authorize'):
        registry.register_agent(json.dumps(data),['https://example.org/history'])
    with direct_vm.prank(direct_bob):registry.authorize_operator(hx(direct_alice))
    aid=registry.register_agent(json.dumps(data),['https://example.org/history'])
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('fixed'):registry.authorize_operator(hx(direct_charlie))
    assert registry.get_agent(aid)['operator'] != hx(direct_charlie)


def test_revisions_preserve_identity_and_old_manifest(registry, manifest, direct_vm, direct_bob):
    aid=registry.register_agent(manifest,['https://example.org/history'])
    before=registry.get_agent(aid)
    data=json.loads(manifest);data['spend_limit_gen']=1
    registry.revise_agent(aid,json.dumps(data),['https://example.net/history'])
    assert registry.get_agent(aid)['id']==aid
    assert registry.get_agent_revision(aid,before['manifest_hash'])==before
    assert registry.get_config()['agent_count']==1
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('Only'):registry.revise_agent(aid,manifest,['https://example.org/history'])


def test_active_policy_prevents_revision_and_reads_final_state(registry, manifest, direct_vm, direct_bob):
    from genlayer import gl
    from genlayer.py.public_abi import StorageType
    aid=registry.register_agent(manifest,['https://example.org/history'])
    registry.wire_underwriting(hx(direct_bob))
    data=json.loads(manifest);data['spend_limit_gen']=1
    def view(**kwargs):
        assert kwargs['state']==StorageType.LATEST_FINAL
        return SimpleNamespace(get_agent_policy=lambda _: {'status':'active'})
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=view)):
        with direct_vm.expect_revert('Close existing'):
            registry.revise_agent(aid,json.dumps(data),['https://example.org/history'])


@pytest.mark.parametrize('url',['https://[invalid','https://example.org:444/x','https://user:pass@example.org/x','https://127.0.0.1/x','https://host.local/x','https://example.org/has space','https://example.org\\@host.net/x'])
def test_rejects_malformed_or_private_history(registry, manifest, direct_vm, url):
    with direct_vm.expect_revert('public HTTPS'):
        registry.register_agent(manifest,[url])


def test_operator_index_paginates_beyond_fifty_agents(registry,manifest,direct_vm,direct_alice):
    from genlayer import Address
    ids=[]
    for i in range(52):
        executor=Address('0x'+format(i+1000,'040x'))
        with direct_vm.prank(executor):registry.authorize_operator(hx(direct_alice))
        data=json.loads(manifest);data['executor_address']=str(executor)
        ids.append(registry.register_agent(json.dumps(data),['https://example.org/history']))
    first=registry.list_operator_agents(hx(direct_alice),-1,50)
    second=registry.list_operator_agents(hx(direct_alice),first['next_cursor'],50)
    assert [a['id'] for a in first['items']+second['items']]==list(reversed(ids))
    assert first['total']==52 and second['next_cursor'] is None
