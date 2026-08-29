# AgentiCorp nightly research job.
#
# The host runs Docker only (no node/npm/claude CLI), so the image carries the
# whole toolchain. Agents reach Claude through the `claude` CLI on the
# operator's subscription — never a pay-per-token API key.
FROM node:22-slim

# git: the CLI probes for it in some code paths. ca-certificates: TLS to the API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code \
 && claude --version

WORKDIR /app

# No runtime deps today (the Anthropic SDK was dropped when agents moved to the
# CLI), but copy manifests first so this layer caches if that changes.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY . .

# workspace/ is gitignored and holds ideas.json + TrendReport.md across runs;
# mount a volume here so ideas accumulate instead of resetting each night.
VOLUME ["/app/workspace"]

# research (Gatekeeper-guarded) then notify (unguarded, so the money-keyword
# payload scan cannot freeze the WhatsApp send).
CMD ["npm", "run", "nightly"]
