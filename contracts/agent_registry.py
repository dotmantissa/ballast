# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import hashlib
import json
from datetime import datetime, timezone


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


class AgentRegistry(gl.Contract):
    owner: Address
    underwriting: str
    agents: TreeMap[str, str]
    agent_ids: DynArray[str]
    losses: TreeMap[str, str]
    recorded: TreeMap[str, bool]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.underwriting = ""

    @gl.public.write
    def wire_underwriting(self, address: str) -> None:
        if gl.message.sender_address != self.owner or self.underwriting:
            raise gl.vm.UserError("Wiring is locked")
        Address(address)
        self.underwriting = address

    @gl.public.write
    def register_agent(self, manifest: str, history_urls: list[str]) -> str:
        if len(manifest) > 16000 or len(manifest) < 30:
            raise gl.vm.UserError("Manifest must contain 30 to 16000 characters")
        try:
            data = json.loads(manifest)
        except Exception:
            raise gl.vm.UserError("Manifest must be valid JSON")
        if not isinstance(data, dict):
            raise gl.vm.UserError("Manifest must be an object")
        for field in ["name", "scope", "executor_address"]:
            if not isinstance(data.get(field), str) or not data[field].strip():
                raise gl.vm.UserError("Missing manifest field: " + field)
        if len(data['name']) > 80 or len(data['scope']) < 20:
            raise gl.vm.UserError("Use a short name and a detailed scope")
        Address(data['executor_address'])
        if type(data.get('spend_limit_gen')) is not int or not 0 <= data['spend_limit_gen'] <= 100:
            raise gl.vm.UserError("spend_limit_gen must be a whole number from 0 to 100")
        if not 1 <= len(history_urls) <= 4:
            raise gl.vm.UserError("Supply one to four public history URLs")
        for url in history_urls:
            if not url.startswith('https://') or len(url) > 500:
                raise gl.vm.UserError("History URLs must use HTTPS")
        digest = hashlib.sha256(manifest.encode('utf-8')).hexdigest()
        operator = str(gl.message.sender_address)
        agent_id = hashlib.sha256((operator + digest).encode()).hexdigest()[:24]
        if agent_id in self.agents:
            raise gl.vm.UserError("This manifest is already registered")
        self.agents[agent_id] = json.dumps({
            'id': agent_id, 'name': data['name'].strip(), 'operator': operator,
            'manifest': manifest, 'manifest_hash': digest, 'scope': data['scope'],
            'executor_address': data['executor_address'], 'history_urls': history_urls,
            'registered_at': _now(),
        }, sort_keys=True)
        self.agent_ids.append(agent_id)
        return agent_id

    @gl.public.view
    def get_agent(self, agent_id: str) -> dict:
        if agent_id not in self.agents:
            raise gl.vm.UserError("Agent not found")
        return json.loads(self.agents[agent_id])

    @gl.public.view
    def list_agents(self, offset: int, limit: int) -> list[dict]:
        if offset < 0 or not 1 <= limit <= 50:
            raise gl.vm.UserError("Invalid page")
        return [json.loads(self.agents[self.agent_ids[i]]) for i in range(offset, min(len(self.agent_ids), offset + limit))]

    @gl.public.view
    def get_loss_record(self, operator: str) -> dict:
        return json.loads(self.losses.get(operator, '{"claims":0,"paid":"0"}'))

    @gl.public.write
    def sync_loss(self, claim_id: str) -> None:
        if not self.underwriting:
            raise gl.vm.UserError("Pool is not wired")
        if self.recorded.get(claim_id, False):
            raise gl.vm.UserError("Loss already recorded")
        policy = gl.get_contract_at(Address(self.underwriting)).view().get_settlement(claim_id)
        if not policy:
            raise gl.vm.UserError("Claim has not settled")
        operator = policy['operator']
        record = self.get_loss_record(operator)
        record['claims'] += 1
        record['paid'] = str(int(record['paid']) + int(policy['paid']))
        self.losses[operator] = json.dumps(record, sort_keys=True)
        self.recorded[claim_id] = True

    @gl.public.view
    def get_config(self) -> dict:
        return {'underwriting': self.underwriting, 'agent_count': len(self.agent_ids)}
