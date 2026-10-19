const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(DATA_DIR, 'dashboard.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS admins (uid TEXT PRIMARY KEY)`);
    db.run(`CREATE TABLE IF NOT EXISTS users_log (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, login_time DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO settings (key, value) VALUES ('admin_pass', 'Admin@2026')");
            db.run("INSERT INTO settings (key, value) VALUES ('user_pass', 'User@2026')");
            console.log("✅ تم إنشاء قاعدة البيانات وإضافة الإعدادات الافتراضية.");
        }
    });

    db.get("SELECT COUNT(*) as count FROM admins", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO admins (uid) VALUES ('61595630636396')");
            console.log("✅ تم إضافة الأدمن الافتراضي.");
        }
    });
});

module.exports = db;
