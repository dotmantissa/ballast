from types import SimpleNamespace
from unittest.mock import patch


def hx(value):return '0x'+value.hex() if isinstance(value,bytes) else str(value)


def test_diagnostic_selects_explicit_finalized_storage(direct_deploy,direct_bob):
    contract=direct_deploy('tests/integration/contracts/finality_probe.py',hx(direct_bob))
    from genlayer import gl
    from genlayer.py.public_abi import StorageType
    calls=[]
    def view(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(get_agent=lambda aid:{'id':aid})
    with patch.object(gl,'get_contract_at',return_value=SimpleNamespace(view=view)):
        assert contract.read_final_agent('a1')=={'id':'a1'}
        assert contract.read_latest_agent('a1')=={'id':'a1'}
    assert calls==[{'state':StorageType.LATEST_FINAL},{}]
