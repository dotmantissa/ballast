# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import hashlib
import json
import re
from urllib.parse import urlsplit, urlunsplit
from genlayer.py.public_abi import StorageType
from datetime import datetime, timezone


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _url(value: str) -> str:
    # Restrict v1 to public DNS HTTPS endpoints. No IP literals or credentials.
    if not isinstance(value, str) or len(value) > 500 or any(c.isspace() or ord(c) < 32 for c in value) or '\\' in value:
        raise gl.vm.UserError('Use a public HTTPS URL without credentials')
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower().rstrip('.')
        labels = host.split('.')
        if parsed.scheme != 'https' or parsed.username is not None or parsed.password is not None or parsed.port not in [None, 443]:
            raise ValueError('Invalid authority')
        if len(host) > 253 or len(labels) < 2 or not re.fullmatch(r'[a-z]{2,63}', labels[-1]):
            raise ValueError('Invalid public DNS host')
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
            raise ValueError('Invalid DNS label')
        if labels[-1] in ['local', 'internal', 'localhost', 'onion']:
            raise ValueError('Private DNS host')
        return urlunsplit(('https', host, parsed.path or '/', parsed.query, ''))
    except Exception:
        raise gl.vm.UserError('Use a public HTTPS URL without credentials')


def _unique_object(pairs):
    result = {}
    for key,value in pairs:
        if key in result:
            raise ValueError('Duplicate manifest field')
        result[key] = value
    return result

