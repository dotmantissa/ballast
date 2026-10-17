"""Publish only signed, controlled account evidence through the existing evidence branch."""
import json
import os
from pathlib import Path
import subprocess
import urllib.request

root = Path.cwd()
folder = root / '.ballast-private/account-tests'
state_path = folder / 'evidence.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {}
phase = os.environ.get('BALLAST_ACCOUNT_EVIDENCE_PHASE', 'history')
if phase not in ['history', 'incident']:
    raise SystemExit('Choose history or incident evidence')
files = sorted(Path('docs/live-cases/registered-account-20261017').glob('*-' + phase + '.json'))
if not files:
    raise SystemExit('No signed real evidence is ready')
files.append(Path('tests/integration/contracts/incident_vault.py'))
token = (root / '.git/ballast-push-token').read_text().strip()
request = urllib.request.Request('https://api.github.com/user', headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'ballast-account-qa'})
with urllib.request.urlopen(request, timeout=30) as response:
    assert json.load(response)['login'] == 'dotmantissa', 'Unexpected Git identity'
env = dict(os.environ, GIT_INDEX_FILE=str(root / '.git/ballast-account-evidence.index'), GIT_ASKPASS=str(root / '.git/ballast-askpass'), GIT_TERMINAL_PROMPT='0', GIT_AUTHOR_NAME='dotmantissa', GIT_AUTHOR_EMAIL='negativemantissa@gmail.com', GIT_COMMITTER_NAME='dotmantissa', GIT_COMMITTER_EMAIL='negativemantissa@gmail.com')
def git(*args, data=None):
    return subprocess.check_output(['git', *args], input=data, env=env).decode().strip()
parent = git('rev-parse', 'refs/heads/review-evidence')
git('read-tree', parent)
for path in files:
    document = path.read_bytes()
    if path.suffix == '.json':
        value = json.loads(document)
        assert set(value) == {'message', 'signature_encoding', 'signatures'}, 'Only signed attestations may be published'
        assert 'keys' not in value['message'] and 'encrypted_key' not in value['message']
    digest = git('hash-object', '-w', '--stdin', data=document)
    git('update-index', '--add', '--cacheinfo', '100644,' + digest + ',' + path.as_posix())
tree = git('write-tree')
commit = git('commit-tree', tree, '-p', parent, data=('Publish controlled registered account ' + phase + ' evidence\n').encode())
subprocess.run(['git', '-c', 'credential.helper=', 'push', 'origin', commit + ':refs/heads/review-evidence'], env=env, check=True)
git('update-ref', 'refs/heads/review-evidence', commit, parent)
for path in files:
    with urllib.request.urlopen('https://raw.githubusercontent.com/dotmantissa/ballast/' + commit + '/' + path.as_posix(), timeout=30) as response:
        assert response.read() == path.read_bytes(), 'Public bytes differ'
state[phase + 'Commit'] = commit
with state_path.open('w') as stream:
    json.dump(state, stream, indent=2)
    stream.write('\n')
state_path.chmod(0o600)
print('Verified public ' + phase + ' evidence at commit ' + commit)
