let currentUserRole = 'none';                                               let authToken = null;
let previousPage = 'home';                                                  let lastMessageCount = 0;

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    let bgColor, textColor, icon;
    if (type === 'success') { bgColor = 'bg-green-500/20'; textColor = 'text-green-400'; icon = '✅'; }
    else if (type === 'error') { bgColor = 'bg-red-500/20'; textColor = 'text-red-400'; icon = '❌'; }                                                      else { bgColor = 'bg-sky-500/20'; textColor = 'text-sky-400'; icon = 'ℹ️'; }
    toast.className = `${bgColor} border border-slate-700/50 ${textColor} p-4 rounded-xl shadow-2xl flex items-center gap-3 transform -translate-y-10 opacity-0 transition-all duration-300 pointer-events-auto backdrop-blur-md`;
    toast.innerHTML = `<span class="text-lg">${icon}</span><span class="font-bold text-sm">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove('-translate-y-10', 'opacity-0'); toast.classList.add('translate-y-0', 'opacity-100'); }, 10);
    setTimeout(() => { toast.classList.remove('translate-y-0', 'opacity-100'); toast.classList.add('-translate-y-10', 'opacity-0'); setTimeout(() => toast.remove(), 300); }, 3000);
}

window.onload = async function() {                                              const savedToken = localStorage.getItem('jack_token');
    if (savedToken) {
        const res = await fetch('/api/check-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: savedToken }) });
        const data = await res.json();
        if (data.success) { authToken = savedToken; currentUserRole = data.role; enterDashboard(); }
    }                                                                       };

async function login() {
    const pass = document.getElementById('password-input').value;
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    const data = await res.json();
    if (data.success) {
        authToken = data.token; currentUserRole = data.role;                        localStorage.setItem('jack_token', authToken);
        enterDashboard();                                                       } else { document.getElementById('login-error').classList.remove('hidden'); }
}

function enterDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').classList.remove('hidden');
    if (currentUserRole === 'admin') { document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block'); }
    else { document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none'); }
    generateSecurityList(); startApp();
}
                                                                            async function logout() { localStorage.removeItem('jack_token'); location.reload(); }

async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = {};                                 options.headers['Authorization'] = authToken;
    return fetch(url, options);
}

function switchPage(pageId) {
    const currentActive = document.querySelector('.page.active');
    if (currentActive && currentActive.id !== `page-${pageId}`) { previousPage = currentActive.id.replace('page-', ''); }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => { b.classList.remove('active', 'text-sky-400'); b.classList.add('text-gray-400'); });               document.getElementById(`page-${pageId}`).classList.add('active');
    if (pageId === 'groups') loadGroups();                                      if (pageId === 'admins') loadAdmins();
    if (pageId === 'tokens') checkTokenAccess();
    if (pageId === 'message-logs') loadMessageLogs();                       }

function goBack() { switchPage(previousPage); }

function checkTokenAccess() {
    if (currentUserRole !== 'admin') { document.getElementById('cookies-section').style.display = 'none'; document.getElementById('no-access-msg').style.display = 'block'; }                                                           else { document.getElementById('cookies-section').style.display = 'block'; document.getElementById('no-access-msg').style.display = 'none'; }
}

function generateSecurityList() {                                               const layers = ["Universal Guard", "Human Typing", "Natural Presence", "MQTT Health", "Session Refresher", "Keep Alive", "Rate Limiter", "Outgoing Throttle", "Anti-Detection", "Behavior Scheduler", "Human Read Receipt", "Scroll Simulator", "Reaction Delay", "Connection Jitter", "Duplicate Guard", "Anti-Flood", "Anti-Spam", "Typing Variator", "UA Rotator", "Login Guard", "Audit Log", "Persistent State", "Shutdown Safe"];                                 document.getElementById('security-list').innerHTML = layers.map((name, i) => `
        <div class="glass p-3 rounded-xl flex justify-between items-center border-r-4 border-r-green-500">
            <div><h4 class="font-bold text-xs">${i+1}. ${name}</h4></div>
            <span class="bg-green-500/20 text-green-400 px-2 py-1 rounded text-[10px]">نشط</span>
        </div>`).join('');
}                                                                           
function startApp() {
    updateStats();
    updateRecentMessages();                                                     setInterval(updateStats, 15000);
    setInterval(updateRecentMessages, 15000);
}
                                                                            async function updateStats() {
    try {
        const res = await apiFetch('/api/stats'); if (res.status === 401) return logout();
        const data = await res.json();                                      
        document.getElementById('stat-msgs').innerText = data.msgToday;
        document.getElementById('stat-uptime').innerText = `${Math.floor(data.uptimeSec/3600)}h ${Math.floor((data.uptimeSec%3600)/60)}m`;

        const st = document.getElementById('top-status');

        if (data.isOnline) {                                                            st.innerHTML = '<span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> متصل ويعمل';
            st.className = "text-xs text-green-400 flex items-center gap-1";
        } else if (data.uptimeSec > 0 && !data.mqttReady) {
            st.innerHTML = '<span class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span> جارٍ التهيئة...';
            st.className = "text-xs text-yellow-400 flex items-center gap-1";
        } else {
            st.innerHTML = '<span class="w-2 h-2 bg-red-500 rounded-full"></span> غير متصل';
            st.className = "text-xs text-red-400 flex items-center gap-1";
        }

        const resG = await apiFetch('/api/threads');
        const groups = await resG.json();
        document.getElementById('stat-groups').innerText = groups.length;   
        const resU = await apiFetch('/api/admins');
        const adminsList = await resU.json();
        document.getElementById('stat-users').innerText = adminsList.length;
    } catch(e) {}                                                           }

async function updateRecentMessages() {                                         try {
        const res = await apiFetch('/api/message-logs');                            if (res.status === 401) return logout();
        const data = await res.json();

        if (data && data.length !== lastMessageCount) {
            const box = document.getElementById('messages-box');
            if (!box) return;                                                           const shouldScroll = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
            box.innerHTML = data.slice(0, 10).map(m => {
                const time = new Date(m.time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                const isBot = m.type === 'sent';
                const safeText = m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `                                                                    <div class="bg-slate-800/80 p-2 rounded-lg border border-slate-700/50">
                    <div class="flex justify-between items-center text-[9px] mb-1">
                        <span class="${isBot ? 'text-sky-400' : 'text-green-400'} font-bold">${isBot ? '📤 البوت' : '📥 مستخدم'}</span>
                        <span class="text-gray-500 font-mono">${time}</span>
                    </div>
                    <p class="text-gray-200 text-xs">${safeText.length > 50 ? safeText.slice(0, 50) + '...' : safeText}</p>
                </div>`;
            }).join('');
            if (shouldScroll) box.scrollTop = box.scrollHeight;
            lastMessageCount = data.length;
        }
    } catch(e) {}
}

async function loadGroups() {
    const listEl = document.getElementById('groups-list');                      listEl.innerHTML = '<div class="text-center text-gray-500 py-10">جاري التحميل...</div>';
    try {
        const res = await apiFetch('/api/threads'); const groups = await res.json();
        if (groups.length === 0) { listEl.innerHTML = '<div class="text-center text-gray-500">لا توجد مجموعات.</div>'; return; }                                listEl.innerHTML = groups.map(g => {
            const safeName = g.name.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'");
            return `
            <div class="glass p-4 rounded-2xl flex items-center gap-4 border border-slate-700 cursor-pointer hover:bg-slate-800/80 transition-all" onclick="loadGroupMembers('${g.threadID}', '${safeName}')">
                <div class="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center text-xl overflow-hidden border border-slate-600 shadow-lg">
                    ${g.image ? `<img src="${g.image}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='👥'">` : '👥'}
                </div>
                <div class="flex-1 overflow-hidden"><h4 class="font-bold text-sm truncate">${safeName}</h4><p class="text-[10px] text-gray-400">${g.memberCount} أعضاء</p></div>
                <span class="text-sky-400">←</span>
            </div>`;
        }).join('');
    } catch(e) { listEl.innerHTML = '<div class="text-center text-red-500">فشل.</div>'; }                                                               }

async function loadGroupMembers(threadID, groupName) {
    switchPage('group-members');
    const listEl = document.getElementById('members-list');
    listEl.innerHTML = '<div class="text-center text-gray-500 py-10">جاري تحميل الأعضاء...</div>';
    try {
        const res = await apiFetch(`/api/thread-members/${threadID}`);
        const members = await res.json();
        if (members.length === 0) { listEl.innerHTML = '<div class="text-center text-gray-500">لا يوجد أعضاء.</div>'; return; }
        listEl.innerHTML = members.map(m => {
            const safeName = (m.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
            <div class="glass p-4 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-800/80 transition-all" onclick="openUserProfile('${m.id}')">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center overflow-hidden border border-slate-600">                                  ${m.profilePic ? `<img src="${m.profilePic}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.parentElement.innerHTML='👤'">` : '👤'}
                    </div>
                    <div><h4 class="font-bold text-sm">${safeName}</h4><p class="text-[10px] text-gray-400 font-mono">${m.id}</p></div>
                </div>
                ${m.isThreadAdmin ? '<span class="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-[10px]">👑 أدمن</span>' : ''}
            </div>`;
        }).join('');                                                            } catch(e) { listEl.innerHTML = '<div class="text-center text-red-500">فشل.</div>'; }
}

