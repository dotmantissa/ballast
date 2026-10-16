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
def manifest(direct_bob):
    return json.dumps({'name': 'Refund helper', 'scope': 'Issue refunds only after explicit customer approval.', 'executor_address': hx(direct_bob), 'spend_limit_gen': 2})


def test_registration_is_immutable_and_hashed(registry, manifest, direct_alice):
    agent_id = registry.register_agent(manifest, ['https://example.org/history'])
    agent = registry.get_agent(agent_id)
    assert agent['manifest_hash'] == hashlib.sha256(manifest.encode()).hexdigest()
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
    assert registry.get_loss_record(hx(direct_alice)) == {'claims':0, 'paid':'0'}
    policy = {}
    view = SimpleNamespace(get_settlement=lambda _: policy)
    from genlayer import gl
    with patch.object(gl, 'get_contract_at', return_value=SimpleNamespace(view=lambda: view)):
        with direct_vm.expect_revert('not settled'):
            registry.sync_loss('p1')
        policy.update({'operator':hx(direct_alice), 'paid':'20'})
        registry.sync_loss('p1')
        assert registry.get_loss_record(hx(direct_alice)) == {'claims':1, 'paid':'20'}
        with direct_vm.expect_revert('already recorded'):
            registry.sync_loss('p1')
