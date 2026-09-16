FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.js accounts.js interactions.js .
EXPOSE 4011
CMD ["node", "server.js"]
