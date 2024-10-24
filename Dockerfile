# Start from the minimal Node.js image
FROM node:16-alpine

WORKDIR /usr/src/app
COPY package.json package-lock.json .env main.js LICENSE ./
RUN npm install --only=production
EXPOSE 8080
CMD [ "node", "main" ]
