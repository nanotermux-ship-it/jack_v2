const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '.';
const STATE_FILE = path.join(DATA_DIR, 'guard_state.json');
const LOG_FILE = path.join(DATA_DIR, 'guard.log');
const STOP_FILE = 'STOP';

const PROFILES = {
  safe:   { extras: false, msgPerMin: 8,  adminPerMin: 6,  adminPerHour: 90,  msgPerDay: 2000, adminPerDay: 150, burstMax: 25, gaps: { msg: [2500, 5500], admin: [8000, 18000] } },
  normal: { extras: true,  msgPerMin: 18, adminPerMin: 10, adminPerHour: 240, msgPerDay: 2000, adminPerDay: 600, burstMax: 40, gaps: { msg: [1500, 3500], admin: [5000, 12000] } },
};

const CFG = {
  typing:    { perCharMs: [35, 95], minMs: 900, maxMs: 6000 },
  burstWindowMs: 10 * 60e3,
  cooldown:  [3 * 60e3, 6 * 60e3],
  longPause: { chance: 0.05, ms: [8000, 25000] },
  quietHours: null,
  dup:       { windowMs: 30e3 },
  spam:      { maxLen: 4000, sameTextMax: 8, sameTextWindowMs: 10 * 60e3 },
  read:      { delay: [2000, 9000] },
  react:     { delay: [300, 1200] },
  presence:  { every: [25 * 60e3, 50 * 60e3], offlineFor: [30e3, 120e3] },
  keepAlive: { every: [12 * 60e3, 20 * 60e3] },
  scroll:    { every: [40 * 60e3, 90 * 60e3] },
  session:   { every: [25 * 60e3, 35 * 60e3] },
  mqtt:      { silentRestartMs: 30 * 60e3, backoffBase: 5000, backoffMax: 60e3, jitter: [0, 3000] },
  breaker:   { streak: 5, halt: [10 * 60e3, 20 * 60e3] },
  login:     { maxAttempts: 3, windowMs: 30 * 60e3, haltMs: 30 * 60e3, failHaltMs: 6 * 3600e3 },
  infoCacheMs: 8000,
};

const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1) + a);
const rr = (r) => rnd(r[0], r[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

try { if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (e) {}
const log = (tag, ...a) => {
  const line = `${new Date().toISOString()} [${tag}] ${a.join(' ')}`;
  console.log('🛡️', line.slice(24));
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
};

let ST = { haltUntil: 0, haltReason: '', loginAttempts: [], day: '', msgToday: 0, adminToday: 0 };
try { Object.assign(ST, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}
let saveTimer = null;
const saveNow = () => {
  try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(ST)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) {}
};
const save = () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 500); };

const today = () => new Date().toLocaleDateString('en-CA');
const rollDay = () => { const d = today(); if (ST.day !== d) { ST.day = d; ST.msgToday = 0; ST.adminToday = 0; save(); } };
const msUntilMidnight = () => { const n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0); return m - n; };
const fmtMin = (ms) => `${Math.max(1, Math.round(ms / 60000))} د`;

function preLogin() {
  const now = Date.now();
  if (ST.haltUntil > now) {
    log('LOGIN', `الدخول موقوف ${fmtMin(ST.haltUntil - now)} بسبب: ${ST.haltReason || 'غير محدد'}.`);
    process.exit(1);
  }
  ST.loginAttempts = (ST.loginAttempts || []).filter((t) => now - t < CFG.login.windowMs);
  if (ST.loginAttempts.length >= CFG.login.maxAttempts) {
    ST.haltUntil = now + CFG.login.haltMs; ST.haltReason = 'محاولات دخول متكررة';
    saveNow();
    log('LOGIN', `${ST.loginAttempts.length} محاولات دخول خلال وقت قصير → توقف ${fmtMin(CFG.login.haltMs)}.`);
    process.exit(1);
  }
  ST.loginAttempts.push(now);
  saveNow();
}

