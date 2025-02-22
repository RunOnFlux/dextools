FROM node:20-slim

WORKDIR /app

ENV TZ="Etc/UTC"
ENV NODE_ENV="production"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

USER node

CMD ["node", "index.js"]