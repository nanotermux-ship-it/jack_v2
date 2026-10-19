const fca = require('@dongdev/fca-unofficial');
const login = fca.login || fca.default || fca;
const fs = require('fs');
const path = require('path');
const express = require('express');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;

// ====== إعادة توجيه السجلات ======
const logFile = path.join(DATA_DIR, 'bot_console.log');
try { fs.writeFileSync(logFile, ''); } catch (e) {}

const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) { const msg = args.join(' '); logStream.write(`[${new Date().toISOString()}] ${msg}\n`); originalLog.apply(console, args); };
console.error = function(...args) { const msg = args.join(' '); logStream.write(`[${new Date().toISOString()}] ERROR: ${msg}\n`); originalError.apply(console, args); };

// ====== تسجيل الرسائل ======
const messagesLogFile = path.join(DATA_DIR, 'messages_log.json');
function logMessage(threadID, senderName, text, type = 'sent') {
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(messagesLogFile, 'utf8')); } catch (e) {}
    logs.unshift({ threadID: threadID, sender: senderName, text: text, type: type, time: new Date().toISOString() });
    logs = logs.slice(0, 100);
    fs.writeFileSync(messagesLogFile, JSON.stringify(logs, null, 2));
}

// ====== قراءة الإعدادات ======
const configFile = path.join(DATA_DIR, 'config.json');
let config;
try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch (err) { console.error('❌ خطأ: لم يتم العثور على config.json'); process.exit(1); }

let adminIds = config.adminIds || [];
if (adminIds.length === 0) { console.error('❌ خطأ: adminIds غير موجود في config.json'); process.exit(1); }
const ADMIN_ID = adminIds[0];

const APP_STATE_FILE = path.join(DATA_DIR, 'appstate.json');
const UPDATED_STATE_FILE = path.join(DATA_DIR, 'appstate_updated.json');
const GUARD_STATE_FILE = path.join(DATA_DIR, 'guard_state.json');
const PREFIX = '/';
let startTime = Date.now();
let isBotOnline = false;
let mqttReady = false; 

let isJackActive = false, jackInterval = null, silenceTimeout = null, jackText = "", jackThreadID = null;
let isNameLocked = false, lockedNameText = "", nameLockLoop = null, nameLockThreadID = null;
let isNickLocked = false, lockedNicknameText = "", nickInterval = null, nickLockThreadID = null;

let appState;
try {
  const stateFile = fs.existsSync(UPDATED_STATE_FILE) ? UPDATED_STATE_FILE : APP_STATE_FILE;
  if (!fs.existsSync(stateFile)) { console.error('❌ لا يوجد ملف جلسة. يرجى رفع الكوكيز من الموقع أولاً.'); process.exit(1); }
  appState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log(`🔑 تم تحميل الجلسة من: ${stateFile}`);
} catch (err) {
  console.error(`❌ خطأ في قراءة ملف الجلسة: ${err.message}`);
  process.exit(1);
}

const options = {
  appState, listenEvents: true, selfListen: false, updatePresence: true, online: true, autoMarkRead: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
};

const guard = require('./guard');
process.env.GUARD_STATE_FILE = GUARD_STATE_FILE;
guard.preLogin();

// ====== API للموقع ======
const apiApp = express();
apiApp.use(express.json({ limit: '10mb' }));
let dashboardCommand = null;
global.apiInstance = null;

apiApp.post('/send-command', (req, res) => { dashboardCommand = req.body.command; res.json({ success: true }); });

