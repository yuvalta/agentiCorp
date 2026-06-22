# Deploy — AgentiCorp CEO dashboard

Runs on the VPS at **`http://72.62.52.253/agenticorp`** (basic-auth protected).
Same box as the worldcup (`/`, :8000) and faceless (`/faceless`, :8011) apps.
AgentiCorp uses **port 8012** and mounts at **`/agenticorp`**. Dev flow: push to
GitHub → VPS pulls.

## VPS setup (one time)

```bash
ssh root@72.62.52.253

# 1. Node 20+ (the box is otherwise Python; install if `node -v` is missing/old)
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)

# 2. Get the code
cd /opt
git clone https://github.com/yuvalta/agentiCorp.git agenticorp
cd agenticorp
npm ci --omit=dev   # only @anthropic-ai/sdk

# 3. (optional) secrets for live agents — stub-only works without this
#    echo 'ANTHROPIC_API_KEY=sk-ant-...' > /opt/agenticorp/.env

# 4. Service (auto-restart, starts on boot) — serves on 127.0.0.1:8012
cp deploy/agenticorp.service /etc/systemd/system/agenticorp.service
systemctl daemon-reload
systemctl enable --now agenticorp
curl -s http://127.0.0.1:8012/agenticorp/healthz   # -> {"ok":true}

# 5. Basic-auth credentials
apt-get install -y apache2-utils
htpasswd -bc /etc/nginx/.htpasswd-agenticorp <USER> '<PASSWORD>'

# 6. Reverse proxy — INJECT the two location blocks from
#    deploy/nginx-agenticorp.snippet.conf into the EXISTING server block that
#    owns `server_name 72.62.52.253` (do NOT create a new server block).
ls -l /etc/nginx/sites-enabled/                       # find the active block
cp /etc/nginx/sites-available/<block> /etc/nginx/sites-available/<block>.bak.$(date +%Y%m%d)
#    ...paste the snippet inside that server { } ...
nginx -t && systemctl reload nginx
```

Open **http://72.62.52.253/agenticorp** → log in → Factory / Ideas / Permissions.

## Deploy an update

```bash
ssh root@72.62.52.253 'cd /opt/agenticorp && git pull && \
  npm ci --omit=dev && systemctl restart agenticorp'
```

## Run the factory engine (on demand)

The service only serves the dashboard. To advance the pipeline:

```bash
ssh root@72.62.52.253 'cd /opt/agenticorp && npm run research'   # surface an idea
# approve from the Ideas tab (fires the KICKOFF gate), then:
ssh root@72.62.52.253 'cd /opt/agenticorp && npm start'          # run to next gate
```

## Notes

- **Subpath-aware:** `BASE_PATH=/agenticorp` prefixes every link/fetch; nginx
  preserves the URI. Locally (no BASE_PATH) it still serves at `/`.
- **Golden Rule intact:** FINANCE + DEPLOY gates still require the approval CLI;
  only KICKOFF is greenlightable from the dashboard.
- `workspace/` (engine + idea state) is gitignored — runtime only.
- HTTP only (raw IP). Basic-auth password crosses the wire in plaintext; rotate
  it if it matters. Add a domain → Let's Encrypt for HTTPS later.
