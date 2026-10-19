const fs = require('fs');
const path = require('path');

const inputFile = 'cookies.txt';    // اسم ملف الكوكيز الذي تصدره من المتصفح
const outputFile = 'appstate.json'; // الملف الذي سيقرأه البوت

console.log('⏳ جاري تحويل الكوكيز...');

try {
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ لم يتم العثور على الملف: ${inputFile}`);
    console.error(`تأكد من تصدير الكوكيز من المتصفح وتسميتها "${inputFile}" ووضعها في هذا المجلد.`);
    process.exit(1);
  }

  let rawData = fs.readFileSync(inputFile, 'utf8').trim();

  // إزالة أي علامات BOM مخفية في بداية الملف
  rawData = rawData.replace(/^\uFEFF/, '');

  let appState = [];

  // 1. التحقق مما إذا كان الملف بصيغة JSON (مثل إضافة Cookie-Editor)
  if (rawData.startsWith('[') || rawData.startsWith('{')) {
    const parsed = JSON.parse(rawData);
    const list = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
    
    appState = list.map(c => ({
      key: c.key || c.name, // دعم كلتا الصيغتين
      value: c.value,
      domain: c.domain || 'facebook.com',
      path: c.path || '/',
      hostOnly: c.hostOnly !== undefined ? c.hostOnly : false,
      creation: c.creation || new Date().toISOString(),
      lastAccessed: c.lastAccessed || new Date().toISOString()
    })).filter(c => c.key && c.value);
    
    console.log(`✅ تم اكتشاف صيغة JSON (إضافة Cookie-Editor).`);
  } 
  // 2. التحقق مما إذا كان الملف بصيغة Netscape (نص عادي من المتصفح)
  else if (rawData.includes('\t')) {
    const lines = rawData.split(/\r?\n/);
    for (const rawLine of lines) { const line = rawLine.replace(/^#HttpOnly_/, "");
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        appState.push({
          key: parts[5],
          value: parts[6],
          domain: parts[0].replace(/^\./, ''), // إزالة النقطة من البداية
          path: parts[2],
          hostOnly: false,
          creation: new Date().toISOString(),
          lastAccessed: new Date().toISOString()
        });
      }
    }
    console.log(`✅ تم اكتشاف صيغة Netscape (من المتصفح مباشرة).`);
  } 
  // 3. صيغة نصية عادية (Header String)
  else {
    const pairs = rawData.split(';');
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        appState.push({
          key: key.trim(),
          value: valueParts.join('=').trim(),
          domain: 'facebook.com',
          path: '/',
          hostOnly: false,
          creation: new Date().toISOString(),
          lastAccessed: new Date().toISOString()
        });
      }
    }
    console.log(`✅ تم اكتشاف صيغة نصية عادية (Header).`);
  }

  // التحقق من وجود الكوكيز المهمة
  const hasCUser = appState.some(c => c.key === 'c_user');
  const hasXs = appState.some(c => c.key === 'xs');

  if (!hasCUser || !hasXs) {
    console.warn('⚠️ تحذير: الكوكيز الأساسية مفقودة!');
    if (!hasCUser) console.warn('   ❌ لم يتم العثور على كوكي "c_user" (معرف الحساب).');
    if (!hasXs) console.warn('   ❌ لم يتم العثور على كوكي "xs" (الجلسة).');
    console.warn('   قد لا يعمل البوت بدون هذه الكوكيز. تأكد من أنك مسجل الدخول في المتصفح.');
  }

  // حفظ الملف
  fs.writeFileSync(outputFile, JSON.stringify(appState, null, 2), 'utf8');

  console.log('━━━━━━━━━━━━━━━━━━');
  console.log(`🎉 تم إنشاء "${outputFile}" بنجاح!`);
  console.log(`🔢 عدد الكوكيز المحولة: ${appState.length}`);
  console.log(`🆔 الحساب: ${appState.find(c => c.key === 'c_user')?.value || 'غير معروف'}`);
  console.log('━━━━━━━━━━━━━━━━━━');

} catch (error) {
  console.error('❌ حدث خطأ أثناء التحويل:', error.message);
}
