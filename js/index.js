(() => {
  document.documentElement.dataset.js = 'true';

  // Gallery image sound handler with max 3 concurrent plays
  const galleryImages = document.querySelectorAll('.gallery-img[data-sound]');
  const volumeControl = document.getElementById('gallery-volume');
  const muteButton = document.getElementById('gallery-mute');
  const activeAudioPlayers = new Set();
  const activeHoverLoops = new Map();
  const MAX_CONCURRENT_AUDIO = 5;
  const HOVER_VOLUME_KEY = 'sonicPrism.hoverVolume.v1';
  const HOVER_MUTED_KEY = 'sonicPrism.hoverMuted.v1';
  const DEFAULT_HOVER_VOLUME = 0.7;
  let hoverVolume = DEFAULT_HOVER_VOLUME;
  let isHoverMuted = false;

  function clampHoverVolume(raw) {
    const value = Number.parseFloat(String(raw));
    if (!Number.isFinite(value)) return DEFAULT_HOVER_VOLUME;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function loadHoverVolume() {
    try {
      const stored = localStorage.getItem(HOVER_VOLUME_KEY);
      if (stored == null) return DEFAULT_HOVER_VOLUME;
      return clampHoverVolume(stored);
    } catch {
      return DEFAULT_HOVER_VOLUME;
    }
  }

  function saveHoverVolume(volume) {
    try {
      localStorage.setItem(HOVER_VOLUME_KEY, String(volume));
    } catch {
      // ignore storage write issues
    }
  }

  function loadHoverMuted() {
    try {
      return localStorage.getItem(HOVER_MUTED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function saveHoverMuted(muted) {
    try {
      localStorage.setItem(HOVER_MUTED_KEY, muted ? '1' : '0');
    } catch {
      // ignore storage write issues
    }
  }

  function getEffectiveHoverVolume() {
    return isHoverMuted ? 0 : hoverVolume;
  }

  function syncMuteButton() {
    if (!muteButton) return;
    muteButton.setAttribute('aria-pressed', isHoverMuted ? 'true' : 'false');
  }

  function applyHoverVolumeToActivePlayers() {
    for (const audio of activeAudioPlayers) {
      audio.volume = getEffectiveHoverVolume();
    }
  }

  hoverVolume = loadHoverVolume();
  isHoverMuted = loadHoverMuted();

  if (volumeControl) {
    volumeControl.value = String(Math.round(hoverVolume * 100));
    volumeControl.addEventListener('input', (event) => {
      const nextPercent = Number.parseFloat(event.target?.value);
      hoverVolume = clampHoverVolume(nextPercent / 100);
      applyHoverVolumeToActivePlayers();
      saveHoverVolume(hoverVolume);
    });
  }

  if (muteButton) {
    muteButton.addEventListener('click', () => {
      isHoverMuted = !isHoverMuted;
      syncMuteButton();
      applyHoverVolumeToActivePlayers();
      saveHoverMuted(isHoverMuted);
    });
  }

  syncMuteButton();

  function cleanupAudioPlayer(audio) {
    activeAudioPlayers.delete(audio);
  }

  function pruneInactiveAudioPlayers() {
    for (const audio of activeAudioPlayers) {
      if (audio.ended || audio.paused) {
        activeAudioPlayers.delete(audio);
      }
    }
  }

  function playGallerySound(soundPath) {
    if (!soundPath) return;

    pruneInactiveAudioPlayers();

    // Only play if we're under the cap
    if (activeAudioPlayers.size >= MAX_CONCURRENT_AUDIO) {
      return;
    }

    const audio = new Audio(soundPath);
    audio.volume = getEffectiveHoverVolume();
    activeAudioPlayers.add(audio);

    // Remove from active list when finished
    audio.addEventListener('ended', () => cleanupAudioPlayer(audio), { once: true });
    audio.addEventListener('error', () => cleanupAudioPlayer(audio), { once: true });

    audio.play().catch(error => {
      cleanupAudioPlayer(audio);
      console.log('Sound play error:', error);
    });
  }

  function runHoverLoopIteration(img) {
    const loopState = activeHoverLoops.get(img);
    if (!loopState) return;

    pruneInactiveAudioPlayers();

    // Only play if we're under the cap
    if (activeAudioPlayers.size >= MAX_CONCURRENT_AUDIO) {
      if (!loopState.isHovering) {
        activeHoverLoops.delete(img);
      }
      return;
    }

    const audio = new Audio(loopState.soundPath);
    audio.volume = getEffectiveHoverVolume();
    loopState.audio = audio;
    activeAudioPlayers.add(audio);

    audio.addEventListener('ended', () => {
      cleanupAudioPlayer(audio);

      const currentState = activeHoverLoops.get(img);
      if (!currentState || currentState.audio !== audio) return;

      currentState.audio = null;
      if (currentState.isHovering) {
        runHoverLoopIteration(img);
      } else {
        activeHoverLoops.delete(img);
      }
    }, { once: true });

    audio.addEventListener('error', () => {
      cleanupAudioPlayer(audio);
      const currentState = activeHoverLoops.get(img);
      if (currentState && currentState.audio === audio) {
        activeHoverLoops.delete(img);
      }
    }, { once: true });

    audio.play().catch(error => {
      cleanupAudioPlayer(audio);
      const currentState = activeHoverLoops.get(img);
      if (currentState && currentState.audio === audio) {
        activeHoverLoops.delete(img);
      }
      console.log('Sound play error:', error);
    });
  }

  function startHoverLoopForImage(img) {
    if (!img) return;

    const existingState = activeHoverLoops.get(img);
    if (existingState) {
      existingState.isHovering = true;
      return;
    }

    const soundPath = img.dataset.sound;
    if (!soundPath) return;

    activeHoverLoops.set(img, {
      soundPath,
      isHovering: true,
      audio: null
    });

    runHoverLoopIteration(img);
  }

  function stopHoverLoopForImage(img) {
    const loopState = activeHoverLoops.get(img);
    if (!loopState) return;

    loopState.isHovering = false;
    if (!loopState.audio) {
      activeHoverLoops.delete(img);
    }
  }

  galleryImages.forEach(img => {
    img.style.cursor = 'pointer';
    
    img.addEventListener('mouseenter', (e) => {
      startHoverLoopForImage(e.currentTarget);
    });

    img.addEventListener('mouseleave', (e) => {
      stopHoverLoopForImage(e.currentTarget);
    });

    img.addEventListener('click', (e) => {
      playGallerySound(e.currentTarget.dataset.sound);
    });
  });

  const api = window.SonicPrismPosts;
  if (!api) return;

  // Optional seeding if localStorage is empty.
  // Leave empty if you only want to manage posts via the local admin page.
  const POSTS_CONFIG = [];

  const postList = document.getElementById('postList');

  if (!postList) {
    return;
  }

  // Ensure mouse wheel scroll works inside the feed even when the page itself is non-scrollable.
  const postBox = postList.closest?.('.post-box') || postList;
  api.enableWheelScroll?.(postBox, postList);

  function parsePostsFilePayload(data) {
    // Legacy format: [posts...]
    if (Array.isArray(data)) {
      return { posts: data, settings: null };
    }

    // New format: { settings: { maxAgeDays }, posts: [...] }
    if (data && typeof data === 'object') {
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
      return { posts, settings };
    }

    return null;
  }

  function parseMaxAgeDaysSetting(raw) {
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 3650) return 3650;
    return n;
  }

  function seedIfEmpty(currentPosts) {
    if (currentPosts.length || !POSTS_CONFIG.length) return currentPosts;

    const seeded = POSTS_CONFIG.map((cfg) => {
      const blocks = [];
      if (Array.isArray(cfg.blocks)) {
        for (const block of cfg.blocks) {
          if (block?.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
            blocks.push({ type: 'text', text: block.content.trim() });
          }
          if (block?.type === 'image' && typeof block.url === 'string') {
            const src = api.normalizeImageSource(block.url);
            if (src) blocks.push({ type: 'image', src });
          }
          if (block?.type === 'embed' && typeof block.url === 'string') {
            const src = api.normalizeHttpUrl(block.url);
            if (src) blocks.push({ type: 'iframe', src });
          }
        }
      }
      return {
        id: crypto.randomUUID?.() ?? String(Date.now()),
        createdAt: Date.now(),
        blocks
      };
    });

    return seeded;
  }

  function loadAndRender() {
    // Try loading from data/posts.json (Git-tracked file, works on GitHub Pages)
    fetch('data/posts.json', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(jsonPosts => {
        const payload = parsePostsFilePayload(jsonPosts);
        let posts = payload ? payload.posts : null;
        
        // Fall back to localStorage if file doesn't exist or is invalid
        if (!posts) {
          posts = api.loadPosts();
        }

        const fromFile = parseMaxAgeDaysSetting(payload?.settings?.maxAgeDays);
        const maxAgeDays = fromFile ?? api.getMaxAgeDays(14);
        if (fromFile != null) {
          // Keep localStorage aligned so other local pages/tabs behave consistently.
          api.setMaxAgeDays(fromFile);
        }

        const visible = api.prunePosts(posts, maxAgeDays);
        api.sortNewestFirst(visible);
        const seeded = seedIfEmpty(visible);

        api.renderPostList(postList, seeded);
      })
      .catch(() => {
        // Fall back to localStorage if fetch fails
        let posts = api.loadPosts();

        const maxAgeDays = api.getMaxAgeDays(14);
        const visible = api.prunePosts(posts, maxAgeDays);
        api.sortNewestFirst(visible);
        const seeded = seedIfEmpty(visible);
        api.renderPostList(postList, seeded);
      });
  }

  const FEED_SYNC_CHANNEL = 'sonicPrism.posts.sync.v1';
  const feedSync = globalThis.BroadcastChannel ? new BroadcastChannel(FEED_SYNC_CHANNEL) : null;
  try {
    feedSync?.addEventListener('message', (e) => {
      const msg = e?.data;
      if (msg?.type === 'refresh') {
        loadAndRender();
      }
    });
  } catch {
    // ignore
  }

  loadAndRender();

  // Keep in sync with the local admin page when both are open.
  window.addEventListener('storage', (e) => {
    if (e.key === api.POSTS_KEY || e.key === api.MAX_AGE_KEY) {
      loadAndRender();
    }
  });
})();

// GSAP animations for wow image and text
(() => {
  const wowImg = document.getElementById('wow-img');
  const magicText = document.getElementById('magic-text');

  if (!wowImg || !magicText) return;

  let imgTween, textTween;
  let isHoveringWow = false;

  function startWowAnimations() {
    // Kill any existing tweens
    if (imgTween) imgTween.kill();
    if (textTween) textTween.kill();

    // Start spinning
    imgTween = gsap.to(wowImg, { rotation: 260 * 360, duration: 30, ease: "sine.inOut" });
    textTween = gsap.to(magicText, { rotation: 45 - 260 * 360, duration: 30, ease: "sine.inOut" });
  }

  function rewindWowAnimations() {
    // Kill and rewind
    if (imgTween) imgTween.kill();
    if (textTween) textTween.kill();

    imgTween = gsap.to(wowImg, { rotation: 0, duration: 2, ease: "sine.inOut" });
    textTween = gsap.to(magicText, { rotation: 45, duration: 2, ease: "sine.inOut" });
  }

  function isPointInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function updateWowHoverState(event) {
    const wowRect = wowImg.getBoundingClientRect();
    const magicRect = magicText.getBoundingClientRect();

    const insideWow = isPointInsideRect(event.clientX, event.clientY, wowRect);
    const insideMagic = isPointInsideRect(event.clientX, event.clientY, magicRect);
    const shouldHover = insideWow || insideMagic;

    if (shouldHover && !isHoveringWow) {
      isHoveringWow = true;
      startWowAnimations();
      return;
    }

    if (!shouldHover && isHoveringWow) {
      isHoveringWow = false;
      rewindWowAnimations();
    }
  }

  document.addEventListener('pointermove', updateWowHoverState, { passive: true });
  document.addEventListener('pointerleave', () => {
    if (isHoveringWow) {
      isHoveringWow = false;
      rewindWowAnimations();
    }
  });
})();

// GSAP animation for logo
(() => {
  const logoImg = document.getElementById('logo-img');

  if (!logoImg) return;

  let logoTween;

  function startLogoAnimation() {
    // Kill any existing tween
    if (logoTween) logoTween.kill();

    // Start spinning
    logoTween = gsap.to(logoImg, { rotation: 260 * 360, duration: 30, ease: "sine.inOut" });
  }

  function rewindLogoAnimation() {
    // Kill and rewind
    if (logoTween) logoTween.kill();

    logoTween = gsap.to(logoImg, { rotation: 0, duration: 2, ease: "sine.inOut" });
  }

  // Add hover listeners to the logo
  logoImg.addEventListener('mouseenter', startLogoAnimation);
  logoImg.addEventListener('mouseleave', rewindLogoAnimation);
})();
