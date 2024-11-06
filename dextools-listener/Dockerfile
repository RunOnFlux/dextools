FROM node:16-alpine

WORKDIR /app

# Timezone setup for Alpine
RUN apk add --no-cache tzdata

ENV TZ="Etc/UTC"
ENV NODE_ENV="production"

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