class AgentRegistry(gl.Contract):
    owner: Address
    underwriting: str
    agents: TreeMap[str, str]
    agent_ids: DynArray[str]
    losses: TreeMap[str, str]
    recorded: TreeMap[str, bool]
    executor_operators: TreeMap[str, str]
    revisions: TreeMap[str, str]
    account_indexes: TreeMap[str, str]
    account_counts: TreeMap[str, u256]

    def _index_account(self, kind: str, account: str, record_id: str) -> None:
        prefix = kind + ':' + str(Address(account))
        count = int(self.account_counts.get(prefix,u256(0)))
        self.account_indexes[prefix+':'+str(count)] = record_id
        self.account_counts[prefix] = u256(count+1)

    def _account_page(self, kind: str, account: str, before: int, limit: int) -> dict:
        if before < -1 or not 1 <= limit <= 50:
            raise gl.vm.UserError('Invalid page')
        prefix = kind + ':' + str(Address(account))
        total = int(self.account_counts.get(prefix,u256(0)))
        end = total if before == -1 else min(before,total)
        start = max(0,end-limit)
        ids = [self.account_indexes[prefix+':'+str(i)] for i in range(end-1,start-1,-1)]
        return {'ids':ids,'total':total,'next_cursor':start if start > 0 else None}


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
    def authorize_operator(self, operator: str) -> None:
        operator = str(Address(operator))
        executor = str(gl.message.sender_address)
        agent_id = hashlib.sha256(('genlayer-studio:' + executor.lower()).encode()).hexdigest()[:24]
        if agent_id in self.agents:
            raise gl.vm.UserError('Executor ownership is fixed after registration')
        self.executor_operators[executor] = operator

    def _manifest(self, manifest: str, history_urls: list[str]) -> dict:
        if not 30 <= len(manifest) <= 16000:
            raise gl.vm.UserError('Manifest must contain 30 to 16000 characters')
        try:
            data = json.loads(manifest, object_pairs_hook=_unique_object)
        except Exception:
            raise gl.vm.UserError('Manifest must be valid JSON')
        if not isinstance(data, dict):
            raise gl.vm.UserError('Manifest must be an object')
        for field in ['name', 'scope', 'executor_address']:
            if not isinstance(data.get(field), str) or not data[field].strip():
                raise gl.vm.UserError('Missing manifest field: ' + field)
        if len(data['name']) > 80 or len(data['scope']) < 20:
            raise gl.vm.UserError('Use a short name and a detailed scope')
        executor = str(Address(data['executor_address']))
        operator = str(gl.message.sender_address)
        if executor != operator and self.executor_operators.get(executor, '') != operator:
            raise gl.vm.UserError('The executor must authorize this operator first')
        if type(data.get('spend_limit_gen')) is not int or not 0 <= data['spend_limit_gen'] <= 100:
            raise gl.vm.UserError('spend_limit_gen must be a whole number from 0 to 100')
        if not 1 <= len(history_urls) <= 4:
            raise gl.vm.UserError('Supply one to four public history URLs')
        history_urls = list(dict.fromkeys(_url(url) for url in history_urls))
        data['executor_address'] = executor
        canonical = json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        agent_id = hashlib.sha256(('genlayer-studio:' + executor.lower()).encode()).hexdigest()[:24]
        return {'id':agent_id, 'name':data['name'].strip(), 'operator':operator,
                'manifest':manifest, 'manifest_hash':digest,
                'raw_manifest_hash':hashlib.sha256(manifest.encode()).hexdigest(),
                'scope':data['scope'], 'executor_address':executor,
                'history_urls':history_urls, 'registered_at':_now(), 'revised_at':_now()}

    @gl.public.write
    def register_agent(self, manifest: str, history_urls: list[str]) -> str:
        agent = self._manifest(manifest, history_urls)
        if agent['id'] in self.agents:
            raise gl.vm.UserError('This executor is already registered; use a manifest revision')
        self.executor_operators[agent['executor_address']] = agent['operator']
        encoded = json.dumps(agent, sort_keys=True)
        self.agents[agent['id']] = encoded
        self.revisions[agent['id'] + ':' + agent['manifest_hash']] = encoded
        self.agent_ids.append(agent['id'])
        self._index_account('agents',agent['operator'],agent['id'])
        return agent['id']

    @gl.public.write
    def revise_agent(self, agent_id: str, manifest: str, history_urls: list[str]) -> None:
        before = self.get_agent(agent_id)
        if Address(before['operator']) != gl.message.sender_address:
            raise gl.vm.UserError('Only the registered operator may revise the manifest')
        after = self._manifest(manifest, history_urls)
        if after['id'] != agent_id:
            raise gl.vm.UserError('A revision cannot change the executor')
        if agent_id + ':' + after['manifest_hash'] in self.revisions:
            raise gl.vm.UserError('This manifest revision is already registered')
        if self.underwriting:
            policy = gl.get_contract_at(Address(self.underwriting)).view(state=StorageType.LATEST_FINAL).get_agent_policy(agent_id)
            if policy and policy['status'] in ['active', 'runoff']:
                raise gl.vm.UserError('Close existing cover before revising the manifest')
        after['registered_at'] = before['registered_at']
        encoded = json.dumps(after, sort_keys=True)
        self.agents[agent_id] = encoded
        self.revisions[agent_id + ':' + after['manifest_hash']] = encoded

    @gl.public.view
    def get_agent_revision(self, agent_id: str, manifest_hash: str) -> dict:
        key = agent_id + ':' + manifest_hash
        if key not in self.revisions:
            raise gl.vm.UserError('Manifest revision not found')
        return json.loads(self.revisions[key])

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
        operator = str(Address(operator))
        if self.underwriting:
            return gl.get_contract_at(Address(self.underwriting)).view(state=StorageType.LATEST_FINAL).get_operator_record(operator)
        return {'claims':0, 'settled_claims':0, 'paid':'0'}

    @gl.public.write
    def sync_loss(self, claim_id: str) -> None:
        if not self.underwriting:
            raise gl.vm.UserError("Pool is not wired")
        if self.recorded.get(claim_id, False):
            raise gl.vm.UserError("Loss already recorded")
        policy = gl.get_contract_at(Address(self.underwriting)).view(state=StorageType.LATEST_FINAL).get_settlement(claim_id)
        if not policy:
            raise gl.vm.UserError("Claim has not settled")
        operator = str(Address(policy['operator']))
        record = json.loads(self.losses.get(operator, '{"claims":0,"paid":"0"}'))
        record['claims'] += 1 if int(policy['paid']) > 0 else 0
        record['paid'] = str(int(record['paid']) + int(policy['paid']))
        self.losses[operator] = json.dumps(record, sort_keys=True)
        self.recorded[claim_id] = True

    @gl.public.view
    def list_operator_agents(self, account: str, before: int, limit: int) -> dict:
        page = self._account_page('agents',account,before,limit)
        return {'items':[self.get_agent(i) for i in page['ids']], 'total':page['total'], 'next_cursor':page['next_cursor']}

    @gl.public.view
    def get_config(self) -> dict:
        return {'underwriting': self.underwriting, 'agent_count': len(self.agent_ids)}
