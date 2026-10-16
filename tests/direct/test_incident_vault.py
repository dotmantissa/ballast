from unittest.mock import MagicMock, patch
import sys
import pytest
UNIT=10**18

def hx(value):return '0x'+value.hex() if isinstance(value,bytes) else str(value)

@pytest.fixture
def vault(direct_vm,direct_deploy,direct_alice,direct_bob):
    direct_vm.sender=direct_alice
    return direct_deploy('tests/integration/contracts/incident_vault.py',hx(direct_alice),hx(direct_bob))

def test_deposits_come_from_the_claimant(vault,direct_vm,direct_bob):
    direct_vm.value=UNIT
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('Only the claimant'):vault.deposit()
    vault.deposit();assert vault.get_evidence()['escrow_wei']==str(UNIT)


def test_approved_history_and_actual_unapproved_debit(vault,direct_vm,direct_bob,direct_charlie):
    direct_vm.value=UNIT;vault.deposit();vault.approve_refund(UNIT//10)
    emitter=MagicMock()
    with patch.object(sys.modules['_contract_incident_vault'],'_Recipient',return_value=emitter):
        with direct_vm.prank(direct_bob):vault.execute_approved_refund()
        assert int(emitter.emit_transfer.call_args.kwargs['value'])==UNIT//10
        with direct_vm.prank(direct_bob):vault.spend_without_approval(UNIT//5,hx(direct_charlie))
        assert int(emitter.emit_transfer.call_args.kwargs['value'])==UNIT//5
    evidence=vault.get_evidence()
    assert evidence['escrow_wei']==str(7*UNIT//10)
    assert evidence['loss']['claimant_approval'] is False
    assert evidence['loss']['amount_wei']==str(UNIT//5)
    assert [item['kind'] for item in evidence['history']]==['deposit','approval','approved_refund','unapproved_native_debit']


def test_vault_rejects_unapproved_actors_and_repeat_loss(vault,direct_vm,direct_bob,direct_charlie):
    direct_vm.value=UNIT;vault.deposit()
    with direct_vm.expect_revert('Executor needs'):vault.execute_approved_refund()
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert('Only the claimant'):vault.approve_refund(1)
    with direct_vm.expect_revert('Only one'):vault.spend_without_approval(1,hx(direct_charlie))
    with patch.object(sys.modules['_contract_incident_vault'],'_Recipient',return_value=MagicMock()):
        with direct_vm.prank(direct_bob):
            vault.spend_without_approval(1,hx(direct_charlie))
            with direct_vm.expect_revert('Only one'):vault.spend_without_approval(1,hx(direct_charlie))
