FROM node:20-alpine
WORKDIR /app
# poppler-utils: leer texto del PDF · qpdf: quitar la contraseña de los PDF de la DIAN
RUN apk add --no-cache poppler-utils qpdf
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p uploads
EXPOSE 3001
CMD ["node", "src/index.js"]
