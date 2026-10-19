FROM node:22-trixie

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY dashboard/package.json ./dashboard/
RUN cd dashboard && npm install

COPY . .

EXPOSE 3000
CMD ["node", "dashboard/app.js"]
