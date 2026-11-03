from pathlib import Path
import subprocess

for path in sorted(Path("contracts").rglob("*.py")):
    subprocess.run(["genvm-lint", "check", str(path)], check=True)
