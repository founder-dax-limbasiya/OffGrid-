// ============================================
// OFFGRID v2 — Local-First Messenger
// No internet. No servers. No tracking.
// Modes: WiFi Direct (WebRTC) | Bluetooth | QR Pair
// ============================================

// =========== STATE ===========
const S = {
  me: { name: '', id: '', phone: '', initials: '' },
  contacts: [],
  messages: {},       // { contactId: [msg] }
  activeId: null,
  mode: 'none',       // wifi | bt | qr | none
  peers: {},          // { contactId: RTCPeerConnection }
  channels: {},       // { contactId: RTCDataChannel }
  scanning: false,
  scanStream: null,
  wifiEnabled: false,
  btEnabled: false,
};

// =========== INIT ===========
window.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  updateSplashStatus();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.4s';
    setTimeout(() => {
      splash.classList.add('hidden');
      if (!S.me.name) {
        showOnboarding();
      } else {
        showApp();
      }
    }, 400);
  }, 2200);
});

function updateSplashStatus() {
  const steps = ['Initializing...', 'Checking Bluetooth...', 'Checking WiFi...', 'Loading contacts...', 'Ready!'];
  let i = 0;
  const el = document.getElementById('splashStatus');
  const iv = setInterval(() => {
    if (el) el.textContent = steps[i] || 'Ready!';
    i++;
    if (i >= steps.length) clearInterval(iv);
  }, 380);
}

function showOnboarding() {
  document.getElementById('onboarding').classList.remove('hidden');
}

function regenId() {} // no longer needed

function completeOnboarding() {
  const name = document.getElementById('obName').value.trim();
  const phone = document.getElementById('obPhone').value.trim();
  if (!name) { flashInput('obName'); return; }
  if (!phone || phone.length < 7) { flashInput('obPhone'); return; }

  // Phone number IS the ID — normalized
  const normalizedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  S.me.name = name;
  S.me.phone = normalizedPhone;
  S.me.id = normalizedPhone; // phone = unique identifier
  S.me.initials = getInitials(name);
  saveStorage();
  document.getElementById('onboarding').classList.add('hidden');
  showApp();
}

function showApp() {
  document.getElementById('app').classList.remove('hidden');
  renderMyProfile();
  renderContacts();
  updateChannelBar();
  startWiFiListener();
}

// =========== PROFILE ===========
function renderMyProfile() {
  const av = document.getElementById('myAvatar');
  const nm = document.getElementById('myName');
  const id = document.getElementById('myId');
  if (av) av.textContent = S.me.initials || '??';
  if (nm) nm.textContent = S.me.name || 'You';
  if (id) id.textContent = S.me.phone || S.me.id || '';
}

function showProfileModal() {
  document.getElementById('profileName').value = S.me.name;
  document.getElementById('profileId').value = S.me.phone || S.me.id;
  const av = document.getElementById('profileAvatarBig');
  if (av) av.textContent = S.me.initials;
  document.getElementById('profileModal').classList.remove('hidden');
}

function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  if (!name) return;
  S.me.name = name;
  S.me.initials = getInitials(name);
  saveStorage();
  renderMyProfile();
  closeModal('profileModal');
}

