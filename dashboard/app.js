const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('./database');
const { spawn } = require('child_process');                                 
const app = express();
const PORT = process.env.PORT || 3000;                                      const BOT_API = 'http://localhost:3001';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');                     const LOG_FILE = path.join(DATA_DIR, 'bot_console.log');
const BOT_SCRIPT = path.join(__dirname, '..', 'bot.js');
const BOT_DIR = path.join(__dirname, '..');

// 🚨 إنشاء config.json تلقائياً إذا لم يكن موجوداً
if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig = {                                                         adminIds: ["61595387315770", "61563715906070"],
        appStateFile: "appstate.json",
        botName: "JACK V1",                                                         guardMode: "safe",
        panelAdminPassword: "Admin@2026",
        panelUserPassword: "User@2025"
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    console.log(`📝 تم إنشاء config.json افتراضي في: ${CONFIG_FILE}`);
}
                                                                            let botProcess = null;

function startBotProcess() {
    if (botProcess) return console.log("البوت يعمل بالفعل.");
    const guardStateFile = path.join(DATA_DIR, 'guard_state.json');             if (fs.existsSync(guardStateFile)) {
        try { fs.unlinkSync(guardStateFile); console.log("🧹 تم مسح سجل الحماية القديم."); } catch(e) {}
    }
    botProcess = spawn(process.execPath, [BOT_SCRIPT], { stdio: 'inherit', cwd: BOT_DIR });                                                                 console.log(`🚀 تم تشغيل البوت.`);
    botProcess.on('exit', () => { botProcess = null; console.log("🛑 توقف البوت."); });
}                                                                           
function stopBotProcess() {
    if (!botProcess) return console.log("البوت غير نشط.");                      try { botProcess.kill('SIGKILL'); console.log(`💀 تم إيقاف البوت بالقوة.`); } catch (e) {}
    botProcess = null;
}

function readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch (e) { return {}; }
}                                                                           function writeConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}                                                                           
startBotProcess();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));                                         
app.post('/api/check-token', (req, res) => {
    const { token } = req.body;
    if (token === 'admin_secret_token_123') return res.json({ success: true, role: 'admin' });
    if (token === 'user_secret_token_123') return res.json({ success: true, role: 'user' });                                                                res.json({ success: false });
});

// ✅ تسجيل الدخول: يقرأ كلمة السر من config.json
app.post('/api/login', (req, res) => {                                          const { password } = req.body;
    const cfg = readConfig();
    const adminPass = cfg.panelAdminPassword;
    const userPass = cfg.panelUserPassword;

    if (!adminPass) {                                                               return res.json({ success: false, error: 'panelAdminPassword غير موجود في config.json' });
    }

    if (password === adminPass) {
        db.run("INSERT INTO users_log (role) VALUES ('admin')");
        res.json({ success: true, role: 'admin', token: 'admin_secret_token_123' });
    } else if (password === userPass) {                                             db.run("INSERT INTO users_log (role) VALUES ('user')");
        res.json({ success: true, role: 'user', token: 'user_secret_token_123' });
    } else {
        res.json({ success: false });
    }
});
                                                                            const requireAuth = (req, res, next) => {                                       const token = req.headers['authorization'];
    if (token === 'admin_secret_token_123' || token === 'user_secret_token_123') {
        req.role = token === 'admin_secret_token_123' ? 'admin' : 'user';
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }                                                                       };
const requireAdmin = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === 'admin_secret_token_123') next();                             else res.status(403).json({ error: 'Forbidden' });
};

