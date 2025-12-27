(() => {
  const POSTS_KEY = 'sonicPrism.posts.v1';
  const MAX_AGE_KEY = 'sonicPrism.posts.maxAgeDays.v1';

  function safeId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function daysToMs(days) {
    return days * 24 * 60 * 60 * 1000;
  }

  function clampInt(value, { min = 1, max = 3650 } = {}) {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }

  function getMaxAgeDays(fallback = 14) {
    try {
      const raw = localStorage.getItem(MAX_AGE_KEY);
      const n = clampInt(raw, { min: 1, max: 3650 });
      return n ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setMaxAgeDays(days) {
    const n = clampInt(days, { min: 1, max: 3650 });
    if (n == null) return false;
    try {
      localStorage.setItem(MAX_AGE_KEY, String(n));
      return true;
    } catch {
      return false;
    }
  }

  function loadPosts() {
    try {
      const raw = localStorage.getItem(POSTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function savePosts(posts) {
    try {
      localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
      return true;
    } catch {
      return false;
    }
  }

  function sortNewestFirst(posts) {
    posts.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
    return posts;
  }

  function prunePosts(posts, maxAgeDays = getMaxAgeDays()) {
    const cutoff = Date.now() - daysToMs(maxAgeDays);
    return posts.filter((p) => typeof p?.createdAt === 'number' && p.createdAt >= cutoff);
  }

  function normalizeHttpUrl(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function normalizeImageSource(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;

    // Allow repo-relative assets paths (works locally + on GitHub Pages)
    if (trimmed.startsWith('/assets/images/') || trimmed.startsWith('assets/images/')) {
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    const url = normalizeHttpUrl(trimmed);
    if (!url) return null;

    // Allow any http(s) image URL (the admin can still recommend repo-hosted images).
    return url;
  }

  function parseIframeInput(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;

    if (trimmed.toLowerCase().includes('<iframe')) {
      try {
        const doc = new DOMParser().parseFromString(trimmed, 'text/html');
        const iframe = doc.querySelector('iframe');
        const src = iframe?.getAttribute('src');
        return normalizeHttpUrl(src);
      } catch {
        return null;
      }
    }

    return normalizeHttpUrl(trimmed);
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '';
    }
  }

  function createPostElement(post, { metaPrefix } = {}) {
    const wrapper = document.createElement('article');
    wrapper.className = 'post';

    const meta = document.createElement('div');
    meta.className = 'post-meta';

    if (metaPrefix) {
      const prefix = document.createElement('span');
      prefix.textContent = metaPrefix;
      meta.appendChild(prefix);
      const spacer = document.createElement('span');
      spacer.textContent = ' • ';
      meta.appendChild(spacer);
    }

    const time = document.createElement('time');
    time.dateTime = new Date(post.createdAt).toISOString();
    time.textContent = formatTime(post.createdAt);
    meta.appendChild(time);

    const content = document.createElement('div');
    content.className = 'post-content';

    for (const block of post.blocks || []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const p = document.createElement('p');
        p.className = 'post-text';
        p.textContent = block.text;
        content.appendChild(p);
      }

      if (block?.type === 'image' && typeof block.src === 'string') {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = block.alt || 'Post image';
        img.src = block.src;
        content.appendChild(img);
      }

      if (block?.type === 'iframe' && typeof block.src === 'string') {
        const iframe = document.createElement('iframe');
        iframe.loading = 'lazy';
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.allowFullscreen = true;
        iframe.src = block.src;
        iframe.title = block.title || 'Embedded content';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        content.appendChild(iframe);
      }
    }

    wrapper.appendChild(meta);
    wrapper.appendChild(content);
    return wrapper;
  }

  function renderPostList(container, posts, { emptyText = 'No posts yet.' } = {}) {
    container.replaceChildren();

    if (!posts.length) {
      const empty = document.createElement('div');
      empty.className = 'post-empty';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }

    for (const post of posts) {
      container.appendChild(createPostElement(post));
    }
  }

  function buildPost(blocks) {
    return {
      id: safeId(),
      createdAt: Date.now(),
      blocks
    };
  }

  function deleteFromBottom(posts, nFromBottom) {
    const n = clampInt(nFromBottom, { min: 1, max: 1000000 });
    if (n == null) return { posts, deleted: null };
    const idx = posts.length - n;
    if (idx < 0 || idx >= posts.length) return { posts, deleted: null };
    const deleted = posts[idx];
    const next = posts.slice(0, idx).concat(posts.slice(idx + 1));
    return { posts: next, deleted };
  }

  function enableWheelScroll(scrollRegionEl, scrollTargetEl) {
    const region = scrollRegionEl;
    const target = scrollTargetEl || scrollRegionEl;
    if (!region || !target) return false;
    if (typeof region.addEventListener !== 'function') return false;

    region.addEventListener(
      'wheel',
      (e) => {
        // Preserve browser zoom gesture.
        if (e.ctrlKey) return;

        // Only handle if the target can actually scroll.
        if (target.scrollHeight <= target.clientHeight + 1) return;

        e.preventDefault();

        // Use scrollBy for better compatibility with different scroll modes.
        target.scrollBy({
          top: e.deltaY,
          left: e.deltaX,
          behavior: 'auto'
        });
      },
      { passive: false }
    );

    return true;
  }

  window.SonicPrismPosts = {
    POSTS_KEY,
    MAX_AGE_KEY,
    daysToMs,
    getMaxAgeDays,
    setMaxAgeDays,
    loadPosts,
    savePosts,
    prunePosts,
    sortNewestFirst,
    normalizeHttpUrl,
    normalizeImageSource,
    parseIframeInput,
    createPostElement,
    renderPostList,
    buildPost,
    deleteFromBottom,
    enableWheelScroll
  };
})();