async function openUserProfile(uid) {
    switchPage('user-profile');
    const container = document.getElementById('user-profile-content');
    container.innerHTML = '<div class="text-center text-gray-500 py-10">جاري تحميل الملف الشخصي...</div>';
    try {
        const res = await apiFetch(`/api/user-profile/${uid}`);
        const user = await res.json();                                              if (user.error) { container.innerHTML = `<div class="text-center text-red-500 py-10">${user.error}</div>`; return; }
        const safeBio = (user.bio || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeName = (user.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');                                                                         container.innerHTML = `
            <div class="glass rounded-3xl overflow-hidden relative shadow-lg">
                <div class="h-32 bg-gradient-to-r from-sky-500 to-indigo-600"></div>
                <div class="px-6 pb-6 relative">
                    <div class="w-24 h-24 rounded-full border-4 border-slate-900 overflow-hidden -mt-12 bg-slate-800 shadow-xl">
                        ${user.profilePic ? `<img src="${user.profilePic}" class="w-full h-full object-cover">` : '👤'}
                    </div>
                    <div class="mt-4">
                        <h2 class="text-2xl font-black flex items-center gap-2">${safeName} ${user.isVerified ? '<span class="text-sky-400 text-sm">✔️</span>' : ''}</h2>                                                                                    <p class="text-sm text-gray-400 mt-1">${safeBio}</p>
                    </div>
                </div>
            </div>
            <div class="glass p-6 rounded-3xl space-y-4">
                <h3 class="font-bold text-lg border-b border-slate-700 pb-2">معلومات الحساب</h3>
                <div class="grid grid-cols-2 gap-4">
                    <div><p class="text-xs text-gray-400">الاسم الأول</p><p class="font-bold">${user.firstName}</p></div>
                    <div><p class="text-xs text-gray-400">اسم العائلة</p><p class="font-bold">${user.lastName}</p></div>
                    <div><p class="text-xs text-gray-400">الجنس</p><p class="font-bold">${user.gender}</p></div>
                    <div><p class="text-xs text-gray-400">صديق للبوت؟</p><p class="font-bold">${user.isFriend ? 'نعم' : 'لا'}</p></div>
                    <div class="col-span-2"><p class="text-xs text-gray-400">رابط الحساب</p><a href="${user.profileUrl}" target="_blank" class="font-bold text-sky-400 hover:underline break-all">${user.profileUrl}</a></div>
                </div>
            </div>`;
    } catch(e) { container.innerHTML = '<div class="text-center text-red-500 py-10">حدث خطأ أثناء تحميل الملف.</div>'; }
}
                                                                            async function loadMessageLogs() {                                              const listEl = document.getElementById('message-logs-list');
    listEl.innerHTML = '<div class="text-center text-gray-500 py-10">جاري التحميل...</div>';
    try {
        const res = await apiFetch('/api/message-logs');
        const logs = await res.json();
        if (logs.length === 0) { listEl.innerHTML = '<div class="text-center text-gray-500">لا توجد رسائل مسجلة بعد.</div>'; return; }                          listEl.innerHTML = logs.map(m => {                                              const date = new Date(m.time).toLocaleString('ar-EG');
            const safeText = m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
            <div class="glass p-4 rounded-xl space-y-2 border-r-4 ${m.type === 'sent' ? 'border-r-sky-500' : 'border-r-green-500'}">                                    <div class="flex justify-between items-center text-xs">                         <span class="font-bold text-sky-400">${m.type === 'sent' ? '📤 البوت' : '📥 مستخدم'}</span>                                                             <span class="text-gray-400 font-mono">${date}</span>                    </div>                                                                      <p class="text-sm text-gray-200 bg-slate-800 p-2 rounded-lg">${safeText}</p>
                <p class="text-[10px] text-gray-500 font-mono">Thread ID: ${m.threadID}</p>
            </div>`;
        }).join('');
    } catch(e) { listEl.innerHTML = '<div class="text-center text-red-500">حدث خطأ أثناء التحميل.</div>'; }
}

