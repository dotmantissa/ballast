"""Run the existing reserve, tranche, finality and withdrawal regressions on v2."""
from test_underwriting import *
from test_underwriting import pool as original_pool

@pytest.fixture
def pool(direct_vm, direct_deploy, direct_alice, direct_bob):
    def deploy(path, *args):
        return direct_deploy(path.replace('contracts/', 'contracts/v2/'), *args, hx(direct_bob), [])
    for contract, view, exposure in original_pool.__wrapped__(direct_vm, deploy, direct_alice, direct_bob):
        view.get_passport = lambda _: {'ready':True, 'final_assessment':{'id':'assessment1', 'revision':1}}
        yield contract, view, exposure
