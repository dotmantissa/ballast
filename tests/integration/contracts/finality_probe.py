# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from genlayer.py.public_abi import StorageType

# Read only runtime diagnostic, never part of application accounting.
class FinalityProbe(gl.Contract):
    registry: Address

    def __init__(self, registry: str):
        self.registry = Address(registry)

    @gl.public.view
    def read_final_agent(self, agent_id: str) -> dict:
        return gl.get_contract_at(self.registry).view(state=StorageType.LATEST_FINAL).get_agent(agent_id)

    @gl.public.view
    def read_latest_agent(self, agent_id: str) -> dict:
        return gl.get_contract_at(self.registry).view().get_agent(agent_id)