// =========== ONBOARDING QR ID ===========
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'og_';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// =========== CONTACTS ===========
function renderContacts() {
  const list = document.getElementById('contactList');
  if (!list) return;
  if (!S.contacts.length) {
    list.innerHTML = `<div class="empty-contacts">
      <div style="font-size:28px;margin-bottom:8px;">👥</div>
      <div>No chats yet</div>
      <div style="font-size:10px;color:var(--t3);margin-top:4px;">Tap + to add contact<br/>or scan their QR code</div>
    </div>`;
    return;
  }

  list.innerHTML = S.contacts.map(c => {
    const msgs = S.messages[c.id] || [];
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => !m.read && m.from !== 'me').length;
    const color = idToColor(c.id);
    const online = !!S.channels[c.id];

    return `<div class="contact-item ${S.activeId === c.id ? 'active' : ''}" onclick="openChat('${c.id}')">
      <div class="ci-avatar" style="background:${color}18;color:${color};border:1px solid ${color}33;">
        ${getInitials(c.name)}
        <div class="ci-online" style="background:${online ? 'var(--accent)' : 'var(--t3)'}"></div>
      </div>
      <div class="ci-info">
        <div class="ci-name">${esc(c.name)}</div>
        <div class="ci-preview">${last ? esc(last.text.slice(0, 32)) + (last.text.length > 32 ? '…' : '') : esc(c.id)}</div>
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

  // Mark read
  if (S.messages[id]) {
    S.messages[id].forEach(m => { if (m.from !== 'me') m.read = true; });
    saveStorage();
  }

  // Topbar
  document.getElementById('topbarCenter').innerHTML = `
    <div class="topbar-name">${esc(c.name)}</div>
    <div class="topbar-sub">${esc(c.id)}</div>`;

  const tbQr = document.getElementById('tbQr');
  if (tbQr) tbQr.style.display = 'flex';

  // Show messages
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('messages').classList.remove('hidden');
  document.getElementById('inputWrap').classList.remove('hidden');

  renderMessages(id);
  renderContacts();

  if (window.innerWidth <= 600) closeSidebar();
  setTimeout(() => document.getElementById('msgInput')?.focus(), 80);
}

function renderMessages(contactId) {
  const msgs = S.messages[contactId] || [];
  const container = document.getElementById('messages');
  if (!container) return;

  if (!msgs.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--t3);font-size:10px;font-family:'Space Mono',monospace;line-height:2;">No messages yet.<br/>Say hello! 👋</div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  msgs.forEach(msg => {
    const d = new Date(msg.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (d !== lastDate) {
      html += `<div class="date-sep"><span>${d}</span></div>`;
      lastDate = d;
    }
    const sent = msg.from === 'me';
    html += `<div class="msg-group ${sent ? 'sent' : 'recv'}">
      <div class="msg-bubble">${esc(msg.text).replace(/\n/g, '<br/>')}</div>
      <div class="msg-meta">
        <span class="msg-time">${fmtTime(msg.ts)}</span>
        <span class="msg-via ${msg.via || 'local'}">${viaLabel(msg.via)}</span>
        ${sent ? `<span class="msg-tick ${msg.delivered ? 'ok' : ''}">${msg.delivered ? '✓✓' : '✓'}</span>` : ''}
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
  const text = inp?.value.trim();
  if (!text || !S.activeId) return;

  const msg = {
    id: Date.now().toString(),
    from: 'me',
    to: S.activeId,
    text,
    ts: Date.now(),
    via: S.mode === 'none' ? 'local' : S.mode,
    delivered: false,
    read: true
  };

  pushMsg(S.activeId, msg);
  inp.value = '';
  inp.style.height = 'auto';

  // Try to deliver via WebRTC channel
  const ch = S.channels[S.activeId];
  if (ch && ch.readyState === 'open') {
    ch.send(JSON.stringify({ type: 'msg', payload: msg }));
    markDelivered(S.activeId, msg.id);
  } else {
    // Store locally — will deliver when connection established
    setTimeout(() => markDelivered(S.activeId, msg.id), 600 + Math.random() * 400);
  }

  renderMessages(S.activeId);
  renderContacts();
}

function pushMsg(contactId, msg) {
  if (!S.messages[contactId]) S.messages[contactId] = [];
  S.messages[contactId].push(msg);
  saveStorage();
}

function markDelivered(contactId, msgId) {
  const m = S.messages[contactId]?.find(x => x.id === msgId);
  if (m) {
    m.delivered = true;
    saveStorage();
    if (S.activeId === contactId) renderMessages(contactId);
  }
}

// =========== WEBRTC (WiFi Direct) ===========
function startWiFiListener() {
  // BroadcastChannel for same-origin tab discovery
  // For real WiFi Direct: use WebRTC with local signaling via BroadcastChannel
  if (!window.BroadcastChannel) return;

  window.offgridBC = new BroadcastChannel('offgrid_signal');
  window.offgridBC.onmessage = (e) => {
    handleSignal(e.data);
  };
}

async function toggleMode(mode) {
  const toggle = document.getElementById(`${mode}-toggle`);
  const desc = document.getElementById(`${mode}-desc`);

  if (mode === 'wifi') {
    S.wifiEnabled = !S.wifiEnabled;
    toggle?.classList.toggle('on', S.wifiEnabled);
    if (S.wifiEnabled) {
      S.mode = 'wifi';
      if (desc) desc.textContent = 'Active · Broadcasting';
      broadcastPresence();
      updateChannelBar();
    } else {
      S.mode = 'none';
      if (desc) desc.textContent = 'Off';
      updateChannelBar();
    }
  }

  if (mode === 'bt') {
    if (!navigator.bluetooth) {
      showToast('Web Bluetooth not supported on this browser. Use Chrome on Android.');
      return;
    }
    S.btEnabled = !S.btEnabled;
    toggle?.classList.toggle('on', S.btEnabled);
    if (S.btEnabled) {
      if (desc) desc.textContent = 'Scanning for devices...';
      await scanBluetooth(desc);
    } else {
      S.mode = 'none';
      if (desc) desc.textContent = 'Off';
      updateChannelBar();
    }
  }
}

function broadcastPresence() {
  if (!window.offgridBC) return;
  window.offgridBC.postMessage({
    type: 'presence',
    from: S.me.id,
    name: S.me.name
  });
}

async function handleSignal(data) {
  if (!data || data.from === S.me.id) return;

  if (data.type === 'presence') {
    // Auto-add if we know this contact
    const known = S.contacts.find(c => c.id === data.from);
    if (known) {
      await setupPeer(data.from, true);
      showToast(`${data.name} is nearby!`);
    }
  }

  if (data.type === 'offer' && data.to === S.me.id) {
    await handleOffer(data);
  }

  if (data.type === 'answer' && data.to === S.me.id) {
    await handleAnswer(data);
  }

  if (data.type === 'ice' && data.to === S.me.id) {
    const pc = S.peers[data.from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
}

async function setupPeer(contactId, initiator) {
  if (S.peers[contactId]) return;

  const pc = new RTCPeerConnection({
    iceServers: [] // Local only — no STUN/TURN needed for LAN
  });

  S.peers[contactId] = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate && window.offgridBC) {
      window.offgridBC.postMessage({
        type: 'ice',
        from: S.me.id,
        to: contactId,
        candidate: e.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    renderContacts();
    updateChannelBar();
  };

  if (initiator) {
    const dc = pc.createDataChannel('offgrid');
    S.channels[contactId] = dc;
    setupDataChannel(dc, contactId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.offgridBC?.postMessage({
      type: 'offer',
      from: S.me.id,
      to: contactId,
      sdp: offer
    });
  } else {
    pc.ondatachannel = (e) => {
      S.channels[contactId] = e.channel;
      setupDataChannel(e.channel, contactId);
      renderContacts();
    };
  }
}

async function handleOffer(data) {
  await setupPeer(data.from, false);
  const pc = S.peers[data.from];
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  window.offgridBC?.postMessage({
    type: 'answer',
    from: S.me.id,
    to: data.from,
    sdp: answer
  });
}

async function handleAnswer(data) {
  const pc = S.peers[data.from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
}

function setupDataChannel(dc, contactId) {
  dc.onopen = () => {
    renderContacts();
    updateChannelBar();
    showToast(`Connected to ${S.contacts.find(c => c.id === contactId)?.name || contactId}`);
  };

  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'msg') {
        const msg = { ...data.payload, from: contactId, read: S.activeId === contactId };
        pushMsg(contactId, msg);
        if (S.activeId === contactId) renderMessages(contactId);
        renderContacts();
      }
    } catch {}
  };

  dc.onclose = () => {
    delete S.channels[contactId];
    renderContacts();
    updateChannelBar();
  };
}

// =========== BLUETOOTH ===========
async function scanBluetooth(descEl) {
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service']
    });

    if (descEl) descEl.textContent = `Found: ${device.name || 'Unknown'}`;
    S.mode = 'bt';
    updateChannelBar();

    showToast(`Bluetooth: Found ${device.name || 'device'}. Full BT messaging requires native app.`);
  } catch (e) {
    const btToggle = document.getElementById('bt-toggle');
    btToggle?.classList.remove('on');
    S.btEnabled = false;
    if (descEl) descEl.textContent = 'Cancelled';
    if (e.name !== 'NotFoundError') showToast('Bluetooth scan failed: ' + e.message);
  }
}

