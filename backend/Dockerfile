FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache poppler-utils
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "src/index.js"]
