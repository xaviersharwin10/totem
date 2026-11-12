#!/usr/bin/env bash
# Redeploy the hosted app (https://totem-zmwf.onrender.com).
# Render builds from a private mirror on Sharwin's GitHub (Render's GitHub app
# can't see Raksha001/totem), and auto-deploys on every push to its main.
#   scripts/deploy-web.sh            push this repo's main to the mirror
set -euo pipefail
MIRROR=${MIRROR:-https://github.com/xaviersharwin10/totem-deploy.git}
git push "$MIRROR" main:main
echo "pushed; Render rebuilds in ~2 min: https://dashboard.render.com/web/srv-dbqjtft6e07s73fecvsg"
