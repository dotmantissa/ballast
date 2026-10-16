"""Publish only controlled live evidence to its own branch, without switching the worktree."""
import json
import os
from pathlib import Path
import subprocess

state_path = Path(os.environ.get('BALLAST_DEPLOYMENT_FILE', 'deployments/review-integration.json'))
state = json.loads(state_path.read_text())
phase = os.environ.get('BALLAST_REVIEW_PHASE', 'history')
if phase not in ['history', 'incident']:
    raise SystemExit('Publish history or incident only')
case_dir = Path('docs/live-cases') / state['caseId']
files = [case_dir / 'history.json', case_dir / 'peer.json']
if phase == 'incident':
    files.append(case_dir / 'incident.json')
files.append(Path('tests/integration/contracts/incident_vault.py'))
root = Path.cwd()
env = dict(os.environ, GIT_INDEX_FILE=str(root / '.git/ballast-evidence.index'),
           GIT_ASKPASS=str(root / '.git/ballast-askpass'), GIT_TERMINAL_PROMPT='0')
def git(*args, data=None):
    return subprocess.check_output(['git', *args], input=data, env=env).decode().strip()
try:
    parent = git('rev-parse', '--verify', 'refs/heads/review-evidence')
except subprocess.CalledProcessError:
    parent = ''
git('read-tree', parent if parent else '--empty')
for path in files:
    content = path.read_bytes()
    digest = git('hash-object', '-w', '--stdin', data=content)
    git('update-index', '--add', '--cacheinfo', '100644,' + digest + ',' + path.as_posix())
tree = git('write-tree')
args = ['commit-tree', tree]
if parent:
    args += ['-p', parent]
commit = git(*args, data=('Publish actual Studio '+phase+' evidence for '+state['caseId']+'\n').encode())
git('update-ref', 'refs/heads/review-evidence', commit)
subprocess.run(['git', '-c', 'credential.helper=', 'push', 'origin', commit+':refs/heads/review-evidence'], env=env, check=True)
state[phase+'Commit'] = commit
temporary = state_path.with_suffix('.tmp')
temporary.write_text(json.dumps(state, indent=2)+'\n')
temporary.replace(state_path)
print('Published immutable '+phase+' evidence commit '+commit)
