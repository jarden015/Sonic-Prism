(() => {
  document.documentElement.dataset.js = 'true';

  // Logo spin on hover: track mouse position relative to logo center
  const logoImg = document.querySelector('.middle-layer .logo-wrap > img');
  if (logoImg) {
    let logoCenterX = 0;
    let logoCenterY = 0;
    let isLogoHover = false;
    let delayRemaining = 0;
    let currentAmount = 0;
    let cycleProgressMs = 0;
    let rafId = 0;
    let lastFrameAt = 0;

    const starsWrap = document.querySelector('.middle-layer .stars-wrap');
    let starsLayers = starsWrap
      ? Array.from(starsWrap.querySelectorAll('.stars-layer'))
      : [];
    const gsap = window.gsap;
    let starsRotateTween = null;
    let starsStateTween = null;
    let starsGhostConfigKey = '';

    function parseCssTimeToMs(raw) {
      const value = String(raw ?? '').trim();
      if (!value) return 0;
      if (value.endsWith('ms')) return Number.parseFloat(value) || 0;
      if (value.endsWith('s')) return (Number.parseFloat(value) || 0) * 1000;
      const num = Number.parseFloat(value);
      return Number.isFinite(num) ? num * 1000 : 0;
    }

    function parseCssAngleToDeg(raw) {
      const value = String(raw ?? '').trim();
      if (!value) return 0;
      if (value.endsWith('deg')) return Number.parseFloat(value) || 0;
      const num = Number.parseFloat(value);
      return Number.isFinite(num) ? num : 0;
    }

    function parseCssPx(raw) {
      const value = String(raw ?? '').trim();
      if (!value) return 0;
      if (value.endsWith('px')) return Number.parseFloat(value) || 0;
      const num = Number.parseFloat(value);
      return Number.isFinite(num) ? num : 0;
    }

    function parseCssPercentOrNumberToUnit(raw) {
      const value = String(raw ?? '').trim();
      if (!value) return 0;
      if (value.endsWith('%')) {
        const num = Number.parseFloat(value);
        return Number.isFinite(num) ? num / 100 : 0;
      }
      const num = Number.parseFloat(value);
      if (!Number.isFinite(num)) return 0;
      // If they type 35 (meaning 35%), treat as percent.
      return num > 1 ? (num / 100) : num;
    }

    function parseCubicBezier(raw) {
      const value = String(raw ?? '').trim();
      const match = value.match(/cubic-bezier\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*\)/i);
      if (!match) return null;
      const x1 = Number.parseFloat(match[1]);
      const y1 = Number.parseFloat(match[2]);
      const x2 = Number.parseFloat(match[3]);
      const y2 = Number.parseFloat(match[4]);
      if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
      return { x1, y1, x2, y2 };
    }

    function makeCubicBezierEase(x1, y1, x2, y2) {
      function sampleCurveX(t) {
        const invT = 1 - t;
        return (3 * invT * invT * t * x1) + (3 * invT * t * t * x2) + (t * t * t);
      }

      function sampleCurveY(t) {
        const invT = 1 - t;
        return (3 * invT * invT * t * y1) + (3 * invT * t * t * y2) + (t * t * t);
      }

      function sampleCurveDerivativeX(t) {
        const invT = 1 - t;
        return (3 * invT * invT * x1) + (6 * invT * t * (x2 - x1)) + (3 * t * t * (1 - x2));
      }

      function solveTForX(x) {
        let t = x;
        for (let i = 0; i < 8; i++) {
          const xAtT = sampleCurveX(t) - x;
          const dX = sampleCurveDerivativeX(t);
          if (Math.abs(dX) < 1e-6) break;
          t = t - xAtT / dX;
          if (t <= 0) return 0;
          if (t >= 1) return 1;
        }

        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          const xAtMid = sampleCurveX(mid);
          if (Math.abs(xAtMid - x) < 1e-6) return mid;
          if (xAtMid < x) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }

      return (p) => {
        const clamped = Math.max(0, Math.min(1, p));
        const t = solveTForX(clamped);
        return sampleCurveY(t);
      };
    }

    function readStarsVars() {
      const rootStyles = getComputedStyle(document.documentElement);
      const rotationMs = Math.max(1, parseCssTimeToMs(rootStyles.getPropertyValue('--stars-rotation-duration')));
      const trailDeg = Math.max(0, parseCssAngleToDeg(rootStyles.getPropertyValue('--stars-trail-length')));
      const blurRestPx = Math.max(0, parseCssPx(rootStyles.getPropertyValue('--stars-blur-rest')));
      const blurHoverPx = Math.max(0, parseCssPx(rootStyles.getPropertyValue('--stars-blur-hover')));

      const ghostCountRaw = Number.parseFloat(rootStyles.getPropertyValue('--stars-ghost-count'));
      const ghostCount = Math.max(1, Math.min(64, Number.isFinite(ghostCountRaw) ? Math.round(ghostCountRaw) : 1));
      const ghostOpacityLoss = Math.max(0, Math.min(0.95, parseCssPercentOrNumberToUnit(rootStyles.getPropertyValue('--stars-ghost-opacity-loss'))));

      const easeRaw = rootStyles.getPropertyValue('--stars-ease') || rootStyles.getPropertyValue('--logo-spin-ease');
      const bez = parseCubicBezier(easeRaw);
      const easeFn = bez ? makeCubicBezierEase(bez.x1, bez.y1, bez.x2, bez.y2) : 'power2.out';

      // Reuse the existing logo blur in/out durations to keep timing consistent.
      const inMs = Math.max(1, parseCssTimeToMs(rootStyles.getPropertyValue('--logo-blur-in-duration')));
      const outMs = Math.max(1, parseCssTimeToMs(rootStyles.getPropertyValue('--logo-blur-out-duration')));

      return { rotationMs, trailDeg, blurRestPx, blurHoverPx, inMs, outMs, easeFn, ghostCount, ghostOpacityLoss };
    }

    function rebuildStarsGhostLayersIfNeeded(vars) {
      if (!starsWrap) return;
      const nextKey = `${vars.ghostCount}|${vars.ghostOpacityLoss}`;
      if (nextKey === starsGhostConfigKey && starsLayers.length === vars.ghostCount) return;
      starsGhostConfigKey = nextKey;

      // Replace existing layers so the count actually matches the CSS var.
      starsWrap.replaceChildren();
      const loss = vars.ghostOpacityLoss;

      // Simple blur ramp per ghost (kept internal; adjust if you want a new var later)
      const blurStepPx = 1.8;

      for (let i = 0; i < vars.ghostCount; i++) {
        const layer = document.createElement('div');
        layer.className = 'stars-layer';
        layer.dataset.layer = String(i);

        // Each ghost loses a percentage of opacity vs the previous one.
        const opacity = Math.pow(1 - loss, i);
        layer.style.setProperty('--stars-layer-opacity', String(opacity));
        layer.style.setProperty('--stars-layer-extra-blur', `${i * blurStepPx}px`);
        layer.style.setProperty('--stars-layer-offset', '0deg');

        starsWrap.appendChild(layer);
      }

      starsLayers = Array.from(starsWrap.querySelectorAll('.stars-layer'));
    }

    function ensureStarsTween(vars) {
      if (!gsap || !starsWrap) return;
      if (!starsRotateTween) {
        starsRotateTween = gsap.to(starsWrap, {
          rotation: '-=360',
          duration: Math.max(0.001, vars.rotationMs / 1000),
          ease: 'none',
          repeat: -1,
          paused: true
        });
      } else {
        starsRotateTween.duration(Math.max(0.001, vars.rotationMs / 1000));
      }
    }

    function setStarsHoverState(hovered) {
      if (!gsap || !starsWrap) return;

      const vars = readStarsVars();
      rebuildStarsGhostLayersIfNeeded(vars);
      if (!starsLayers.length) return;
      ensureStarsTween(vars);

      const durationSec = (hovered ? vars.inMs : vars.outMs) / 1000;
      const ease = vars.easeFn;

      if (starsStateTween) {
        starsStateTween.kill();
        starsStateTween = null;
      }

      if (hovered) {
        // Always start from the neutral/original orientation.
        starsRotateTween.restart(true);
      } else {
        // Stop the infinite spin so we can animate back to 0deg.
        starsRotateTween.pause();
      }

      const tl = gsap.timeline({ defaults: { duration: durationSec, ease }, overwrite: true });
      tl.to(starsWrap, { '--stars-blur': `${hovered ? vars.blurHoverPx : vars.blurRestPx}px` }, 0);

      if (!hovered) {
        // Rotate back to original position on exit.
        tl.to(starsWrap, { rotation: 0 }, 0);
      }

      // Fake motion blur: offset multiple star layers along the "previous" positions.
      // For counter-clockwise rotation, the trailing positions are slightly clockwise (positive degrees).
      const n = Math.max(1, starsLayers.length - 1);
      for (let i = 0; i < starsLayers.length; i++) {
        const t = i / n;
        const targetOffsetDeg = hovered ? (vars.trailDeg * t) : 0;
        tl.to(starsLayers[i], { '--stars-layer-offset': `${targetOffsetDeg}deg` }, 0);
        
        // Restore original opacity on hover exit
        if (!hovered) {
          const originalOpacity = Math.pow(1 - vars.ghostOpacityLoss, i);
          tl.to(starsLayers[i], { '--stars-layer-opacity': String(originalOpacity) }, 0);
        }
      }

      if (!hovered) {
        tl.eventCallback('onComplete', () => {
          // Hard reset ensures next hover begins from the same visual orientation.
          starsRotateTween.pause(0);
          gsap.set(starsWrap, { rotation: 0 });
        });
      }

      starsStateTween = tl;
    }

    function readLogoColorVars() {
      const rootStyles = getComputedStyle(document.documentElement);
      const hueStart = parseCssAngleToDeg(rootStyles.getPropertyValue('--logo-color-hue-start'));
      const hueEnd = parseCssAngleToDeg(rootStyles.getPropertyValue('--logo-color-hue-end'));
      return {
        delayMs: parseCssTimeToMs(rootStyles.getPropertyValue('--logo-color-delay')),
        inMs: parseCssTimeToMs(rootStyles.getPropertyValue('--logo-color-in-duration')),
        outMs: parseCssTimeToMs(rootStyles.getPropertyValue('--logo-color-out-duration')),
        cycleMs: Math.max(1, parseCssTimeToMs(rootStyles.getPropertyValue('--logo-color-cycle-duration'))),
        hueStart,
        hueEnd,
        hueRange: hueEnd - hueStart,
        sepia: Number.parseFloat(rootStyles.getPropertyValue('--logo-color-sepia')) || 0,
        saturation: Number.parseFloat(rootStyles.getPropertyValue('--logo-color-saturation')) || 1,
        brightness: Number.parseFloat(rootStyles.getPropertyValue('--logo-color-brightness')) || 1,
        contrast: Number.parseFloat(rootStyles.getPropertyValue('--logo-color-contrast')) || 1
      };
    }

    function buildFilter(vars, amount, hueDeg) {
      const t = Math.max(0, Math.min(1, amount));
      const sepiaStrength = Math.max(0, Math.min(1, vars.sepia));
      const sepia = sepiaStrength * t;
      const saturation = 1 + (vars.saturation - 1) * t;
      const brightness = 1 + (vars.brightness - 1) * t;
      const contrast = 1 + (vars.contrast - 1) * t;

      // Pre-darken bright pixels so they can accept color tint better (especially for purple/blue),
      // then re-brighten after tinting. This prevents bright whites from staying white-ish at all hues.
      const preDarken = 0.7 * t;
      const postBrighten = (1 / 0.7) * t;
      const finalBrightness = 1 - preDarken + (brightness - 1) * t + (postBrighten - t);
      
      return `brightness(${1 - preDarken}) contrast(${contrast}) sepia(${sepia}) hue-rotate(${hueDeg}deg) saturate(${saturation}) brightness(${finalBrightness})`;
    }

    function ensureRaf() {
      if (rafId) return;
      lastFrameAt = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function tick(now) {
      rafId = 0;
      const dt = Math.min(50, Math.max(0, now - lastFrameAt)); // Cap dt to avoid jumps
      lastFrameAt = now;

      const vars = readLogoColorVars();

      // Determine target amount and speed
      let targetAmount;
      let speedMs;

      if (isLogoHover) {
        // Hovering: wait for delay, then fade in to 1
        if (delayRemaining > 0) {
          delayRemaining = Math.max(0, delayRemaining - dt);
          targetAmount = 0;
          speedMs = vars.inMs;
        } else {
          targetAmount = 1;
          speedMs = vars.inMs;
        }
      } else {
        // Not hovering: fade out to 0
        targetAmount = 0;
        speedMs = vars.outMs;
      }

      // Smoothly move currentAmount toward target
      if (currentAmount !== targetAmount) {
        const maxDelta = dt / Math.max(1, speedMs);
        if (currentAmount < targetAmount) {
          currentAmount = Math.min(targetAmount, currentAmount + maxDelta);
        } else {
          currentAmount = Math.max(targetAmount, currentAmount - maxDelta);
        }
      }

      // Cycle hue once, then hold at the end
      if (currentAmount > 0) {
        cycleProgressMs = Math.min(cycleProgressMs + dt, vars.cycleMs);
      }
      const hueDeg = vars.hueStart + vars.hueRange * (cycleProgressMs / vars.cycleMs);

      // Apply filter
      if (currentAmount <= 0.001) {
        logoImg.style.removeProperty('filter');
        currentAmount = 0;
      } else {
        logoImg.style.setProperty('filter', buildFilter(vars, currentAmount, hueDeg), 'important');
      }

      // Continue animation if needed
      if (isLogoHover || currentAmount > 0 || delayRemaining > 0) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function updateLogoCenterPosition() {
      const rect = logoImg.getBoundingClientRect();
      logoCenterX = rect.left + rect.width / 2;
      logoCenterY = rect.top + rect.height / 2;
    }

    updateLogoCenterPosition();
    window.addEventListener('resize', updateLogoCenterPosition);

    // Initialize star opacity on page load
    const initialVars = readStarsVars();
    rebuildStarsGhostLayersIfNeeded(initialVars);

    document.addEventListener('mousemove', (e) => {
      const spinRadius = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--logo-spin-radius')
      );
      const distX = e.clientX - logoCenterX;
      const distY = e.clientY - logoCenterY;
      const distance = Math.sqrt(distX * distX + distY * distY);

      const nextHover = distance <= spinRadius;
      if (nextHover === isLogoHover) return;
      isLogoHover = nextHover;

      if (isLogoHover) {
        // Only apply delay if starting from zero (fresh hover)
        if (currentAmount <= 0.001) {
          const vars = readLogoColorVars();
          delayRemaining = vars.delayMs;
          cycleProgressMs = 0;
        }
        // If currentAmount > 0 (resuming from fade-out), no delay, just reverse direction
      }
      // When exiting hover, direction just reverses naturally

      ensureRaf();

      logoImg.classList.toggle('logo-spinning', isLogoHover);
      document.body?.classList.toggle('logo-hover', isLogoHover);

      // Stars: same hover area as logo
      setStarsHoverState(isLogoHover);
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
