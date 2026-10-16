"""Resumable maintainer exercise against actual Studio validators and public evidence."""
import json
import os
from pathlib import Path
import subprocess

state_path = Path(os.environ.get('BALLAST_DEPLOYMENT_FILE', 'deployments/review-integration.json'))
if not state_path.exists():
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.open('x') as stream:
        json.dump({'network': 'studionet', 'purpose': 'Isolated real reviewer lifecycle', 'transactions': {}}, stream, indent=2)
env = dict(os.environ, BALLAST_DEPLOYMENT_FILE=str(state_path))
def state():
    return json.loads(state_path.read_text())
def run(script, phase=None):
    active = dict(env)
    if phase:
        active['BALLAST_REVIEW_PHASE'] = phase
    command = ['python3', script] if script.endswith('.py') else ['node', '--env-file=.env.local', '--import', 'tsx', script]
    subprocess.run(command, env=active, check=True)
if not state().get('wired', {}).get('wire_pool'):
    run('scripts/deploy.ts')
if not state().get('sourceVerifiedAt'):
    run('scripts/verify-deployment.ts')
if not state().get('historyReady'):
    run('scripts/review-lifecycle.ts', 'history')
if not state().get('historyCommit'):
    run('scripts/publish-review-evidence.py', 'history')
if not state().get('incidentReady'):
    run('scripts/review-lifecycle.ts', 'incident')
if not state().get('incidentCommit'):
    run('scripts/publish-review-evidence.py', 'incident')
if state().get('result') != 'passed' or not Path('docs/review-integration-result.json').exists():
    run('scripts/review-lifecycle.ts', 'claim')
print('Actual Studio lifecycle and public verification evidence complete.')
