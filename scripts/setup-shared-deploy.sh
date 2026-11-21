#!/usr/bin/env bash
# Sets up the GitHub Actions config the "Deploy shared edition (Firebase Hosting)" workflow needs, from the
# terminal, so no browser has to stay open:
#
#   - six repo VARIABLES (SHARED_FIREBASE_*), read straight from the shared Firebase project's registered web
#     app with the Firebase CLI - nothing to copy by hand;
#   - one repo SECRET (SHARED_FIREBASE_SERVICE_ACCOUNT), read from the service-account JSON key file you point it at.
#
# Run it yourself (it uses YOUR `gh` and `firebase` logins; the key never goes anywhere except GitHub's secret store).
#
#   scripts/setup-shared-deploy.sh --dry-run                      # show what would be set, change nothing
#   scripts/setup-shared-deploy.sh --key ~/Downloads/key.json     # set the variables AND the secret
#   scripts/setup-shared-deploy.sh                                # variables only (add the key later)
#
# Options: --project <firebase project id> (default splitkhata-shared)   --repo <owner/name>
set -euo pipefail

REPO="Yash-Kothari/splitkhata"
PROJECT="splitkhata-shared"
KEY_FILE=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --key) KEY_FILE="${2:-}"; shift ;;
    --project) PROJECT="${2:-}"; shift ;;
    --repo) REPO="${2:-}"; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

die() { echo "error: $*" >&2; exit 1; }

# The admin app's project must never be the target: these values would point the shared build at it.
[ "$PROJECT" != "splitkhata-96cbd" ] || die "splitkhata-96cbd is the ADMIN project. The shared edition needs its own project."
for tool in gh firebase python3; do command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH"; done
gh auth status >/dev/null 2>&1 || die "gh is not logged in (run: gh auth login)"
firebase login:list 2>&1 | grep -q "Logged in as" || die "firebase is not logged in (run: firebase login)"

echo "Reading the web app config of Firebase project '$PROJECT'..."
APP_ID="$(firebase apps:list --project "$PROJECT" --json 2>/dev/null | python3 -c '
import sys, json
apps = [a for a in json.load(sys.stdin)["result"] if a.get("platform") == "WEB"]
print(apps[0]["appId"] if apps else "")')"
[ -n "$APP_ID" ] || die "no web app is registered in '$PROJECT' (Firebase console -> Project settings -> Your apps -> add a Web app)"

# Prints NAME<TAB>VALUE lines for the six variables.
VARS="$(firebase apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" --json 2>/dev/null | python3 -c '
import sys, json
c = json.load(sys.stdin)["result"]["sdkConfig"]
wanted = [
  ("SHARED_FIREBASE_API_KEY", "apiKey"),
  ("SHARED_FIREBASE_AUTH_DOMAIN", "authDomain"),
  ("SHARED_FIREBASE_PROJECT_ID", "projectId"),
  ("SHARED_FIREBASE_STORAGE_BUCKET", "storageBucket"),
  ("SHARED_FIREBASE_MESSAGING_SENDER_ID", "messagingSenderId"),
  ("SHARED_FIREBASE_APP_ID", "appId"),
]
for name, key in wanted:
    if not c.get(key):
        sys.exit("missing %s in the web app config" % key)
    print("%s\t%s" % (name, c[key]))')"
[ -n "$VARS" ] || die "could not read the web app config"
echo "$VARS" | grep -q "^SHARED_FIREBASE_PROJECT_ID	$PROJECT\$" || die "the config's project id does not match '$PROJECT'"

if [ -n "$KEY_FILE" ]; then
  [ -f "$KEY_FILE" ] || die "key file not found: $KEY_FILE"
  python3 - "$KEY_FILE" "$PROJECT" <<'PY' || exit 1
import sys, json
path, project = sys.argv[1], sys.argv[2]
try:
    k = json.load(open(path))
except Exception as e:
    sys.exit("error: %s is not valid JSON (%s)" % (path, e))
if k.get("type") != "service_account" or not k.get("private_key") or not k.get("client_email"):
    sys.exit("error: that file is not a service-account key (it needs type, client_email and private_key)")
if k.get("project_id") != project:
    sys.exit("error: that key belongs to project '%s', not '%s' - refusing to upload it" % (k.get("project_id"), project))
print("Key file OK: %s" % k["client_email"])
PY
fi

echo
echo "Repo:      $REPO"
echo "Project:   $PROJECT ($APP_ID)"
echo "Variables to set:"
echo "$VARS" | while IFS="$(printf '\t')" read -r name value; do
  case "$name" in
    SHARED_FIREBASE_API_KEY) shown="${value:0:6}...(hidden)" ;;
    *) shown="$value" ;;
  esac
  printf '  %-40s %s\n' "$name" "$shown"
done
if [ -n "$KEY_FILE" ]; then echo "Secret to set:"; echo "  SHARED_FIREBASE_SERVICE_ACCOUNT          (contents of $KEY_FILE)"; else echo "Secret: not set (pass --key <file> to set SHARED_FIREBASE_SERVICE_ACCOUNT)"; fi
echo

if [ "$DRY_RUN" = "1" ]; then echo "Dry run - nothing was changed."; exit 0; fi

read -r -p "Set these on $REPO? [y/N] " answer
case "$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 0 ;; esac

echo "$VARS" | while IFS="$(printf '\t')" read -r name value; do
  gh variable set "$name" --repo "$REPO" --body "$value" >/dev/null
  echo "  set variable $name"
done
if [ -n "$KEY_FILE" ]; then
  gh secret set SHARED_FIREBASE_SERVICE_ACCOUNT --repo "$REPO" < "$KEY_FILE" >/dev/null
  echo "  set secret   SHARED_FIREBASE_SERVICE_ACCOUNT"
fi

echo
echo "On GitHub now:"
# Names and dates only - `gh variable list` also prints values, which would undo the API key masking above.
gh variable list --repo "$REPO" | grep '^SHARED_' | cut -f1,3 | sed 's/^/  variable  /' || true
gh secret list --repo "$REPO" | grep '^SHARED_' | cut -f1,2 | sed 's/^/  secret    /' || true

if [ -n "$KEY_FILE" ]; then
  echo
  read -r -p "The key file is no longer needed. Delete $KEY_FILE now? [y/N] " del
  case "$del" in y|Y|yes|YES) rm -f "$KEY_FILE" && echo "Deleted." ;; *) echo "Kept. Delete it yourself when you are done: rm \"$KEY_FILE\"" ;; esac
fi
