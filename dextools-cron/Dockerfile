FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

ENV TZ="Etc/UTC"
ENV NODE_ENV="production"

COPY package*.json ./
RUN npm ci --only=production

COPY . .

USER node

CMD ["node", "index.js"]