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
      // Allow 0 to mean "never truncate"
      const n = clampInt(raw, { min: 0, max: 3650 });
      return n ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setMaxAgeDays(days) {
    // Allow 0 to mean "never truncate"
    const n = clampInt(days, { min: 0, max: 3650 });
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
    function toStickyPosition(raw) {
      const n = Number.parseInt(String(raw), 10);
      if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
      if (n < 1) return 1;
      return n;
    }

    posts.sort((a, b) => {
      const aSticky = a?.sticky === true;
      const bSticky = b?.sticky === true;

      if (aSticky && !bSticky) return -1;
      if (!aSticky && bSticky) return 1;

      // When both are sticky, order by explicit position (ascending), then newest.
      if (aSticky && bSticky) {
        const aPos = toStickyPosition(a?.stickyPosition);
        const bPos = toStickyPosition(b?.stickyPosition);
        if (aPos !== bPos) return aPos - bPos;
        return (b?.createdAt || 0) - (a?.createdAt || 0);
      }

      // Non-sticky posts remain strictly chronological (newest first).
      return (b?.createdAt || 0) - (a?.createdAt || 0);
    });

    return posts;
  }

  function prunePosts(posts, maxAgeDays = getMaxAgeDays()) {
    // 0 means never truncate
    if (maxAgeDays === 0) return posts.filter((p) => typeof p?.createdAt === 'number');
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

  function sanitizeRichTextHtml(raw) {
    const input = String(raw || '');
    if (!input.trim()) return '';

    // Allow only simple inline formatting + links + line breaks.
    // Everything else is unwrapped to plain text, with block-ish elements becoming line breaks.
    const ALLOWED_INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'br', 'a']);
    const BLOCKISH = new Set(['div', 'p', 'section', 'article', 'header', 'footer', 'aside', 'main', 'li', 'ul', 'ol']);

    function appendBreak(parent) {
      const last = parent.lastChild;
      if (last && last.nodeType === Node.ELEMENT_NODE && last.tagName.toLowerCase() === 'br') return;
      parent.appendChild(document.createElement('br'));
    }

    function safeLinkHref(href) {
      const normalized = normalizeHttpUrl(href);
      return normalized || null;
    }

    function normalizeSpanWrapper(spanEl, parentOut) {
      const style = String(spanEl.getAttribute('style') || '').toLowerCase();

      const isBold = /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
      const isItalic = /font-style\s*:\s*italic/.test(style);
      const isUnderline = /text-decoration\s*:\s*underline/.test(style);
      const isStrike = /text-decoration\s*:\s*(line-through|strikethrough)/.test(style);

      let out = parentOut;
      if (isBold) {
        const el = document.createElement('strong');
        out.appendChild(el);
        out = el;
      }
      if (isItalic) {
        const el = document.createElement('em');
        out.appendChild(el);
        out = el;
      }
      if (isUnderline) {
        const el = document.createElement('u');
        out.appendChild(el);
        out = el;
      }
      if (isStrike) {
        const el = document.createElement('s');
        out.appendChild(el);
        out = el;
      }

      for (const child of Array.from(spanEl.childNodes)) {
        cleanNode(child, out);
      }
    }

    function cleanNode(node, parentOut) {
      if (!node) return;

      if (node.nodeType === Node.TEXT_NODE) {
        parentOut.appendChild(document.createTextNode(node.nodeValue || ''));
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const tag = node.tagName.toLowerCase();

      if (tag === 'br') {
        parentOut.appendChild(document.createElement('br'));
        return;
      }

      if (tag === 'span') {
        normalizeSpanWrapper(node, parentOut);
        return;
      }

      if (ALLOWED_INLINE.has(tag)) {
        if (tag === 'a') {
          const href = safeLinkHref(node.getAttribute('href'));
          if (!href) {
            for (const child of Array.from(node.childNodes)) {
              cleanNode(child, parentOut);
            }
            return;
          }

          const a = document.createElement('a');
          a.href = href;
          a.rel = 'noopener noreferrer';
          a.target = '_blank';
          for (const child of Array.from(node.childNodes)) {
            cleanNode(child, a);
          }
          parentOut.appendChild(a);
          return;
        }

        const el = document.createElement(tag);
        for (const child of Array.from(node.childNodes)) {
          cleanNode(child, el);
        }
        parentOut.appendChild(el);
        return;
      }

      // Block-ish elements: preserve separation with line breaks.
      if (BLOCKISH.has(tag)) {
        appendBreak(parentOut);
        for (const child of Array.from(node.childNodes)) {
          cleanNode(child, parentOut);
        }
        appendBreak(parentOut);
        return;
      }

      // Unknown/disallowed: unwrap to its children.
      for (const child of Array.from(node.childNodes)) {
        cleanNode(child, parentOut);
      }
    }

    let doc;
    try {
      doc = new DOMParser().parseFromString(input, 'text/html');
    } catch {
      return '';
    }

    const out = document.createElement('div');
    for (const child of Array.from(doc.body.childNodes)) {
      cleanNode(child, out);
    }

    // Trim leading/trailing breaks.
    while (out.firstChild && out.firstChild.nodeType === Node.ELEMENT_NODE && out.firstChild.tagName.toLowerCase() === 'br') {
      out.removeChild(out.firstChild);
    }
    while (out.lastChild && out.lastChild.nodeType === Node.ELEMENT_NODE && out.lastChild.tagName.toLowerCase() === 'br') {
      out.removeChild(out.lastChild);
    }

    return out.innerHTML;
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

    if (post?.sticky === true) {
      const sticky = document.createElement('span');
      sticky.className = 'post-sticky-label';
      sticky.textContent = 'Stickied';
      meta.appendChild(sticky);
    }

    const content = document.createElement('div');
    content.className = 'post-content';

    for (const block of post.blocks || []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        if (block.rich === true) {
          const el = document.createElement('div');
          el.className = 'post-text';
          el.innerHTML = sanitizeRichTextHtml(block.text);
          content.appendChild(el);
        } else {
          const p = document.createElement('p');
          p.className = 'post-text';
          p.textContent = block.text;
          content.appendChild(p);
        }
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
      sticky: false,
      stickyPosition: null,
      blocks
    };
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
    sanitizeRichTextHtml,
    createPostElement,
    renderPostList,
    buildPost,
    enableWheelScroll
  };
})();