apiApp.get('/status', (req, res) => {
    try {
        const state = fs.existsSync(GUARD_STATE_FILE) ? JSON.parse(fs.readFileSync(GUARD_STATE_FILE, 'utf8')) : {};
        res.json({ 
            msgToday: state.msgToday || 0, 
            uptimeSec: Math.floor((Date.now() - startTime) / 1000), 
            isOnline: isBotOnline,
            mqttReady: mqttReady
        });
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

apiApp.get('/threads', (req, res) => {
    if (!global.apiInstance) return res.status(500).json({ error: 'Bot not ready' });
    global.apiInstance.getThreadList(50, null, ['INBOX'], (err, list) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        const groups = list.filter(t => t.isGroup && t.name).map(t => ({
            threadID: t.threadID, name: t.name, memberCount: t.participantIDs ? t.participantIDs.length : 0, image: t.imageSrc || null
        }));
        res.json(groups);
    });
});

apiApp.get('/thread-members/:id', (req, res) => {
    if (!global.apiInstance) return res.status(500).json({ error: 'Bot not ready' });
    global.apiInstance.getThreadInfo(req.params.id, (err, info) => {
        if (err || !info) return res.json([]);
        const members = info.participantIDs || [];
        const threadAdmins = info.adminIDs ? info.adminIDs.map(a => a.id) : [];
        global.apiInstance.getUserInfo(members, (err2, uInfo) => {
            if (err2) return res.json([]);
            const list = members.map(id => ({
                id: id, name: uInfo[id] ? uInfo[id].name : 'Unknown', profilePic: uInfo[id] ? uInfo[id].thumbSrc : null, isThreadAdmin: threadAdmins.includes(id)
            }));
            res.json(list);
        });
    });
});

apiApp.get('/user-profile/:id', (req, res) => {
    if (!global.apiInstance) return res.status(500).json({ error: 'Bot not ready' });
    const uid = req.params.id;
    global.apiInstance.getUserInfo([uid], (err, info) => {
        if (err || !info[uid]) return res.status(500).json({ error: 'User not found' });
        const user = info[uid];
        const userData = {
            id: user.userID, name: user.name, firstName: user.firstName || '-', lastName: user.lastName || '-',
            isFriend: user.isFriend, isVerified: user.isVerified,
            gender: user.gender === 1 ? 'أنثى' : (user.gender === 2 ? 'ذكر' : 'غير محدد'),
            profilePic: user.thumbSrc, profileUrl: user.profileUrl || `https://facebook.com/${uid}`, bio: user.bio || 'لا يوجد وصف'
        };
        res.json(userData);
    });
});

apiApp.get('/message-logs', (req, res) => {
    try { if (fs.existsSync(messagesLogFile)) res.json(JSON.parse(fs.readFileSync(messagesLogFile, 'utf8'))); else res.json([]); } catch (e) { res.json([]); }
});

apiApp.get('/users-count', (req, res) => {
    if (!global.apiInstance) return res.json({ count: 0 });
    global.apiInstance.getThreadList(50, null, ['INBOX'], (err, list) => {
        if (err) return res.json({ count: 0 });
        let userIds = new Set();
        list.forEach(t => { if (t.participantIDs) t.participantIDs.forEach(id => userIds.add(id)); });
        res.json({ count: userIds.size });
    });
});

apiApp.get('/admins', (req, res) => res.json(adminIds));
apiApp.post('/sync-admins', (req, res) => { adminIds = req.body.admins; res.json({ success: true }); });

apiApp.post('/update-cookies', (req, res) => {
    try {
        fs.writeFileSync(UPDATED_STATE_FILE, JSON.stringify(req.body.cookies, null, 2));
        res.json({ success: true });
        setTimeout(() => process.exit(0), 1000);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

apiApp.listen(3001, () => console.log(`🔗 [API] خادم التحكم يعمل على المنفذ 3001`));

console.log('[~] جاري تسجيل الدخول...');

login(options, (err, api) => {
  if (err) {
    console.error('❌ فشل تسجيل الدخول:', err.error || err);
    const errMsg = String(err.error || err);
    if (errMsg.includes('ENOTFOUND') || errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNREFUSED')) {
        console.log('⚠️ خطأ في الشبكة (DNS). سيتم إعادة المحاولة...');
        setTimeout(() => process.exit(1), 5000);
    } else {
        guard.loginFailed(err);
        process.exit(1);
    }
    return;
  }

  const BOT_ID = api.getCurrentUserID();
  global.apiInstance = api;
  isBotOnline = true;
  mqttReady = true;
  
  console.log(`✅ تم تسجيل الدخول كـ: ${BOT_ID}`);
  console.log(`👑 الأدمن المعتمد: ${ADMIN_ID}`);
  console.log(`✅ [BOT] البوت جاهز تماماً (MQTT Ready).`);

  guard.loginSucceeded();
  guard(api, { userAgent: options.userAgent, appStateFile: UPDATED_STATE_FILE, adminId: ADMIN_ID, mode: config.guardMode || 'safe' });

  console.log(`[~] بدء الاستماع...\n`);

  const safeSend = (msg, threadID) => new Promise(resolve => {
    logMessage(threadID, 'JACK V1 (Bot)', msg, 'sent');
    api.sendMessage(msg, threadID, (err) => { if (err) console.error('❌ إرسال:', err.error || err); resolve(); });
  });

  setInterval(() => {
      if (dashboardCommand) {
          const cmd = dashboardCommand; dashboardCommand = null;
          const event = { threadID: adminIds[0], senderID: adminIds[0], body: cmd, type: 'message' };
          const parts = cmd.slice(PREFIX.length).trim().split(/\s+/);
          handleCommand(event, parts.shift().toLowerCase(), parts);
      }
  }, 1000);

  const clearJackState = () => { isJackActive = false; if (jackInterval) clearTimeout(jackInterval); if (silenceTimeout) clearTimeout(silenceTimeout); };
  const stopNameLock = () => { isNameLocked = false; nameLockThreadID = null; if (nameLockLoop) clearInterval(nameLockLoop); };

  const startNameLockLoop = (threadID) => {
    nameLockThreadID = threadID;
    if (nameLockLoop) clearInterval(nameLockLoop);
    console.log(`[NM] بدء المراقبة الدورية لاسم المجموعة (كل 10 ثوانٍ).`);
    nameLockLoop = setInterval(() => {
      if (!isNameLocked) return;
      api.getThreadInfo(threadID, (err, info) => {
        if (err || !info) return;
        if (info.threadName !== lockedNameText) {
            console.log(`[NM] تجديد الاسم: من "${info.threadName}" إلى "${lockedNameText}".`);
            api.setTitle(lockedNameText, threadID, () => {});
        }
      });
    }, 10000);
  };

  const startNickLockLoop = (threadID) => {
    nickLockThreadID = threadID;
    if (nickInterval) clearInterval(nickInterval);
    const loop = async () => {
      if (!isNickLocked) return;
      api.getThreadInfo(threadID, (err, info) => {
        if (err || !info || !info.participantIDs) { if (isNickLocked) nickInterval = setTimeout(loop, 15000); return; }
        for (const uid of info.participantIDs) {
          if (!isNickLocked) break;
          const currentNick = info.nicknames ? info.nicknames[uid] : "";
          if (currentNick !== lockedNicknameText) {
            try { api.changeNickname(lockedNicknameText, threadID, uid, (err) => {}); } catch (e) {}
          }
        }
        const nextTime = Math.floor(Math.random() * (15000 - 10000 + 1) + 10000);
        if (isNickLocked) nickInterval = setTimeout(loop, nextTime);
      });
    };
    loop();
  };

  const stopJack = (reason = '') => {
    isJackActive = false;
    if (jackInterval) { clearTimeout(jackInterval); jackInterval = null; }
    if (silenceTimeout) { clearTimeout(silenceTimeout); silenceTimeout = null; }
    jackThreadID = null;
    if (reason) console.log(`[JACK] توقف: ${reason}`);
  };

  const resetSilenceTimer = () => {
    if (!isJackActive) return;
    if (silenceTimeout) clearTimeout(silenceTimeout);
    const tid = jackThreadID;
    silenceTimeout = setTimeout(async () => {
      if (!isJackActive) return;
      console.log('[JACK] 16 دقيقة صمت → 😂 + توقف');
      await safeSend("😂", tid);
      await safeSend("⏹️ توقف /jack — سكت الجميع 16 دقيقة.", tid);
      stopJack('16min silence');
    }, 16 * 60 * 1000);
  };

  const handleCommand = async (event, command, args) => {
    const threadID = event.threadID;
    if (!adminIds.includes(event.senderID)) return;

    if (command === 'info' || command === 'status') {
      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      const days = Math.floor(uptimeSec / 86400), hours = Math.floor((uptimeSec % 86400) / 3600), mins = Math.floor((uptimeSec % 3600) / 60), secs = uptimeSec % 60;
      let uptimeStr = "";
      if (days > 0) uptimeStr += `${days}d `;
      if (hours > 0) uptimeStr += `${hours}h `;
      uptimeStr += `${mins}m ${secs}s`;
      const pingMs = Math.floor(Math.random() * (500 - 200 + 1) + 200);
      const statusText = `╔════ JACK V1 — Status ════╗\n║ 🤖 Bot ID: ${BOT_ID}\n║ ⏱ Uptime: ${uptimeStr}\n║ 🏓 Ping: ${pingMs}ms\n║ 📦 Commands: 6\n║ 🛡 Protection: 23 طبقة نشطة\n║ 🔑 Prefix: /\n║ 👑 By: Alu Card\n╚══════════════════════════╝`;
      return safeSend(statusText, threadID);
    }

    if (command === 'help') {
      return safeSend(`╭───────────────────╮\n      🤖 𝗝𝗔𝗖𝗞 𝗩𝟭 𝗕𝗢𝗧 🤖      \n╰───────────────────╯\n\n『 ⚙️ الإدارة 』\n  ▸ /nm [الاسم] : قفل اسم المجموعة.\n  ▸ /nick [الاسم] : قفل كنيات الأعضاء.\n\n『 🛡️ الحماية 』\n  ▸ /jack [النص] : إرسال تلقائي كل ~90s حتى يسكت الجميع 16 دقيقة → 😂\n\n『 🛑 قاعدة الإيقاف 』\n  ▸ لإيقاف أي أمر، أضف كلمة off.\n  ▸ مثال: /nick off أو /jack off\n\n『 ℹ️ معلومات 』\n  ▸ /ping : اختبار سرعة البوت.\n  ▸ /info : عرض حالة البوت.\n  ▸ /uptime : مدة تشغيل البوت.`, threadID);
    }

    if (command === 'ping') {
      const startPing = Date.now();
      api.getThreadInfo(threadID, (err, info) => {
        if (err) return safeSend('⚠️ فشل قياس السرعة.', threadID);
        safeSend(`⚡ السرعة: ${Date.now() - startPing} ms`, threadID);
      });
      return;
    }

    if (command === 'uptime') {
      let up = Math.floor((Date.now() - startTime) / 1000);
      return safeSend(`⏱️ البوت يعمل منذ: ${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${up%60}s`, threadID);
    }

    if (command === 'nm' || command === 'lockname') {
      const fullArgs = args.join(' ').trim();
      if (!fullArgs) return safeSend('⚠️ الاستخدام: /nm (الاسم) أو /nm off', threadID);
      if (fullArgs.toLowerCase() === 'off') {
        if (isNameLocked) { stopNameLock(); await safeSend('🔓 تم إلغاء قفل الاسم.', threadID); }
        else await safeSend('⚠️ قفل الاسم غير مفعل أصلاً.', threadID);
        return;
      }
      if (isNameLocked) return safeSend('⚠️ قفل الاسم مفعل بالفعل!', threadID);
      const match = fullArgs.match(/\((.*?)\)/);
      const newName = match && match[1] ? match[1].trim() : fullArgs;
      if (!newName) return safeSend('⚠️ ضع الاسم بين قوسين.', threadID);
      isNameLocked = true; lockedNameText = newName;
      api.setTitle(lockedNameText, threadID, (err) => {
        if (err) { isNameLocked = false; return safeSend('❌ فشل تغيير الاسم (تأكد أن البوت أدمن).', threadID); }
      });
      await safeSend(`🔒 تم تفعيل قفل الاسم\n📝 الاسم: "${lockedNameText}"\n⏱ التغيير تدريجي عبر طابور حماية\n👁 مراقبة مستمرة لأي تغيير\n🛑 لإيقافها: /nm off`, threadID);
      startNameLockLoop(threadID);
      return;
    }

    if (command === 'nick' || command === 'كنيات') {
      const fullArgs = args.join(' ').trim();
      if (!fullArgs) return safeSend('⚠️ الاستخدام: /nick (الكنية) أو /nick off', threadID);
      if (fullArgs.toLowerCase() === 'off') {
        if (isNickLocked) {
          isNickLocked = false;
          if (nickInterval) { clearTimeout(nickInterval); nickInterval = null; }
          await safeSend('🛑 تم إيقاف قفل الكنيات.', threadID);
        } else { await safeSend('⚠️ قفل الكنيات غير مفعل أصلاً.', threadID); }
        return;
      }
      if (isNickLocked) return safeSend('⚠️ قفل الكنيات مفعل بالفعل! اكتب /nick off لإيقافه.', threadID);
      const match = fullArgs.match(/\((.*?)\)/);
      lockedNicknameText = match && match[1] ? match[1].trim() : fullArgs;
      if (!lockedNicknameText) return safeSend('⚠️ اكتب الكنية المطلوبة.', threadID);
      isNickLocked = true;
      await safeSend(`🔒 تم تفعيل قفل الكنيات\n📝 الاسم: "${lockedNicknameText}"\n⏱ التغيير تدريجي عبر طابور حماية\n👁 مراقبة مستمرة لأي تغيير\n🛑 لإيقافها: /nick off`, threadID);
      startNickLockLoop(threadID);
      return;
    }

    if (command === 'jack') {
      const fullArgs = args.join(' ').trim();
      if (!fullArgs) return safeSend('⚠️ الاستخدام: /jack (الرسالة) أو /jack off', threadID);

      if (fullArgs.toLowerCase() === 'off') {
        if (isJackActive) {
          const tid = jackThreadID;
          stopJack('manual off');
          await safeSend('⛔ تم إيقاف /jack يدوياً.', tid || threadID);
        } else {
          await safeSend('⚠️ /jack غير نشط حالياً.', threadID);
        }
        return;
      }

      if (isJackActive) return safeSend('⚠️ /jack يعمل بالفعل في مجموعة أخرى! اكتب /jack off أولاً.', threadID);

      const match = fullArgs.match(/\((.*?)\)/);
      const text = match && match[1] ? match[1].trim() : fullArgs;
      if (!text) return safeSend('⚠️ اكتب الرسالة المطلوبة.', threadID);

      await safeSend(
        `✅ تم تفعيل /jack\n` +
        `📝 النص: "${text}"\n` +
        `⏱ إرسال تلقائي كل ~90 ثانية (±20%)\n` +
        `👁 مراقبة مستمرة لأي تفاعل\n` +
        `⏸️ يتوقف إذا سكت الجميع 16 دقيقة → 😂\n` +
        `🛑 للإيقاف اليدوي: /jack off`,
        threadID
      );

      isJackActive = true;
      jackThreadID = threadID;
      jackText = text;

      const sendLoop = async () => {
        if (!isJackActive) return;
        await safeSend(jackText, threadID);
        const jitter = Math.floor(90000 * (0.8 + Math.random() * 0.4));
        if (isJackActive) jackInterval = setTimeout(sendLoop, jitter);
      };

      sendLoop();
      resetSilenceTimer();
      return;
    }
  };

  api.listenMqtt(async (err, event) => {
    if (err || !event) return;

    if (event.type === 'event') {
        if (event.logMessageType === 'log:thread-name' && isNameLocked && event.threadID === nameLockThreadID) {
            const newName = event.logMessageData?.name;
            if (newName && newName !== lockedNameText) {
                console.log(`⚡ [FAST] [NM] اسم المجموعة تغيّر من "${newName}" إلى "${lockedNameText}" → إعادة القفل فوراً.`);
                api.setTitle(lockedNameText, event.threadID, () => {});
            }
        }
        
        if (event.logMessageType === 'log:user-nickname' && isNickLocked && event.threadID === nickLockThreadID) {
            const targetUser = event.logMessageData?.participant_id || event.author;
            const newNick = event.logMessageData?.nickname;
            if (newNick !== lockedNicknameText && targetUser) {
                console.log(`⚡ [FAST] كنية العضو ${targetUser} تغيّرت → إعادة القفل فوراً.`);
                api.changeNickname(lockedNicknameText, event.threadID, targetUser, () => {});
            }
        }
    }

    if (event.type === 'message' && event.senderID !== BOT_ID && event.senderID !== ADMIN_ID) {
      if (isJackActive && event.threadID === jackThreadID) {
        resetSilenceTimer();
      }
    }

    if (event.type !== 'message' || !event.body || !event.body.startsWith(PREFIX)) return;
    if (!adminIds.includes(event.senderID)) return;
    const parts = event.body.slice(PREFIX.length).trim().split(/\s+/);
    const command = parts.shift().toLowerCase();
    const args = parts;
    console.log(`[CMD] /${command} | Args: ${JSON.stringify(args)}`);
    try { await handleCommand(event, command, args); } catch (e) { console.error('❌ خطأ في التنفيذ:', e); }
  });
});

process.on('exit', () => { isBotOnline = false; });
process.on('SIGINT', () => { isBotOnline = false; process.exit(0); });
