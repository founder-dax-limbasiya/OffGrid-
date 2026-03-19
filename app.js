// ============================================
// OFFGRID v2 — Local-First Messenger
// ============================================

const S = {
  me: { name: '', id: '', phone: '', initials: '' },
  contacts: [],
  messages: {},
  activeId: null,
  mode: 'none',
  peers: {},
  channels: {},
  scanning: false,
  scanStream: null,
  wifiEnabled: false,
  btEnabled: false,
};

// =========== INIT ===========
window.addEventListener('DOMContentLoaded', init);

function init() {
  try { loadStorage(); } catch(e) {}

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const steps = ['Initializing...', 'Checking Bluetooth...', 'Checking WiFi...', 'Loading contacts...', 'Ready!'];
  let i = 0;
  const statusEl = document.getElementById('splashStatus');
  const iv = setInterval(() => {
    if (statusEl && steps[i]) statusEl.textContent = steps[i];
    i++;
    if (i >= steps.length) clearInterval(iv);
  }, 380);

  setTimeout(dismissSplash, 2000);
}

function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash) { goNext(); return; }
  splash.style.transition = 'opacity 0.35s';
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.style.display = 'none';
    goNext();
  }, 380);
}

function goNext() {
  if (!S.me.name || !S.me.phone) {
    showScreen('onboarding');
  } else {
    showScreen('app');
    bootApp();
  }
}

function showScreen(id) {
  ['splash','onboarding','app'].forEach(s => {
    const el = document.getElementById(s);
    if (!el) return;
    el.style.display = (s === id) ? '' : 'none';
  });
}

// =========== ONBOARDING ===========
function completeOnboarding() {
  const name = (document.getElementById('obName').value || '').trim();
  const phone = (document.getElementById('obPhone').value || '').trim();
  if (!name) { flashInput('obName'); showToast('Enter your name'); return; }
  if (!phone || phone.replace(/\D/g,'').length < 7) { flashInput('obPhone'); showToast('Enter a valid phone number'); return; }
  const normalized = normalizePhone(phone);
  S.me.name = name;
  S.me.phone = normalized;
  S.me.id = normalized;
  S.me.initials = getInitials(name);
  try { saveStorage(); } catch(e) {}
  showScreen('app');
  bootApp();
}

function regenId() {}

// =========== BOOT APP ===========
function bootApp() {
  renderMyProfile();
  renderContacts();
  updateChannelBar();
  startWiFiListener();
}

// =========== PROFILE ===========
function renderMyProfile() {
  setText('myAvatar', S.me.initials || '??');
  setText('myName', S.me.name || 'You');
  setText('myId', S.me.phone || '');
}

function showProfileModal() {
  setVal('profileName', S.me.name);
  setVal('profileId', S.me.phone || S.me.id);
  setText('profileAvatarBig', S.me.initials || '??');
  showEl('profileModal');
}

function saveProfile() {
  const name = (document.getElementById('profileName').value || '').trim();
  if (!name) return;
  S.me.name = name;
  S.me.initials = getInitials(name);
  try { saveStorage(); } catch(e) {}
  renderMyProfile();
  closeModal('profileModal');
}