// ✅ endpoint تغيير كلمة السر (يقرأ ويكتب config.json)
app.post('/api/change-password', requireAdmin, (req, res) => {
    const { currentPassword, newPassword } = req.body;                      
    if (!currentPassword || !newPassword) {
        return res.json({ success: false, error: 'كلمة السر الحالية والجديدة مطلوبتان.' });
    }
    if (newPassword.length < 6) {
        return res.json({ success: false, error: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل.' });
    }

    try {                                                                           const cfg = readConfig();
        if (currentPassword !== cfg.panelAdminPassword) {                               return res.json({ success: false, error: 'كلمة السر الحالية غير صحيحة.' });
        }                                                                   
        cfg.panelAdminPassword = newPassword;
        writeConfig(cfg);
        console.log('✅ تم تحديث panelAdminPassword في config.json');
        res.json({ success: true, message: 'تم تغيير كلمة السر بنجاح (config.json).' });
    } catch (err) {                                                                 console.error('❌ خطأ في تغيير كلمة السر:', err);
        res.json({ success: false, error: 'حدث خطأ في الخادم.' });
    }
});

// ✅ الإحصائيات: فحص البوت عبر HTTP
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const r = await axios.get(`${BOT_API}/status`, { timeout: 3000 });
        res.json({
            msgToday: r.data.msgToday || 0,
            uptimeSec: r.data.uptimeSec || 0,
            isOnline: r.data.isOnline === true && r.data.mqttReady === true,
            mqttReady: r.data.mqttReady || false
        });
    } catch (err) {
        res.json({ msgToday: 0, uptimeSec: 0, isOnline: false, mqttReady: false });
    }
});

app.get('/api/threads', requireAuth, async (req, res) => {
    try { const r = await axios.get(`${BOT_API}/threads`, { timeout: 5000 }); res.json(r.data); } catch (err) { res.json([]); }
});

app.get('/api/thread-members/:id', requireAuth, async (req, res) => {
    try { const r = await axios.get(`${BOT_API}/thread-members/${req.params.id}`, { timeout: 5000 }); res.json(r.data); } catch (err) { res.json([]); }
});

app.get('/api/user-profile/:id', requireAuth, async (req, res) => {
    try { const r = await axios.get(`${BOT_API}/user-profile/${req.params.id}`, { timeout: 5000 }); res.json(r.data); } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
                                                                            app.get('/api/message-logs', requireAuth, async (req, res) => {
    try { const r = await axios.get(`${BOT_API}/message-logs`, { timeout: 5000 }); res.json(r.data); } catch (err) { res.json([]); }
});                                                                                                                                                     // ✅ قراءة الأدمنز من config.json (لضمان التطابق)
app.get('/api/admins', requireAuth, (req, res) => {                             const cfg = readConfig();                                                   res.json(cfg.adminIds || []);
});

// ✅ حفظ الأدمنز في config.json و database و sync مع البوت
app.post('/api/admins', requireAdmin, (req, res) => {
    const { admins } = req.body;
                                                                                try {
        const cfg = readConfig();                                                   cfg.adminIds = admins;
        writeConfig(cfg);
        console.log('✅ تم حفظ الأدمنز في config.json');
    } catch(e) {
        console.error('خطأ في حفظ config.json:', e);
    }

    db.run("DELETE FROM admins", () => {
        const stmt = db.prepare("INSERT INTO admins (uid) VALUES (?)");             admins.forEach(uid => stmt.run(uid));                                       stmt.finalize();
        try { axios.post(`${BOT_API}/sync-admins`, { admins }).catch(()=>{}); } catch(e){}
        res.json({ success: true });                                            });
});

app.get('/api/logs', requireAuth, (req, res) => {
    try { if (fs.existsSync(LOG_FILE)) res.json({ logs: fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-30) }); else res.json({ logs: [] }); } catch (err) { res.json({ logs: [] }); }
});

app.post('/api/update-cookies', requireAdmin, async (req, res) => {
    try { await axios.post(`${BOT_API}/update-cookies`, { cookies: req.body.cookies }); res.json({ success: true }); } catch (err) { res.json({ success: false }); }
});

app.post('/api/bot/start', requireAdmin, (req, res) => {
    if (botProcess) return res.json({ success: false, message: 'البوت يعمل بالفعل.' });
    startBotProcess();                                                          res.json({ success: true, message: 'جاري تشغيل البوت...' });
});                                                                         
app.post('/api/bot/stop', requireAdmin, (req, res) => {
    if (!botProcess) return res.json({ success: false, message: 'البوت غير نشط.' });
    stopBotProcess();
    res.json({ success: true, message: 'تم إيقاف البوت.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🌐 لوحة التحكم تعمل على المنفذ: ${PORT}`));
