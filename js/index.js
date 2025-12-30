(() => {
  document.documentElement.dataset.js = 'true';

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
    fetch('/data/posts.json', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(jsonPosts => {
        let posts = Array.isArray(jsonPosts) ? jsonPosts : null;
        
        // Fall back to localStorage if file doesn't exist or is invalid
        if (!posts) {
          posts = api.loadPosts();
        }

        posts = api.prunePosts(posts);
        api.sortNewestFirst(posts);
        posts = seedIfEmpty(posts);

        api.renderPostList(postList, posts);
      })
      .catch(() => {
        // Fall back to localStorage if fetch fails
        let posts = api.loadPosts();
        posts = api.prunePosts(posts);
        api.sortNewestFirst(posts);
        posts = seedIfEmpty(posts);
        api.renderPostList(postList, posts);
      });
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

  function startWowAnimations() {
    // Kill any existing tweens
    if (imgTween) imgTween.kill();
    if (textTween) textTween.kill();

    // Start spinning
    imgTween = gsap.to(wowImg, { rotation: 260 * 360, duration: 30, ease: "sine.inOut" });
    textTween = gsap.to(magicText, { rotation: -260 * 360, duration: 30, ease: "sine.inOut" });
  }

  function rewindWowAnimations() {
    // Kill and rewind
    if (imgTween) imgTween.kill();
    if (textTween) textTween.kill();

    imgTween = gsap.to(wowImg, { rotation: 0, duration: 2, ease: "sine.inOut" });
    textTween = gsap.to(magicText, { rotation: 45, duration: 2, ease: "sine.inOut" });
  }

  // Add hover listeners to the wow image
  wowImg.addEventListener('mouseenter', startWowAnimations);
  wowImg.addEventListener('mouseleave', rewindWowAnimations);
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
