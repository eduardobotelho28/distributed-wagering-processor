FROM oven/bun:1

WORKDIR /app

# DECISION: copy manifests before sources so the dependency layer is cached
# and only rebuilt when package.json or the lockfile change.
COPY package.json bun.lock* ./
RUN bun install

COPY . .