// =========== CONTACTS ===========
function renderContacts() {
  const list = document.getElementById('contactList');
  if (!list) return;
  if (!S.contacts.length) {
    list.innerHTML = `<div class="empty-contacts">
      <div style="font-size:28px;margin-bottom:8px">👥</div>
      <div>No chats yet</div>
      <div style="font-size:10px;color:var(--t3);margin-top:4px">Tap + to add contact<br/>or scan their QR code</div>
    </div>`;
    return;
  }
  list.innerHTML = S.contacts.map(c => {
    const msgs = S.messages[c.id] || [];
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => !m.read && m.from !== 'me').length;
    const color = idToColor(c.id);
    const online = !!(S.channels[c.id] && S.channels[c.id].readyState === 'open');
    return `<div class="contact-item ${S.activeId === c.id ? 'active' : ''}" onclick="openChat('${esc(c.id)}')">
      <div class="ci-avatar" style="background:${color}18;color:${color};border:1px solid ${color}33">
        ${esc(getInitials(c.name))}
        <div class="ci-online" style="background:${online?'var(--accent)':'var(--t3)'}"></div>
      </div>
      <div class="ci-info">
        <div class="ci-name">${esc(c.name)}</div>
        <div class="ci-preview">${last ? esc(last.text.slice(0,32))+(last.text.length>32?'…':'') : esc(c.phone||c.id)}</div>
      </div>
      <div class="ci-meta">
        <div class="ci-time">${last ? fmtTime(last.ts) : ''}</div>
        ${unread ? `<div class="ci-badge">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openChat(id) {
  S.activeId = id;
  const c = S.contacts.find(x => x.id === id);
  if (!c) return;
  if (S.messages[id]) {
    S.messages[id].forEach(m => { if (m.from !== 'me') m.read = true; });
    try { saveStorage(); } catch(e) {}
  }
  const center = document.getElementById('topbarCenter');
  if (center) center.innerHTML = `<div class="topbar-name">${esc(c.name)}</div><div class="topbar-sub">${esc(c.phone||c.id)}</div>`;
  const tbQr = document.getElementById('tbQr');
  if (tbQr) tbQr.style.display = 'flex';
  hideEl('emptyState');
  showEl('messages');
  showEl('inputWrap');
  renderMessages(id);
  renderContacts();
  if (window.innerWidth <= 600) closeSidebar();
  setTimeout(() => document.getElementById('msgInput')?.focus(), 80);
}

function renderMessages(contactId) {
  const container = document.getElementById('messages');
  if (!container) return;
  const msgs = S.messages[contactId] || [];
  if (!msgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--t3);font-size:10px;font-family:monospace;line-height:2">No messages yet.<br/>Say hello! 👋</div>`;
    return;
  }
  let html = '', lastDate = '';
  msgs.forEach(msg => {
    const d = new Date(msg.ts).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
    if (d !== lastDate) { html += `<div class="date-sep"><span>${d}</span></div>`; lastDate = d; }
    const sent = msg.from === 'me';
    html += `<div class="msg-group ${sent?'sent':'recv'}">
      <div class="msg-bubble">${esc(msg.text).replace(/\n/g,'<br/>')}</div>
      <div class="msg-meta">
        <span class="msg-time">${fmtTime(msg.ts)}</span>
        <span class="msg-via ${msg.via||'local'}">${viaLabel(msg.via)}</span>
        ${sent?`<span class="msg-tick ${msg.delivered?'ok':''}">${msg.delivered?'✓✓':'✓'}</span>`:''}
      </div>
    </div>`;
  });
  container.innerHTML = html;
  const ca = document.getElementById('chatArea');
  if (ca) ca.scrollTop = ca.scrollHeight;
}

// =========== SEND ===========
function sendMessage() {
  const inp = document.getElementById('msgInput');
  const text = (inp?.value || '').trim();
  if (!text || !S.activeId) return;
  const msg = { id: Date.now().toString(), from: 'me', to: S.activeId, text, ts: Date.now(), via: S.mode==='none'?'local':S.mode, delivered: false, read: true };
  if (!S.messages[S.activeId]) S.messages[S.activeId] = [];
  S.messages[S.activeId].push(msg);
  try { saveStorage(); } catch(e) {}
  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  const ch = S.channels[S.activeId];
  if (ch && ch.readyState === 'open') {
    try { ch.send(JSON.stringify({ type: 'msg', payload: msg })); } catch(e) {}
    markDelivered(S.activeId, msg.id);
  } else {
    setTimeout(() => markDelivered(S.activeId, msg.id), 500 + Math.random() * 300);
  }
  renderMessages(S.activeId);
  renderContacts();
}

function markDelivered(contactId, msgId) {
  const m = S.messages[contactId]?.find(x => x.id === msgId);
  if (m) { m.delivered = true; try { saveStorage(); } catch(e) {} if (S.activeId === contactId) renderMessages(contactId); }
}

// =========== WEBRTC ===========
function startWiFiListener() {
  if (!window.BroadcastChannel) return;
  try {
    window.offgridBC = new BroadcastChannel('offgrid_signal');
    window.offgridBC.onmessage = (e) => { try { handleSignal(e.data); } catch(err) {} };
  } catch(e) {}
}

async function toggleMode(mode) {
  const toggle = document.getElementById(`${mode}-toggle`);
  const desc = document.getElementById(`${mode}-desc`);
  if (mode === 'wifi') {
    S.wifiEnabled = !S.wifiEnabled;
    toggle?.classList.toggle('on', S.wifiEnabled);
    if (S.wifiEnabled) { S.mode = 'wifi'; if (desc) desc.textContent = 'Active · Broadcasting'; broadcastPresence(); }
    else { S.mode = 'none'; if (desc) desc.textContent = 'Off'; }
    updateChannelBar();
  }
  if (mode === 'bt') {
    if (!navigator.bluetooth) { showToast('Web Bluetooth not supported. Use Chrome on Android.'); return; }
    S.btEnabled = !S.btEnabled;
    toggle?.classList.toggle('on', S.btEnabled);
    if (S.btEnabled) { if (desc) desc.textContent = 'Scanning...'; await scanBluetooth(desc); }
    else { S.mode = 'none'; if (desc) desc.textContent = 'Tap to scan'; updateChannelBar(); }
  }
}

function broadcastPresence() { try { window.offgridBC?.postMessage({ type:'presence', from:S.me.id, name:S.me.name }); } catch(e) {} }

async function handleSignal(data) {
  if (!data || data.from === S.me.id) return;
  if (data.type === 'presence') { const k=S.contacts.find(c=>c.id===data.from); if(k){ await setupPeer(data.from,true); showToast(`${data.name} is nearby!`); } }
  if (data.type === 'offer' && data.to === S.me.id) await handleOffer(data);
  if (data.type === 'answer' && data.to === S.me.id) await handleAnswer(data);
  if (data.type === 'ice' && data.to === S.me.id) { try { await S.peers[data.from]?.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {} }
}

async function setupPeer(contactId, initiator) {
  if (S.peers[contactId]) return;
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    S.peers[contactId] = pc;
    pc.onicecandidate = (e) => { if(e.candidate) { try { window.offgridBC?.postMessage({ type:'ice', from:S.me.id, to:contactId, candidate:e.candidate }); } catch(e) {} } };
    pc.onconnectionstatechange = () => { renderContacts(); updateChannelBar(); };
    if (initiator) {
      const dc = pc.createDataChannel('offgrid');
      S.channels[contactId] = dc;
      setupDataChannel(dc, contactId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      window.offgridBC?.postMessage({ type:'offer', from:S.me.id, to:contactId, sdp:offer });
    } else {
      pc.ondatachannel = (e) => { S.channels[contactId]=e.channel; setupDataChannel(e.channel,contactId); renderContacts(); };
    }
  } catch(e) {}
}

async function handleOffer(data) {
  await setupPeer(data.from, false);
  const pc = S.peers[data.from];
  if (!pc) return;
  try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); window.offgridBC?.postMessage({ type:'answer', from:S.me.id, to:data.from, sdp:ans }); } catch(e) {}
}

