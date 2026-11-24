FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data/signatures && chmod -R 777 /app/data

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["node", "src/server.js"]
