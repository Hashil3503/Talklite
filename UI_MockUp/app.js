// Talklite Real SPA Application Mockup Script

document.addEventListener('DOMContentLoaded', () => {
  // Toast Helper
  const toast = document.getElementById('app-toast');
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 2500);
  }

  // ==========================================
  // 1. SPA View Switching (Lobby <-> Room)
  // ==========================================
  const viewLobby = document.getElementById('view-lobby');
  const viewRoom = document.getElementById('view-room');
  const tabLobby = document.getElementById('tab-lobby-view');
  const tabRoom = document.getElementById('tab-room-view');
  const logo = document.getElementById('nav-logo');
  const leaveBtn = document.getElementById('room-leave-btn');

  function switchToLobby() {
    if (viewLobby && viewRoom) {
      viewLobby.style.display = 'block';
      viewRoom.style.display = 'none';
      tabLobby.classList.add('active');
      tabRoom.classList.remove('active');
    }
  }

  function switchToRoom(roomTitle) {
    if (viewLobby && viewRoom) {
      viewLobby.style.display = 'none';
      viewRoom.style.display = 'block';
      tabRoom.classList.add('active');
      tabLobby.classList.remove('active');

      if (roomTitle) {
        const titleEl = document.querySelector('.room-page-title');
        if (titleEl) titleEl.textContent = roomTitle;
      }
    }
  }

  if (tabLobby) tabLobby.addEventListener('click', switchToLobby);
  if (tabRoom) tabRoom.addEventListener('click', () => switchToRoom());
  if (logo) logo.addEventListener('click', switchToLobby);
  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      showToast('🚪 방에서 퇴장했습니다.');
      switchToLobby();
    });
  }

  // ==========================================
  // 2. Lobby Room Card Click -> Enter Room
  // ==========================================
  const roomCards = document.querySelectorAll('.room-card');
  roomCards.forEach(card => {
    card.addEventListener('click', () => {
      const title = card.querySelector('.room-title').textContent;
      showToast(`🚀 "${title.slice(0, 18)}..." 방에 입장합니다.`);
      switchToRoom(title);
    });
  });

  // ==========================================
  // 3. Lobby Game Filters & Search
  // ==========================================
  const tagFilterBtns = document.querySelectorAll('.tag-filter-btn');
  tagFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tagFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const selectedGame = btn.dataset.game;
      roomCards.forEach(card => {
        if (selectedGame === 'ALL' || card.dataset.game === selectedGame) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  const searchInput = document.getElementById('lobby-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      roomCards.forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(term)) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    });
  }

  // ==========================================
  // 4. VoiceBar VU Meter Animation
  // ==========================================
  const vuBars = document.querySelectorAll('#voicebar-vu-bars .vu-bar');
  const vuDbText = document.getElementById('voicebar-db');
  let isMicMuted = false;
  let isTesting = false;

  function updateVuMeter() {
    if (vuBars.length === 0) return;
    
    let activeCount = 0;
    if (isMicMuted) {
      activeCount = 0;
    } else if (isTesting) {
      activeCount = Math.floor(Math.random() * 16) + 4;
    } else {
      const rand = Math.random();
      if (rand > 0.4) {
        activeCount = Math.floor(Math.sin(Date.now() / 180) * 6 + 7);
      } else {
        activeCount = Math.floor(Math.random() * 3);
      }
    }

    vuBars.forEach((bar, index) => {
      bar.className = 'vu-bar';
      if (index < activeCount) {
        if (index < 14) {
          bar.classList.add('active-green');
        } else if (index < 18) {
          bar.classList.add('active-yellow');
        } else {
          bar.classList.add('active-red');
        }
      }
    });

    if (vuDbText) {
      const db = isMicMuted ? -60 : (-45 + (activeCount * 2.2));
      vuDbText.textContent = `${Math.round(db)} dB`;
    }
  }

  setInterval(updateVuMeter, 100);

  // ==========================================
  // 5. VoiceBar Mic / Deafen Toggles
  // ==========================================
  const toggleMicBtn = document.getElementById('toggle-mic-btn');
  const toggleDeafenBtn = document.getElementById('toggle-deafen-btn');

  if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', () => {
      isMicMuted = !isMicMuted;
      if (isMicMuted) {
        toggleMicBtn.classList.add('muted');
        toggleMicBtn.querySelector('.voice-icon').textContent = '🎙️❌';
        toggleMicBtn.querySelector('.voice-btn-label').textContent = '마이크 꺼짐';
        showToast('🎙️ 마이크가 음소거되었습니다.');
      } else {
        toggleMicBtn.classList.remove('muted');
        toggleMicBtn.querySelector('.voice-icon').textContent = '🎙️';
        toggleMicBtn.querySelector('.voice-btn-label').textContent = '마이크 켜짐';
        showToast('🎙️ 마이크가 켜졌습니다.');
      }
    });
  }

  if (toggleDeafenBtn) {
    let isDeafened = false;
    toggleDeafenBtn.addEventListener('click', () => {
      isDeafened = !isDeafened;
      if (isDeafened) {
        toggleDeafenBtn.classList.add('muted');
        toggleDeafenBtn.querySelector('.voice-icon').textContent = '🎧❌';
        toggleDeafenBtn.querySelector('.voice-btn-label').textContent = '스피커 꺼짐';
        showToast('🎧 헤드셋 사운드가 차단되었습니다.');
      } else {
        toggleDeafenBtn.classList.remove('muted');
        toggleDeafenBtn.querySelector('.voice-icon').textContent = '🎧';
        toggleDeafenBtn.querySelector('.voice-btn-label').textContent = '스피커 켜짐';
        showToast('🎧 스피커 사운드가 복원되었습니다.');
      }
    });
  }

  // ==========================================
  // 6. VoiceBar 3-Second Mic Test & Noise Toggle
  // ==========================================
  const testMicBtn = document.getElementById('room-test-mic-btn');
  if (testMicBtn) {
    testMicBtn.addEventListener('click', () => {
      if (isTesting) return;
      isTesting = true;
      testMicBtn.textContent = '🔴 녹음 중 (3초)...';
      testMicBtn.style.color = '#EF4444';

      setTimeout(() => {
        testMicBtn.textContent = '🎧 루프백 재생 중...';
        testMicBtn.style.color = '#10B981';
      }, 3000);

      setTimeout(() => {
        isTesting = false;
        testMicBtn.textContent = '🎙️ 3초 테스트';
        testMicBtn.style.color = '';
      }, 6000);
    });
  }

  const noiseBtn = document.getElementById('room-noise-btn');
  let noiseActive = true;
  if (noiseBtn) {
    noiseBtn.addEventListener('click', () => {
      noiseActive = !noiseActive;
      if (noiseActive) {
        noiseBtn.classList.add('active');
        noiseBtn.textContent = '🧠 DeepFilterNet ON';
        showToast('🧠 WASM 딥러닝 잡음 제거 활성화 (키보드 타건음 차단)');
      } else {
        noiseBtn.classList.remove('active');
        noiseBtn.textContent = '⚪ 잡음 제거 OFF';
        showToast('⚪ 잡음 제거 비활성화 (원음 패스스루)');
      }
    });
  }

  // ==========================================
  // 7. Hardware Device setSinkId Select
  // ==========================================
  const roomSpeakerSelect = document.getElementById('room-speaker-select');
  const roomMicSelect = document.getElementById('room-mic-select');

  if (roomSpeakerSelect) {
    roomSpeakerSelect.addEventListener('change', (e) => {
      const val = e.target.options[e.target.selectedIndex].text;
      showToast(`🔊 출력 장치 전환: ${val} (AudioContext setSinkId)`);
    });
  }
  if (roomMicSelect) {
    roomMicSelect.addEventListener('change', (e) => {
      const val = e.target.options[e.target.selectedIndex].text;
      showToast(`🎙️ 마이크 장치 전환: ${val}`);
    });
  }

  // ==========================================
  // 8. Realtime Chat Sending & Mentions
  // ==========================================
  const chatInput = document.getElementById('chat-input-text');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatMessages = document.getElementById('chat-messages');

  function sendMessage() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    const isMention = text.includes('@');
    const item = document.createElement('div');
    item.className = `chat-item ${isMention ? 'mentioned' : ''}`;
    
    const now = new Date();
    const timeStr = `오후 ${now.getHours() % 12 || 12}:${now.getMinutes().toString().padStart(2, '0')}`;

    item.innerHTML = `
      <div class="chat-avatar">페</div>
      <div class="chat-content">
        <div class="chat-header-meta">
          <span class="chat-author host">페이커미드 👑</span>
          <span class="chat-time">${timeStr}</span>
        </div>
        <div class="chat-text">${text}</div>
      </div>
    `;

    if (chatMessages) {
      chatMessages.appendChild(item);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatInput.value = '';
  }

  if (chatSendBtn) chatSendBtn.addEventListener('click', sendMessage);
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // ==========================================
  // 9. Modals (Create Room & Invite)
  // ==========================================
  const createModal = document.getElementById('create-room-modal');
  const inviteModal = document.getElementById('invite-join-modal');
  const openCreateBtn1 = document.getElementById('header-create-btn');
  const openInviteBtn = document.getElementById('header-invite-btn');
  const closeCreateBtn = document.getElementById('close-create-modal');
  const cancelCreateBtn = document.getElementById('btn-cancel-create');
  const closeInviteBtn = document.getElementById('close-invite-modal');
  const cancelInviteBtn = document.getElementById('btn-cancel-invite');
  const createForm = document.getElementById('create-room-form');
  const inviteForm = document.getElementById('invite-join-form');
  const copyInviteBtn = document.getElementById('room-copy-invite-btn');

  if (openCreateBtn1) openCreateBtn1.addEventListener('click', () => createModal.classList.add('active'));
  if (openInviteBtn) openInviteBtn.addEventListener('click', () => inviteModal.classList.add('active'));
  if (closeCreateBtn) closeCreateBtn.addEventListener('click', () => createModal.classList.remove('active'));
  if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', () => createModal.classList.remove('active'));
  if (closeInviteBtn) closeInviteBtn.addEventListener('click', () => inviteModal.classList.remove('active'));
  if (cancelInviteBtn) cancelInviteBtn.addEventListener('click', () => inviteModal.classList.remove('active'));

  if (createForm) {
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('form-title').value;
      createModal.classList.remove('active');
      showToast(`🎉 "${title}" 방이 생성되었습니다!`);
      switchToRoom(title);
    });
  }

  if (inviteForm) {
    inviteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = document.getElementById('invite-code-input').value;
      inviteModal.classList.remove('active');
      showToast(`🔑 초대코드 [${code}] 방에 입장했습니다!`);
      switchToRoom(`초대코드 방 (${code})`);
    });
  }

  if (copyInviteBtn) {
    copyInviteBtn.addEventListener('click', () => {
      navigator.clipboard.writeText('https://talklite.live/join/TL-8492');
      showToast('🔗 초대 링크(https://talklite.live/join/TL-8492)가 복사되었습니다!');
    });
  }
});