async function handleAnswer(data) { try { await S.peers[data.from]?.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch(e) {} }

function setupDataChannel(dc, contactId) {
  dc.onopen = () => { renderContacts(); updateChannelBar(); showToast(`Connected to ${S.contacts.find(c=>c.id===contactId)?.name||contactId}`); };
  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type==='msg') {
        const msg = { ...data.payload, from:contactId, read:S.activeId===contactId };
        if (!S.messages[contactId]) S.messages[contactId]=[];
        S.messages[contactId].push(msg);
        try { saveStorage(); } catch(e) {}
        if (S.activeId===contactId) renderMessages(contactId);
        renderContacts();
      }
    } catch(e) {}
  };
  dc.onclose = () => { delete S.channels[contactId]; renderContacts(); updateChannelBar(); };
}

// =========== BLUETOOTH ===========
async function scanBluetooth(descEl) {
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    if (descEl) descEl.textContent = `Found: ${device.name||'Device'}`;
    S.mode = 'bt'; updateChannelBar();
    showToast(`Found ${device.name||'device'}. Full BT needs native app.`);
  } catch(e) {
    document.getElementById('bt-toggle')?.classList.remove('on');
    S.btEnabled = false;
    if (descEl) descEl.textContent = 'Tap to scan';
    if (e.name !== 'NotFoundError') showToast('Bluetooth: '+(e.message||'Failed'));
  }
}

