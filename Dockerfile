FROM node:20-bookworm-slim

# تثبيت أدوات بناء sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# تثبيت حزم البوت (الجذر)
COPY package.json ./
RUN npm install

# تثبيت حزم الموقع (dashboard)
COPY dashboard/package.json ./dashboard/
RUN cd dashboard && npm install

# نسخ باقي الملفات
COPY . .

EXPOSE 3000
CMD ["node", "dashboard/app.js"]