function loginFailed(err) {
  const now = Date.now();
  const msg = String((err && (err.error || err.message)) || err || '');
  
  // 🚨 تجاهل أخطاء الشبكة (DNS/Timeout) وعدم إيقاف البوت
  if (msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED")) {
      log("LOGIN", `⚠️ خطأ شبكة (${msg.slice(0, 40)}). لن يتم إيقاف البوت.`);
      return;
  }

  const dur = CFG.login.failHaltMs;
  ST.haltUntil = now + dur;
  ST.haltReason = "فشل تسجيل الدخول: " + msg.slice(0, 80);
  saveNow();
  log("LOGIN", `فشل الدخول → لن يُعاد الدخول قبل ${fmtMin(dur)}.`);
}

function loginSucceeded() { ST.loginAttempts = []; saveNow(); }

function applyGuard(api, opts = {}) {
  const mode = PROFILES[opts.mode] ? opts.mode : 'safe';
  const P = PROFILES[mode];
  const state = { coolUntil: 0, errStreak: 0, lastEventAt: Date.now(), paused: false };
  const textOf = (m) => (typeof m === 'string' ? m : (m && m.body) || '');
  rollDay();

  process.on('uncaughtException', (e) => log('UNIVERSAL', 'uncaught:', e && e.message));
  process.on('unhandledRejection', (e) => log('UNIVERSAL', 'rejection:', e && e.message));

  const reportResult = (err) => {
    if (!err) { state.errStreak = 0; return; }
    state.errStreak++;
    if (state.errStreak >= CFG.breaker.streak) {
      ST.haltUntil = Date.now() + rr(CFG.breaker.halt); ST.haltReason = 'أخطاء متتالية'; state.errStreak = 0; saveNow();
      log('UNIVERSAL', `أخطاء متتالية → إيقاف مؤقت ${fmtMin(ST.haltUntil - Date.now())}`);
    }
  };

  try {
    const f = opts.uaFile || 'ua_pinned.json';
    const saved = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).userAgent : null;
    if (saved) {
      if (opts.userAgent && saved !== opts.userAgent) log('UA', 'الـUA في الكود يختلف عن المثبّت، سيُستعمل المثبّت.');
      api.setOptions && api.setOptions({ userAgent: saved });
    } else if (opts.userAgent) fs.writeFileSync(f, JSON.stringify({ userAgent: opts.userAgent, pinnedAt: new Date().toISOString() }));
  } catch (e) {}

  try {
    const o = { logLevel: 'error' };
    if (P.extras) o.autoMarkRead = false;
    api.setOptions && api.setOptions(o);
  } catch (e) {}

  const windows = { msg: [], admin: [], adminHour: [], burst: [], thread: {} };
  const waitFor = (arr, limit, win) => {
    const now = Date.now();
    while (arr.length && now - arr[0] > win) arr.shift();
    return arr.length >= limit ? arr[0] + win - now : 0;
  };
  const inQuiet = () => {
    const q = CFG.quietHours; if (!q) return false;
    const h = new Date().getHours();
    return q[0] <= q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1];
  };
  let lastQuotaLog = 0;

  async function gate(kind, threadID) {
    for (;;) {
      rollDay();
      const now = Date.now();
      if (state.paused || fs.existsSync(STOP_FILE)) { await sleep(30000); continue; }

      if (waitFor(windows.burst, P.burstMax, CFG.burstWindowMs) > 0) {
        state.coolUntil = now + rr(CFG.cooldown);
        windows.burst.length = 0;
        log('SCHEDULER', `ضغط عالٍ → استراحة ${fmtMin(state.coolUntil - now)}`);
      }
      let wait = Math.max(ST.haltUntil - now, state.coolUntil - now);
      wait = Math.max(wait, waitFor(windows[kind], kind === 'msg' ? P.msgPerMin : P.adminPerMin, 60e3));
      if (kind === 'admin') wait = Math.max(wait, waitFor(windows.adminHour, P.adminPerHour, 3600e3));

      const used = kind === 'msg' ? ST.msgToday : ST.adminToday;
      const cap = kind === 'msg' ? P.msgPerDay : P.adminPerDay;
      if (used >= cap) {
        wait = Math.max(wait, msUntilMidnight() + rnd(1000, 60000));
        if (now - lastQuotaLog > 3600e3) { lastQuotaLog = now; log('QUOTA', `بلغت الحصة اليومية (${kind}: ${used}/${cap}) → انتظار حتى منتصف الليل.`); }
      }

      if (wait <= 0) {
        windows[kind].push(now); windows.burst.push(now);
        if (kind === 'admin') { windows.adminHour.push(now); ST.adminToday++; } else ST.msgToday++;
        save();
        return;
      }
      await sleep(Math.min(wait, 10 * 60e3) + rnd(200, 1500));
    }
  }

  const callWithTimeout = (fn) => new Promise((res) => {
    const t = setTimeout(res, 30000);
    fn(() => { clearTimeout(t); res(); });
  });

  const makeQueue = (kind, maxLen = Infinity) => {
    const q = [], keys = new Set();
    let running = false, last = 0;
    const run = async () => {
      if (running) return;
      running = true;
      while (q.length) {
        let gap = rr(P.gaps[kind]) * (inQuiet() ? 3 : 1);
        if (Math.random() < CFG.longPause.chance) gap += rr(CFG.longPause.ms);
        const w = last + gap - Date.now();
        if (w > 0) await sleep(w);
        const job = q.shift();
        if (job.key) keys.delete(job.key);
        await gate(kind, job.threadID);
        try { await job.fn(); } catch (e) { log('QUEUE', e.message); }
        last = Date.now();
      }
      running = false;
    };
    return (fn, key, threadID) => {
      if (key && keys.has(key)) return;
      if (q.length >= maxLen) return;
      if (key) keys.add(key);
      q.push({ fn, key, threadID });
      run();
    };
  };
  const msgQueue = makeQueue('msg');
  const adminQueue = makeQueue('admin', 60);

  const recent = new Map();
  const checkOutgoing = (msg, threadID) => {
    const text = textOf(msg);
    if (typeof msg === 'string' && !msg.trim()) return 'رسالة فارغة';
    if (text.length <= 2) return null;
    const now = Date.now(), k = `${threadID}|${text}`;
    const arr = (recent.get(k) || []).filter((t) => now - t < CFG.spam.sameTextWindowMs);
    if (arr.length && now - arr[arr.length - 1] < CFG.dup.windowMs) return 'مكررة خلال وقت قصير';
    if (arr.length >= CFG.spam.sameTextMax) return 'تكرار مفرط لنفس النص';
    arr.push(now); recent.set(k, arr);
    return null;
  };

  // Human Typing
  let typingEnd = null;
  const safeTypingStart = (threadID) => {
    try {
      if (api.sendTypingIndicator) {
        const isGroup = threadID.toString().length >= 16;
        typingEnd = api.sendTypingIndicator(threadID, () => {}, isGroup);
      }
    } catch (e) {}
  };
  const safeTypingStop = () => {
    try { if (typingEnd) typingEnd(); typingEnd = null; } catch (e) {}
  };
  const humanTyping = async (threadID, msg) => {
    const text = textOf(msg);
    if (!text) return;
    const total = Math.min(CFG.typing.maxMs, Math.max(CFG.typing.minMs, text.length * rr(CFG.typing.perCharMs)));
    safeTypingStart(threadID);
    if (total > 2500 && Math.random() < 0.4) {
      const p1 = Math.floor(total * (0.4 + Math.random() * 0.2));
      await sleep(p1); safeTypingStop();
      await sleep(rnd(400, 1200)); safeTypingStart(threadID);
      await sleep(total - p1);
    } else {
      await sleep(total);
    }
    safeTypingStop();
  };

  const origSend = api.sendMessage.bind(api);
  api.sendMessage = (msg, threadID, cb, ...rest) => {
    if (typeof msg === 'string' && msg.length > CFG.spam.maxLen) msg = msg.slice(0, CFG.spam.maxLen);
    const verdict = checkOutgoing(msg, threadID);
    if (verdict) {
      log('GUARD', `تم تجاهل رسالة (${verdict})`);
      if (cb) setImmediate(() => cb(null, { suppressed: verdict }));
      return;
    }
    msgQueue(async () => {
      await humanTyping(threadID, msg);
      await callWithTimeout((done) => origSend(msg, threadID, (err, info) => {
        reportResult(err);
        cb && cb(err, info);
        done();
      }, ...rest));
    }, null, threadID);
  };

  const infoCache = new Map();
  const origInfo = api.getThreadInfo.bind(api);
  api.getThreadInfo = (threadID, cb) => {
    const c = infoCache.get(threadID);
    const halted = Date.now() < ST.haltUntil || state.paused;
    if (c && (halted || Date.now() - c.t < CFG.infoCacheMs)) return cb && cb(null, c.info);
    if (halted) return cb && cb(new Error('guard: halted'));
    origInfo(threadID, (err, info) => {
      if (!err && info) infoCache.set(threadID, { t: Date.now(), info });
      else reportResult(err);
      cb && cb(err, info);
    });
  };

  if (api.setTitle) {
    const orig = api.setTitle.bind(api);
    api.setTitle = (title, threadID, cb) => adminQueue(() => callWithTimeout((done) =>
      orig(title, threadID, (err, ...r) => { infoCache.delete(threadID); reportResult(err); cb && cb(err, ...r); done(); })
    ), `title:${threadID}`, threadID);
  }
  if (api.changeNickname) {
    const orig = api.changeNickname.bind(api);
    api.changeNickname = (nick, threadID, uid, cb) => adminQueue(() => callWithTimeout((done) =>
      orig(nick, threadID, uid, (err, ...r) => { infoCache.delete(threadID); reportResult(err); cb && cb(err, ...r); done(); })
    ), `nick:${threadID}:${uid}`, threadID);
  }

  const origSendDirect = origSend;
  const handleGuardCmd = (ev) => {
    const arg = String(ev.body || '').trim().split(/\s+/)[1] || 'status';
    const now = Date.now();
    const reply = (t) => { try { origSendDirect(t, ev.threadID, noop); } catch (e) {} };
    if (arg === 'off') { state.paused = true; log('KILL', 'تم الإيقاف يدوياً'); return reply('⏸️ تم إيقاف كل الإرسال.'); }
    if (arg === 'on') { state.paused = false; log('KILL', 'تم الاستئناف'); return reply('▶️ تم الاستئناف.'); }
    const halted = ST.haltUntil > now ? `موقوف ${fmtMin(ST.haltUntil - now)} (${ST.haltReason})` : 'لا';
    reply(
      `🛡️ Guard v3 — وضع: ${mode}\n` +
      `⏸️ إيقاف يدوي: ${state.paused ? 'نعم' : 'لا'}\n` +
      `🚫 إيقاف تلقائي: ${halted}\n` +
      `💬 رسائل اليوم: ${ST.msgToday}/${P.msgPerDay}\n` +
      `⚙️ عمليات إدارية اليوم: ${ST.adminToday}/${P.adminPerDay}\n` +
      `⚠️ أخطاء متتالية: ${state.errStreak}`
    );
  };

  const origListen = api.listenMqtt.bind(api);
  api.listenMqtt = (cb) => {
    let stop = null, fails = 0, restarting = false, chain = Promise.resolve();
    const readPending = new Set();

    const stopOld = () => {
      try {
        if (typeof stop === 'function') stop();
        else if (stop && typeof stop.stopListening === 'function') stop.stopListening();
      } catch (e) {}
    };
    const restart = (why) => {
      if (restarting) return;
      restarting = true;
      stopOld();
      if (why === 'صمت طويل') fails = 0;
      const d = Math.min(CFG.mqtt.backoffMax, CFG.mqtt.backoffBase * 2 ** fails++) + rr(CFG.mqtt.jitter);
      log('MQTT', `${why} → إعادة الاتصال بعد ${Math.round(d / 1000)}s`);
      setTimeout(start, d);
    };
    const start = () => {
      restarting = false;
      state.lastEventAt = Date.now();
      stop = origListen((err, ev) => {
        if (err) return restart('خطأ اتصال');
        fails = 0;
        state.lastEventAt = Date.now();

        if (ev && ev.type === 'message' && opts.adminId && ev.senderID === opts.adminId && /^\/guard(\s|$)/i.test(ev.body || '')) {
          return handleGuardCmd(ev);
        }

        if (P.extras && ev && ev.type === 'message' && ev.threadID && api.markAsRead && !readPending.has(ev.threadID)) {
          readPending.add(ev.threadID);
          setTimeout(() => {
            readPending.delete(ev.threadID);
            try { api.markAsRead(ev.threadID, true, noop); } catch (e) {}
          }, rr(CFG.read.delay));
        }

        chain = chain.then(() => sleep(rr(CFG.react.delay))).then(() => {
          try { Promise.resolve(cb(err, ev)).catch((e) => log('REACT', e.message)); } catch (e) { log('REACT', e.message); }
        });
      });
    };
    setInterval(() => {
      if (Date.now() - state.lastEventAt > CFG.mqtt.silentRestartMs) restart('صمت طويل');
    }, 5 * 60e3);
    setTimeout(start, rnd(1000, 4000));
  };

  const loop = (range, fn) => {
    const tick = () => setTimeout(async () => {
      try { if (Date.now() >= ST.haltUntil && !state.paused) await fn(); } catch (e) {}
      tick();
    }, rr(range));
    tick();
  };

  if (P.extras) {
    loop(CFG.keepAlive.every, () => api.getThreadList && api.getThreadList(1, null, ['INBOX'], (err) => reportResult(err)));
    loop(CFG.scroll.every, () => api.getThreadList && api.getThreadList(rnd(8, 15), null, ['INBOX'], noop));
    const presence = () => setTimeout(() => {
      try { api.setOptions({ online: false }); } catch (e) {}
      setTimeout(() => { try { api.setOptions({ online: true }); } catch (e) {} presence(); }, rr(CFG.presence.offlineFor));
    }, rr(CFG.presence.every));
    presence();
  }

  const stateFile = opts.appStateFile || 'appstate_updated.json';
  loop(CFG.session.every, () => {
    const s = api.getAppState();
    if (!Array.isArray(s) || !s.length) return;
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s, null, 2));
    fs.renameSync(stateFile + '.tmp', stateFile);
    log('SESSION', 'تم حفظ الجلسة.');
  });

  const onExit = () => {
    try { saveNow(); const s = api.getAppState(); if (Array.isArray(s) && s.length) { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(stateFile + '.tmp', stateFile); } } catch (e) {}
    process.exit(0);
  };
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  log('UNIVERSAL', `Guard v3 مفعّل — الوضع: ${mode} | 23 طبقة | رسائل اليوم ${ST.msgToday}/${P.msgPerDay}`);
  if (ST.haltUntil > Date.now()) log('UNIVERSAL', `تنبيه: إيقاف تلقائي ساري ${fmtMin(ST.haltUntil - Date.now())} (${ST.haltReason})`);
}

module.exports = applyGuard;
module.exports.preLogin = preLogin;
module.exports.loginFailed = loginFailed;
module.exports.loginSucceeded = loginSucceeded;
