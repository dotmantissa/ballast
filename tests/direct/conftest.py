import pytest

# Keep clean machines on the same downloadable SDK bundle as local tests.
# Newer GenVM releases renamed the universal asset that gltest 0.29.2 expects.
@pytest.fixture
def direct_deploy(direct_deploy):
    def deploy(contract_path, *args, **kwargs):
        return direct_deploy(contract_path, *args, sdk_version='v0.2.16', **kwargs)
    return deploy
