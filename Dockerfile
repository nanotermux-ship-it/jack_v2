FROM node:22-bookworm

# تثبيت أدوات البناء لـ sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# تثبيت حزم البوت
COPY package.json ./
RUN npm install

# تثبيت حزم الموقع
COPY dashboard/package.json ./dashboard/
RUN cd dashboard && npm install

# نسخ باقي الملفات
COPY . .

EXPOSE 3000
CMD ["node", "dashboard/app.js"]