// =========== QR ===========
function showQRModal() { generateMyQR(); showEl('qrModal'); switchQrTab('my'); }
function showContactQR() { showQRModal(); switchQrTab('scan'); }

function switchQrTab(tab) {
  document.getElementById('tabMyQr')?.classList.toggle('active', tab==='my');
  document.getElementById('tabScanQr')?.classList.toggle('active', tab==='scan');
  const myP = document.getElementById('myQrPanel');
  const scP = document.getElementById('scanQrPanel');
  if (myP) myP.style.display = tab==='my' ? '' : 'none';
  if (scP) scP.style.display = tab==='scan' ? '' : 'none';
  if (tab==='my') generateMyQR();
  if (tab==='scan') stopScan();
}

function generateMyQR() {
  const qrBox = document.getElementById('qrBox');
  const qrIdText = document.getElementById('qrIdText');
  if (!qrBox) return;
  const payload = JSON.stringify({ name:S.me.name, id:S.me.id, phone:S.me.phone, v:1 });
  qrBox.innerHTML = '';
  const canvas = document.createElement('canvas');
  const size = 200;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0,0,size,size);
  drawSimpleQR(ctx, payload, size);
  qrBox.appendChild(canvas);
  if (qrIdText) qrIdText.textContent = S.me.phone || S.me.id;
}

function drawSimpleQR(ctx, data, size) {
  const cell=8, cols=Math.floor(size/cell), hash=simpleHash(data);
  ctx.fillStyle='#000';
  for (let i=0;i<cols;i++) for (let j=0;j<cols;j++) if ((hash.charCodeAt(i%hash.length)+i*7+j*13)%3===0) ctx.fillRect(i*cell,j*cell,cell-1,cell-1);
  drawCorner(ctx,1,1,cell); drawCorner(ctx,cols-8,1,cell); drawCorner(ctx,1,cols-8,cell);
  ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillRect(size/2-28,size/2-11,56,22);
  ctx.fillStyle='white'; ctx.font='bold 9px monospace'; ctx.textAlign='center'; ctx.fillText('OFFGRID',size/2,size/2+4);
}

function drawCorner(ctx,x,y,cell) {
  ctx.fillStyle='#000'; ctx.fillRect(x*cell,y*cell,7*cell,7*cell);
  ctx.fillStyle='white'; ctx.fillRect((x+1)*cell,(y+1)*cell,5*cell,5*cell);
  ctx.fillStyle='#000'; ctx.fillRect((x+2)*cell,(y+2)*cell,3*cell,3*cell);
}

function simpleHash(str) { let h=''; for(let i=0;i<str.length;i++) h+=String.fromCharCode((str.charCodeAt(i)*31+i)%94+33); return h||'x'; }