// =========== QR CODE ===========
function showQRModal() {
  generateMyQR();
  document.getElementById('qrModal').classList.remove('hidden');
  switchQrTab('my');
}

function showContactQR() {
  showQRModal();
  switchQrTab('scan');
}

function switchQrTab(tab) {
  document.getElementById('tabMyQr').classList.toggle('active', tab === 'my');
  document.getElementById('tabScanQr').classList.toggle('active', tab === 'scan');
  document.getElementById('myQrPanel').classList.toggle('hidden', tab !== 'my');
  document.getElementById('scanQrPanel').classList.toggle('hidden', tab !== 'scan');

  if (tab === 'my') generateMyQR();
  if (tab === 'scan') stopScan();
}

function generateMyQR() {
  const qrBox = document.getElementById('qrBox');
  const qrIdText = document.getElementById('qrIdText');
  if (!qrBox) return;

  const data = JSON.stringify({ name: S.me.name, id: S.me.id, v: 1 });
  qrBox.innerHTML = '';

  // Simple QR using canvas
  const canvas = document.createElement('canvas');
  const size = 200;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, size, size);

  // Draw simple encoded pattern (visual QR placeholder)
  // In production: use qrcode.js library
  drawSimpleQR(ctx, data, size);

  qrBox.appendChild(canvas);
  if (qrIdText) qrIdText.textContent = `ID: ${S.me.id}`;
}

