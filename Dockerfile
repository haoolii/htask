FROM node:24-bookworm-slim AS node
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends git util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global @opencode/cli@2.3.2 \
    && npm cache clean --force \
    && mkdir -p /workspace /artifacts \
    && chown vscode:vscode /workspace /artifacts

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm install --global @playwright/mcp@0.0.86 \
    && node "$(npm root -g)/@playwright/mcp/node_modules/playwright/cli.js" install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

COPY docker/opencode.json /home/vscode/.config/opencode/opencode.json
COPY docker/playwright.json /opt/htask/playwright.json
RUN chown -R vscode:vscode /home/vscode/.config
COPY lib/opencode.js lib/task-env.js lib/task-worker.js /opt/htask/
USER vscode
WORKDIR /workspace
ENTRYPOINT ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