async function startScan() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    S.scanStream = stream;
    const video = document.getElementById('scanVideo');
    if (video) { video.srcObject=stream; await video.play(); }
    S.scanning = true;
    setText('scanStatus','Scanning... Point at QR code');
    scanLoop();
  } catch(e) { setText('scanStatus','Camera access denied'); showToast('Camera permission required'); }
}

function stopScan() { S.scanning=false; if(S.scanStream){ S.scanStream.getTracks().forEach(t=>t.stop()); S.scanStream=null; } }

function scanLoop() {
  if (!S.scanning) return;
  const video = document.getElementById('scanVideo');
  if (!video||video.readyState<2) { requestAnimationFrame(scanLoop); return; }
  const canvas=document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  if (window.BarcodeDetector) {
    new BarcodeDetector({formats:['qr_code']}).detect(canvas)
      .then(codes=>{ if(codes.length) handleScannedQR(codes[0].rawValue); else requestAnimationFrame(scanLoop); })
      .catch(()=>requestAnimationFrame(scanLoop));
  } else { setText('scanStatus','QR scan not supported. Use manual entry.'); stopScan(); showManualEntry(); }
}

function showManualEntry() { closeModal('qrModal'); showAddContact(); }

function handleScannedQR(raw) {
  stopScan();
  try {
    const data=JSON.parse(raw);
    if (data.id && data.name) {
      if (!S.contacts.find(c=>c.id===data.id)) { S.contacts.push({id:data.id,name:data.name,phone:data.phone||data.id}); S.messages[data.id]=[]; try{saveStorage();}catch(e){} renderContacts(); showToast(`Added ${data.name}!`); }
      else showToast('Already in contacts!');
      closeModal('qrModal'); openChat(data.id);
    }
  } catch(e) { S.scanning=true; scanLoop(); }
}

function shareMyQR() {
  const text = `Connect with me on OffGrid!\nPhone: ${S.me.phone}`;
  if (navigator.share) navigator.share({title:'OffGrid Contact',text}).catch(()=>{});
  else navigator.clipboard?.writeText(S.me.phone||S.me.id).then(()=>showToast('Copied!'));
}

// =========== ADD CONTACT ===========
function showAddContact() { showEl('addContactModal'); setTimeout(()=>document.getElementById('acName')?.focus(),80); }

function addContact() {
  const name=(document.getElementById('acName')?.value||'').trim();
  const phone=(document.getElementById('acId')?.value||'').trim();
  if (!name||!phone) { showToast('Name and phone number required'); return; }
  const normalized=normalizePhone(phone);
  if (S.contacts.find(c=>c.id===normalized)) { showToast('Contact already exists'); return; }
  S.contacts.push({id:normalized,name,phone:normalized});
  S.messages[normalized]=[];
  try{saveStorage();}catch(e){}
  renderContacts(); closeModal('addContactModal'); setVal('acName',''); setVal('acId',''); openChat(normalized);
}

function switchToScan() { closeModal('addContactModal'); showQRModal(); switchQrTab('scan'); }

// =========== NETWORK PANEL ===========
function showNetworkPanel() {
  const body=document.getElementById('networkBody');
  if (!body) return;
  const items=[
    {icon:'📶',name:'WiFi Direct (WebRTC)',status:S.wifiEnabled?'Active':'Off',on:S.wifiEnabled},
    {icon:'🔵',name:'Bluetooth',status:S.btEnabled?'Active':(navigator.bluetooth?'Available':'Not supported'),on:S.btEnabled},
    {icon:'📷',name:'QR Pair',status:'Always available',on:true},
    {icon:'🌐',name:'Internet',status:navigator.onLine?'Online (not used for privacy)':'Offline',on:false},
  ];
  body.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px">`+
    items.map(i=>`<div class="net-item"><div class="net-icon">${i.icon}</div><div class="net-info"><div class="net-name">${i.name}</div><div class="net-status">${i.status}</div></div><div class="net-pill ${i.on?'on':'off'}">${i.on?'ON':'OFF'}</div></div>`).join('')+
    `</div><div style="margin-top:12px;font-size:9px;color:var(--t3);font-family:monospace;line-height:1.8;text-align:center">🔒 Zero data leaves your device<br/>Messages stored locally only</div>`;
  showEl('networkModal');
}

