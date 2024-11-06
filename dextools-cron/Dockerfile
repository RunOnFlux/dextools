FROM node:16-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

ENV TZ="Etc/UTC"

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]