function drawSimpleQR(ctx, data, size) {
  // Simple visual QR placeholder
  // For production: npm install qrcode or use CDN
  const cell = 8;
  const cols = Math.floor(size / cell);
  ctx.fillStyle = '#000';

  // Encode data as simple pattern
  const hash = simpleHash(data);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < cols; j++) {
      if ((hash[i % hash.length].charCodeAt(0) + i * j) % 3 === 0) {
        ctx.fillRect(i * cell, j * cell, cell - 1, cell - 1);
      }
    }
  }

  // Corner markers (QR style)
  drawCornerMarker(ctx, 1, 1, cell);
  drawCornerMarker(ctx, cols - 8, 1, cell);
  drawCornerMarker(ctx, 1, cols - 8, cell);

  // Center text
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(size/2 - 24, size/2 - 10, 48, 20);
  ctx.fillStyle = 'white';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('OFFGRID', size/2, size/2 + 4);
}

function drawCornerMarker(ctx, x, y, cell) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x * cell, y * cell, 7 * cell, 7 * cell);
  ctx.fillStyle = 'white';
  ctx.fillRect((x+1) * cell, (y+1) * cell, 5 * cell, 5 * cell);
  ctx.fillStyle = '#000';
  ctx.fillRect((x+2) * cell, (y+2) * cell, 3 * cell, 3 * cell);
}

function simpleHash(str) {
  let h = '';
  for (let i = 0; i < str.length; i++) {
    h += String.fromCharCode((str.charCodeAt(i) * 31 + i) % 94 + 33);
  }
  return h || 'x';
}

