# Nightly research job — VPS runbook

Current deployment. Supersedes `DEPLOY.md`, which describes the retired
`72.62.52.253` box (systemd + `/opt` + nginx injection) and no longer applies.

## What runs

Every night at **04:00 UTC** (= 07:00 Israel in summer, 06:00 in winter — the
box is UTC and does not shift), cron runs a one-shot container:

```
0 4 * * * /usr/bin/docker run --rm --env-file /root/agenticorp/.env \
  -v agenticorp-workspace:/app/workspace agenticorp:local \
  >> /var/log/agenticorp-nightly.log 2>&1
```

The container runs `npm run nightly`, which is two steps:

1. `orchestrator/research.js` — one research idea, Gatekeeper-guarded.
2. `scripts/notify.js` — sends it to WhatsApp via WAHA.

They are **separate processes on purpose**. The research run installs the
Gatekeeper's global `fetch` guard, whose payload scan freezes outbound requests
containing money keywords (`charge`, `purchase`, `invoice_pay`, ...). An idea
about payments would otherwise silently freeze its own delivery.

## Host facts

- Host: `186.240.146.75` (`srv1877319`), **UTC**. Docker only — no node, npm, or
  `claude` on the host, which is why the toolchain lives in the image.
- Repo: `/root/agenticorp` (clone of `github.com/yuvalta/agentiCorp`, `main`).
- Image: `agenticorp:local` (~988MB; Node 22 + `@anthropic-ai/claude-code`).
- Volume: `agenticorp-workspace` → `/app/workspace`. Holds `ideas.json`,
  `TrendReport.md`, `spend.json`. `workspace/` is gitignored, so **the volume is
  the only copy** — ideas accumulate here across nights.
- Log: `/var/log/agenticorp-nightly.log` (append-only, no rotation configured
  yet — see Known gaps).

## Credentials — `/root/agenticorp/.env` (mode 600)

| Key | Source |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Dedicated token from `claude setup-token`, separate from Sally's |
| `WAHA_URL` / `WAHA_API_KEY` / `WAHA_SESSION` | Copied from `/root/sally/.env` — shared standalone WAHA at `:4000`, session `default` |
| `NOTIFY_TO` | Destination number, bare digits (WAHA chat id is `<number>@c.us`) |

Agents run on the **Claude subscription** via the `claude` CLI. Never set
`ANTHROPIC_API_KEY` — `lib/llm.js` warns and ignores it if present.

> The token must live in this `.env`, not in `~/.bashrc`. Cron does not source
> `.bashrc`, and the root `.bashrc` returns early for non-interactive shells
> anyway, so a token defined there reads as empty and every run fails.

## Operations

**Deploy a code change** (rebuild is required — cron uses the local image):

```sh
ssh root@186.240.146.75 'cd /root/agenticorp && git fetch -q origin \
  && git reset -q --hard origin/main && docker build -q -t agenticorp:local .'
```

**Run once now** (sends a real WhatsApp):

```sh
ssh root@186.240.146.75 'cd /root/agenticorp && docker run --rm --env-file .env \
  -v agenticorp-workspace:/app/workspace agenticorp:local'
```

**Read accumulated ideas:**

```sh
ssh root@186.240.146.75 'docker run --rm -v agenticorp-workspace:/w alpine \
  cat /w/ideas.json'
```

**Check last night's run:** `tail -50 /var/log/agenticorp-nightly.log`

## Known gaps

- **No log rotation.** The log grows unbounded; add logrotate if it matters.
- **No failure alert.** If a run fails, no message is sent and nothing tells
  you — the symptom is a morning with no WhatsApp. Consider a failure ping.
- **DST drift.** Delivery lands an hour earlier in Israeli winter.
- **Token expiry.** `setup-token` tokens are long-lived but finite; expiry
  surfaces as silent nightly failure.
