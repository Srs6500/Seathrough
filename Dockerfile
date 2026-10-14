# Railway image: Next.js + Playwright Chromium (local browser, not Browserless API).
# Vercel does not use this file — keep Browserless/Browserbase keys there instead.

FROM node:20-bookworm-slim

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# Same major as playwright-core in package.json; --with-deps pulls OS libraries.
RUN npx --yes playwright@1.63.0 install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV BROWSER_EXPERIENCE_PROVIDER=local
ENV BROWSER_LOCAL_HEADED=0

EXPOSE 3000
# Railway injects PORT; Next respects it.
CMD ["npm", "run", "start"]