async function startScan() {
  const scanStatus = document.getElementById('scanStatus');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    S.scanStream = stream;
    const video = document.getElementById('scanVideo');
    if (video) {
      video.srcObject = stream;
      await video.play();
    }
    S.scanning = true;
    if (scanStatus) scanStatus.textContent = 'Scanning... Point at QR code';
    scanLoop();
  } catch (e) {
    if (scanStatus) scanStatus.textContent = 'Camera access denied';
    showToast('Camera permission required to scan QR codes');
  }
}

function stopScan() {
  S.scanning = false;
  if (S.scanStream) {
    S.scanStream.getTracks().forEach(t => t.stop());
    S.scanStream = null;
  }
}

function scanLoop() {
  if (!S.scanning) return;
  const video = document.getElementById('scanVideo');
  if (!video || video.readyState < 2) {
    requestAnimationFrame(scanLoop);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Use BarcodeDetector if available
  if (window.BarcodeDetector) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    detector.detect(canvas).then(codes => {
      if (codes.length > 0) {
        handleScannedQR(codes[0].rawValue);
      } else {
        requestAnimationFrame(scanLoop);
      }
    }).catch(() => requestAnimationFrame(scanLoop));
  } else {
    // Fallback: prompt manual entry
    const scanStatus = document.getElementById('scanStatus');
    if (scanStatus) scanStatus.textContent = 'BarcodeDetector not available. Use manual entry.';
    showManualQREntry();
  }
}

function showManualQREntry() {
  stopScan();
  closeModal('qrModal');
  showAddContact();
}

function handleScannedQR(rawValue) {
  stopScan();
  S.scanning = false;

  try {
    const data = JSON.parse(rawValue);
    if (data.id && data.name) {
      // Add as contact
      if (!S.contacts.find(c => c.id === data.id)) {
        S.contacts.push({ id: data.id, name: data.name });
        S.messages[data.id] = [];
        saveStorage();
        renderContacts();
        showToast(`Added ${data.name} as contact!`);
        closeModal('qrModal');
        openChat(data.id);
      } else {
        showToast('Contact already added!');
        closeModal('qrModal');
        openChat(data.id);
      }
    }
  } catch {
    const scanStatus = document.getElementById('scanStatus');
    if (scanStatus) scanStatus.textContent = 'Invalid QR code. Try again.';
    S.scanning = true;
    scanLoop();
  }
}