async function loadAdmins() {
    const listEl = document.getElementById('admins-list');
    try {
        const res = await apiFetch('/api/admins');
        const admins = await res.json();                                            listEl.innerHTML = admins.map(a => `
            <div class="glass p-4 rounded-xl flex justify-between items-center border-r-4 border-r-sky-500">
                <div><h4 class="font-bold text-sm text-sky-400">👑 Admin</h4><p class="text-[10px] text-gray-400 font-mono">${a}</p></div>
                ${currentUserRole === 'admin' ? `<button onclick="removeAdmin('${a}')" class="text-red-400 text-xs bg-red-400/10 px-2 py-1 rounded">حذف</button>` : ''}
            </div>`).join('');                                                  } catch(e) {}
}

async function addAdmin() {
    if (currentUserRole !== 'admin') return showToast('ليس لديك صلاحية!', 'error');
    const newId = document.getElementById('new-admin-id').value;
    if(!newId) return showToast('أدخل UID', 'error');
    let admins = await (await apiFetch('/api/admins')).json();
    if(!admins.includes(newId)) admins.push(newId);
    await apiFetch('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admins }) });                   document.getElementById('new-admin-id').value = ''; loadAdmins();
    showToast('تم إضافة الأدمن بنجاح', 'success');
}                                                                           
async function removeAdmin(id) {
    if (currentUserRole !== 'admin') return showToast('ليس لديك صلاحية!', 'error');
    let admins = await (await apiFetch('/api/admins')).json();
    admins = admins.filter(a => a !== id);
    await apiFetch('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admins }) });                   loadAdmins();
    showToast('تم حذف الأدمن', 'success');
}

async function uploadCookies() {                                                if (currentUserRole !== 'admin') return showToast('ليس لديك صلاحية!', 'error');
    const val = document.getElementById('cookies-input').value.trim();          if (!val) return showToast('الرجاء لصق الكوكيز أولاً', 'error');
    try {
        const parsed = JSON.parse(val);
        if (!Array.isArray(parsed)) return showToast('يجب أن تكون الكوكيز بصيغة مصفوفة JSON', 'error');
        const res = await apiFetch('/api/update-cookies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies: parsed }) });                                                                  const data = await res.json();
        if (data.success) { showToast('تم تحديث الكوكيز بنجاح! جاري إعادة التشغيل...', 'success'); setTimeout(() => location.reload(), 2000); }                 else { showToast(data.error || 'فشل التحديث. تأكد من صحة الكوكيز.', 'error'); }
    } catch(e) { showToast('صيغة غير صحيحة! يجب أن تكون الكوكيز بصيغة JSON Array.', 'error'); }
}

async function controlBot(action) {
    if (currentUserRole !== 'admin') return showToast('ليس لديك صلاحية!', 'error');                                                                         try {
        const res = await apiFetch(`/api/bot/${action}`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message || (data.success ? 'تم' : 'فشل'), data.success ? 'success' : 'error');
    } catch(e) { showToast('حدث خطأ في الاتصال بالخادم.', 'error'); }
}

async function changePassword() {
    if (currentUserRole !== 'admin') {
        return showToast('ليس لديك صلاحية!', 'error');
    }
                                                                                const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (!currentPassword || !newPassword) {
        return showToast('يرجى ملء جميع الحقول.', 'error');
    }

    if (newPassword.length < 6) {
        return showToast('كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل.', 'error');
    }

    if (newPassword !== confirmPassword) {
        return showToast('كلمة السر الجديدة وتأكيدها غير متطابقين.', 'error');
    }

    try {
        const res = await apiFetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();

        if (data.success) {
            showToast('✅ تم تغيير كلمة السر بنجاح!', 'success');
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
        } else {
            showToast(data.error || 'فشل تغيير كلمة السر.', 'error');
        }
    } catch (e) {
        showToast('حدث خطأ في الاتصال.', 'error');
    }
                          }
