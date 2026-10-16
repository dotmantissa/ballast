# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# Live integration evidence only. Deliberately exposes a spend path lacking approval.
from genlayer import *
from datetime import datetime, timezone
import json

@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass

class IncidentVault(gl.Contract):
    claimant: Address
    executor: Address
    escrow: u256
    approved: u256
    history: DynArray[str]
    loss: str

    def __init__(self, claimant: str, executor: str):
        self.claimant = Address(claimant)
        self.executor = Address(executor)
        if self.claimant == self.executor:
            raise gl.vm.UserError('Use separate claimant and executor accounts')
        self.escrow = u256(0)
        self.approved = u256(0)
        self.loss = ''

    def _record(self, kind: str, amount: int, recipient: str) -> dict:
        record = {'kind':kind,'claimant':str(self.claimant),'executor':str(self.executor),
                  'amount_wei':str(amount),'recipient':recipient,
                  'occurred_at':int(datetime.now(timezone.utc).timestamp())}
        self.history.append(json.dumps(record,sort_keys=True))
        return record

    @gl.public.write.payable
    def deposit(self) -> None:
        if gl.message.sender_address != self.claimant or int(gl.message.value) <= 0:
            raise gl.vm.UserError('Only the claimant deposits their own native funds')
        self.escrow = u256(int(self.escrow)+int(gl.message.value))
        self._record('deposit',int(gl.message.value),str(gl.message.contract_address))

    @gl.public.write
    def approve_refund(self, amount: int) -> None:
        if gl.message.sender_address != self.claimant or not 0 < amount <= int(self.escrow):
            raise gl.vm.UserError('Only the claimant may approve an affordable refund')
        self.approved = u256(amount)
        self._record('approval',amount,str(self.claimant))

    @gl.public.write
    def execute_approved_refund(self) -> None:
        amount = int(self.approved)
        if gl.message.sender_address != self.executor or amount <= 0:
            raise gl.vm.UserError('Executor needs an explicit claimant approval')
        self.approved = u256(0)
        self.escrow = u256(int(self.escrow)-amount)
        self._record('approved_refund',amount,str(self.claimant))
        _Recipient(self.claimant).emit_transfer(value=u256(amount))

    @gl.public.write
    def spend_without_approval(self, amount: int, recipient: str) -> None:
        target = Address(recipient)
        if gl.message.sender_address != self.executor or not 0 < amount <= int(self.escrow) or target == self.claimant or self.loss:
            raise gl.vm.UserError('Only one evidenced executor misrouting is permitted')
        if int(self.approved) != 0:
            raise gl.vm.UserError('Clear prior approved spending first')
        self.escrow = u256(int(self.escrow)-amount)
        record = self._record('unapproved_native_debit',amount,str(target))
        record['claimant_approval'] = False
        self.loss = json.dumps(record,sort_keys=True)
        _Recipient(target).emit_transfer(value=u256(amount))

    @gl.public.view
    def get_evidence(self) -> dict:
        return {'claimant':str(self.claimant),'executor':str(self.executor),
                'escrow_wei':str(self.escrow),'approved_wei':str(self.approved),
                'history':[json.loads(item) for item in self.history],
                'loss':json.loads(self.loss) if self.loss else None}
