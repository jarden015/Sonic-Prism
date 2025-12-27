(() => {
  document.documentElement.dataset.js = 'true';

  // Logo spin on hover: track mouse position relative to logo center
  const logoImg = document.querySelector('.middle-layer > img');
  if (logoImg) {
    let logoCenterX = 0;
    let logoCenterY = 0;

    function updateLogoCenterPosition() {
      const rect = logoImg.getBoundingClientRect();
      logoCenterX = rect.left + rect.width / 2;
      logoCenterY = rect.top + rect.height / 2;
    }

    updateLogoCenterPosition();
    window.addEventListener('resize', updateLogoCenterPosition);

    document.addEventListener('mousemove', (e) => {
      const spinRadius = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--logo-spin-radius')
      );
      const distX = e.clientX - logoCenterX;
      const distY = e.clientY - logoCenterY;
      const distance = Math.sqrt(distX * distX + distY * distY);

      const isLogoHover = distance <= spinRadius;
      logoImg.classList.toggle('logo-spinning', isLogoHover);
      document.body?.classList.toggle('logo-hover', isLogoHover);
    });
  }

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