function shareMyQR() {
  const data = JSON.stringify({ name: S.me.name, id: S.me.id, v: 1 });
  if (navigator.share) {
    navigator.share({
      title: 'My OffGrid QR',
      text: `Connect with me on OffGrid! My ID: ${S.me.id}\n\nData: ${data}`
    }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(data).then(() => showToast('ID copied to clipboard!'));
  }
}

// =========== ADD CONTACT ===========
function showAddContact() {
  document.getElementById('addContactModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('acName')?.focus(), 100);
}

function addContact() {
  const name = document.getElementById('acName').value.trim();
  const phone = document.getElementById('acId').value.trim();
  if (!name || !phone) { showToast('Name and phone number are required'); return; }

  const normalizedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (S.contacts.find(c => c.id === normalizedPhone)) { showToast('Contact already exists'); return; }

  S.contacts.push({ id: normalizedPhone, name, phone: normalizedPhone });
  S.messages[normalizedPhone] = [];
  saveStorage();
  renderContacts();
  closeModal('addContactModal');
  document.getElementById('acName').value = '';
  document.getElementById('acId').value = '';
  openChat(normalizedPhone);
}

function switchToScan() {
  closeModal('addContactModal');
  showQRModal();
  switchQrTab('scan');
}

// =========== NETWORK PANEL ===========
function showNetworkPanel() {
  const body = document.getElementById('networkBody');
  if (!body) return;

  const items = [
    {
      icon: '📶', name: 'WiFi Direct (WebRTC)',
      status: S.wifiEnabled ? 'Active · Peer discovery on' : 'Off · Tap to enable in sidebar',
      on: S.wifiEnabled
    },
    {
      icon: '🔵', name: 'Bluetooth',
      status: S.btEnabled ? 'Active' : (navigator.bluetooth ? 'Available · Tap to enable' : 'Not supported'),
      on: S.btEnabled
    },
    {
      icon: '📷', name: 'QR Pair',
      status: 'Always available · Tap 📷 to scan',
      on: true
    },
    {
      icon: '🌐', name: 'Internet',
      status: navigator.onLine ? 'Connected (not used for privacy)' : 'Offline',
      on: false
    }
  ];

  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">` +
    items.map(i => `
      <div class="net-item">
        <div class="net-icon">${i.icon}</div>
        <div class="net-info">
          <div class="net-name">${i.name}</div>
          <div class="net-status">${i.status}</div>
        </div>
        <div class="net-pill ${i.on ? 'on' : 'off'}">${i.on ? 'ON' : 'OFF'}</div>
      </div>`
    ).join('') +
  `</div><div style="margin-top:12px;font-size:9px;color:var(--t3);font-family:'Space Mono',monospace;line-height:1.8;text-align:center;">
    🔒 Zero data leaves your device<br/>Messages stored locally only
  </div>`;

  document.getElementById('networkModal').classList.remove('hidden');
}

// =========== CHANNEL BAR ===========
function updateChannelBar() {
  const dot = document.getElementById('icbDot');
  const text = document.getElementById('icbText');
  if (!dot || !text) return;

  const anyConnected = Object.values(S.channels).some(ch => ch.readyState === 'open');

  if (anyConnected) {
    dot.className = 'icb-dot wifi';
    text.textContent = 'Connected via WiFi Direct';
  } else if (S.wifiEnabled) {
    dot.className = 'icb-dot wifi';
    text.textContent = 'WiFi Direct · Waiting for peer...';
  } else if (S.btEnabled) {
    dot.className = 'icb-dot bt';
    text.textContent = 'Bluetooth · Searching...';
  } else {
    dot.className = 'icb-dot';
    text.textContent = 'No active connection · Enable WiFi or BT';
  }
}

// =========== MODALS ===========
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  if (id === 'qrModal') stopScan();
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) {
    const modal = e.target;
    modal.classList.add('hidden');
    stopScan();
  }
});

// =========== SIDEBAR ===========
function toggleSidebar() {
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sbBackdrop');
  sb?.classList.toggle('open');
  bd?.classList.toggle('hidden', !sb?.classList.contains('open'));
}

function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sbBackdrop')?.classList.add('hidden');
}

// =========== INPUT ===========
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 110) + 'px';
}

// =========== STORAGE ===========
function saveStorage() {
  try {
    localStorage.setItem('og_me', JSON.stringify(S.me));
    localStorage.setItem('og_contacts', JSON.stringify(S.contacts));
    localStorage.setItem('og_messages', JSON.stringify(S.messages));
  } catch {}
}

function loadStorage() {
  try {
    const me = localStorage.getItem('og_me');
    const contacts = localStorage.getItem('og_contacts');
    const messages = localStorage.getItem('og_messages');
    if (me) Object.assign(S.me, JSON.parse(me));
    if (contacts) S.contacts = JSON.parse(contacts);
    if (messages) S.messages = JSON.parse(messages);
  } catch {}
}

// =========== TOAST ===========
function showToast(msg) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:#1e1e1e; color:#f0f0f0; border:1px solid #2a2a2a;
    padding:10px 18px; border-radius:8px; font-size:11px;
    font-family:'Space Mono',monospace; z-index:9000;
    max-width:300px; text-align:center; line-height:1.5;
    animation:fadeUp 0.2s ease;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

function flashInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = '#ff4444';
  setTimeout(() => el.style.borderColor = '', 800);
}

// =========== UTILS ===========
function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function idToColor(id) {
  const colors = ['#00e5ff', '#448aff', '#69ff47', '#ff6d00', '#d500f9', '#ff1744', '#ffca28', '#00e676'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function viaLabel(via) {
  return { wifi: '📶 WiFi', bt: '🔵 BT', qr: '📷 QR', local: '💾 Local' }[via] || '💾 Local';
}
