#!/bin/zsh
set -euo pipefail
umask 077
cd -- "${0:A:h}"

task_node=""
for task_candidate in "$HOME/.nvm/versions/node/v20.20.2/bin/node" /opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@20/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$task_candidate" ]] && [[ "$("$task_candidate" -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]]; then
    task_node="$task_candidate"
    break
  fi
done
if [[ -z "$task_node" ]]; then
  print -r -- "Node.js 20 or newer is required. Install a current LTS release from https://nodejs.org and run this launcher again."
  exit 1
fi
export PATH="${task_node:h}:$PATH"

print -r -- "Checking dashboard source and behavior…"
"$task_node" scripts/check.cjs
"$task_node" --test tests/*.test.cjs
print -r -- "Checking the rendered interface in the installed test browser…"
"$task_node" scripts/browser-qa.cjs

if [[ ! -f .tools/node_modules/@google/clasp/build/src/index.js ]]; then
  print -r -- "Installing clasp 3.4.1 into this project's .tools directory…"
  npm install --prefix .tools @google/clasp@3.4.1 --save-exact --ignore-scripts --cache .cache/npm --no-audit --no-fund
fi

task_auth_dir="$HOME/.config/entropy-results-dashboard"
mkdir -p -- "$task_auth_dir"
chmod 700 "$task_auth_dir"
export ENTROPY_AUTH_FILE="$task_auth_dir/.clasprc.json"
if [[ ! -f "$ENTROPY_AUTH_FILE" ]]; then
  print -r -- "Sign in with the Google account that can access the Figures folder."
  "$task_node" scripts/clasp.cjs login
fi
chmod 600 "$ENTROPY_AUTH_FILE"

print -r -- "Enable Google Apps Script API at https://script.google.com/home/usersettings if it is not already enabled."
if [[ "${1:-}" == "--sign-in-only" ]]; then
  print -r -- "clasp installed and Google sign-in saved. No cloud project has been created yet."
  exit 0
fi
exec "$task_node" scripts/deploy.cjs