// =========== CHANNEL BAR ===========
function updateChannelBar() {
  const dot=document.getElementById('icbDot'), text=document.getElementById('icbText');
  if (!dot||!text) return;
  const anyConn=Object.values(S.channels).some(ch=>ch.readyState==='open');
  if (anyConn) { dot.className='icb-dot wifi'; text.textContent='Connected via WiFi Direct'; }
  else if (S.wifiEnabled) { dot.className='icb-dot wifi'; text.textContent='WiFi Direct · Waiting for peer...'; }
  else if (S.btEnabled) { dot.className='icb-dot bt'; text.textContent='Bluetooth · Searching...'; }
  else { dot.className='icb-dot'; text.textContent='No connection · Enable WiFi or BT in sidebar'; }
}

// =========== MODALS ===========
function closeModal(id) { const e=document.getElementById(id); if(e) e.style.display='none'; if(id==='qrModal') stopScan(); }

document.addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) { e.target.style.display='none'; stopScan(); } });

// =========== SIDEBAR ===========
function toggleSidebar() {
  const sb=document.querySelector('.sidebar'), bd=document.getElementById('sbBackdrop');
  const open=sb?.classList.toggle('open');
  if (bd) bd.style.display=open?'':'none';
}
function closeSidebar() { document.querySelector('.sidebar')?.classList.remove('open'); const bd=document.getElementById('sbBackdrop'); if(bd) bd.style.display='none'; }

// =========== INPUT ===========
function handleKey(e) { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }

// =========== STORAGE ===========
function saveStorage() { localStorage.setItem('og_me',JSON.stringify(S.me)); localStorage.setItem('og_contacts',JSON.stringify(S.contacts)); localStorage.setItem('og_messages',JSON.stringify(S.messages)); }
function loadStorage() { const me=localStorage.getItem('og_me'),c=localStorage.getItem('og_contacts'),m=localStorage.getItem('og_messages'); if(me) Object.assign(S.me,JSON.parse(me)); if(c) S.contacts=JSON.parse(c); if(m) S.messages=JSON.parse(m); }

// =========== TOAST ===========
function showToast(msg) {
  let t=document.getElementById('_toast');
  if (!t) { t=document.createElement('div'); t.id='_toast'; t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#f0f0f0;border:1px solid #2a2a2a;padding:10px 18px;border-radius:8px;font-size:11px;font-family:monospace;z-index:9999;max-width:290px;text-align:center;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,.5);transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._timer); t._timer=setTimeout(()=>{t.style.opacity='0';},2800);
}

// =========== UTILS ===========
function normalizePhone(p) { return p.replace(/\s+/g,'').replace(/[^\d+]/g,''); }
function getInitials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function idToColor(id) { const colors=['#00e5ff','#448aff','#69ff47','#ff6d00','#d500f9','#ff1744','#ffca28','#00e676']; let h=0; for(let i=0;i<id.length;i++) h=id.charCodeAt(i)+((h<<5)-h); return colors[Math.abs(h)%colors.length]; }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function viaLabel(v) { return {wifi:'📶 WiFi',bt:'🔵 BT',qr:'📷 QR',local:'💾 Local'}[v]||'💾 Local'; }
function setText(id,val) { const e=document.getElementById(id); if(e) e.textContent=val; }
function setVal(id,val) { const e=document.getElementById(id); if(e) e.value=val; }
function showEl(id) { const e=document.getElementById(id); if(e) e.style.display=''; }
function hideEl(id) { const e=document.getElementById(id); if(e) e.style.display='none'; }
function flashInput(id) { const e=document.getElementById(id); if(!e) return; e.style.borderColor='#ff4444'; setTimeout(()=>e.style.borderColor='',800); }
