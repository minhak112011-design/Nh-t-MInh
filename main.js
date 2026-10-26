/* ==========================================================
   main.js: màn hình chờ, nhạc nền + sóng nhạc, GSAP, thẻ nghiêng 3D
   ========================================================== */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTouch = window.matchMedia('(pointer: coarse)').matches;
  var hasGsap = !!window.gsap;
  var hasST = hasGsap && !!window.ScrollTrigger;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  if (hasGsap && hasST) window.gsap.registerPlugin(window.ScrollTrigger);

  var scene3d = window.Scene3D || { setAudio: function () {}, setScroll: function () {}, zoomIn: function (o) { if (o && o.onPeak) o.onPeak(); if (o && o.onDone) o.onDone(); } };

  /* ==========================================================
     1. Ảnh đại diện: có ảnh dự phòng nếu chưa bỏ file vào
     ========================================================== */
  var FALLBACK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">' +
    '<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#2a0a10"/><stop offset="1" stop-color="#06070a"/></radialGradient></defs>' +
    '<rect width="800" height="1000" fill="url(#g)"/>' +
    '<circle cx="400" cy="430" r="230" fill="none" stroke="#ff2438" stroke-width="6"/>' +
    '<circle cx="400" cy="430" r="280" fill="none" stroke="#ecebe6" stroke-opacity=".3" stroke-width="2" stroke-dasharray="14 18"/>' +
    '<text x="400" y="500" text-anchor="middle" font-family="Impact,Arial Narrow,sans-serif" font-size="230" fill="#ecebe6">NM</text>' +
    '<text x="400" y="800" text-anchor="middle" font-family="Arial,sans-serif" font-size="44" fill="#8d9bad">Nhật Minh</text>' +
    '</svg>'
  );

  $$('img[data-avatar]').forEach(function (img) {
    var swap = function () {
      if (img.dataset.fb) return;
      img.dataset.fb = '1';
      img.src = FALLBACK_AVATAR;
    };
    img.addEventListener('error', swap);
    if (img.complete && img.naturalWidth === 0) swap();
  });

  /* ==========================================================
     2. Nhạc nền + sóng nhạc (Web Audio API)
     ========================================================== */
  var audio = $('#bgm');
  var player = $('#player');
  var playerBtn = $('#playerBtn');
  var barsCanvas = $('#bars');
  var barsCtx = barsCanvas.getContext('2d');

  var actx = null;
  var analyser = null;
  var freq = null;
  var playing = false;
  var synthetic = false;
  var zeroFrames = 0;
  var BAR_COUNT = 14;
  var bars = new Float32Array(BAR_COUNT);
  var gradient = null;

  audio.volume = 0.85;

  function setupAudioGraph() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      actx = new AC();
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      freq = new Uint8Array(analyser.frequencyBinCount);
      var src = actx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(actx.destination);
    } catch (err) {
      actx = null;
      analyser = null;
    }
  }

  function updatePlayerUI() {
    player.classList.toggle('is-playing', playing);
    playerBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playerBtn.setAttribute('aria-label', playing ? 'Tắt nhạc nền' : 'Bật nhạc nền');
  }

  // Phải gọi trực tiếp trong sự kiện chạm để vượt cơ chế chặn autoplay
  function startMusic() {
    setupAudioGraph();
    if (actx && actx.state !== 'running') {
      try { actx.resume(); } catch (e) { /* bỏ qua */ }
    }
    var p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(function () { playing = true; updatePlayerUI(); })
       .catch(function () { playing = false; updatePlayerUI(); });
    } else {
      playing = !audio.paused;
      updatePlayerUI();
    }
  }

  function toggleMusic() {
    if (audio.paused) {
      startMusic();
    } else {
      audio.pause();
    }
  }

  audio.addEventListener('play', function () { playing = true; updatePlayerUI(); });
  audio.addEventListener('pause', function () { playing = false; updatePlayerUI(); });
  playerBtn.addEventListener('click', toggleMusic);

  // Khi quay lại tab, đảm bảo AudioContext chạy tiếp
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && playing && actx && actx.state !== 'running') {
      try { actx.resume(); } catch (e) { /* bỏ qua */ }
    }
  });

  // Canvas sóng nhạc sắc nét trên màn hình retina
  function sizeBars() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = barsCanvas.clientWidth || 64;
    var h = barsCanvas.clientHeight || 28;
    barsCanvas.width = Math.round(w * dpr);
    barsCanvas.height = Math.round(h * dpr);
    barsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gradient = barsCtx.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, '#ecebe6');
    gradient.addColorStop(1, '#ff2438');
  }
  sizeBars();
  window.addEventListener('resize', sizeBars);

  function readSpectrum() {
    var out = { level: 0, bass: 0 };
    var t = performance.now() / 1000;
    var i, lo, hi, j, sum;

    if (!playing) {
      for (i = 0; i < BAR_COUNT; i++) bars[i] += (0 - bars[i]) * 0.12;
      return out;
    }

    var useSynthetic = synthetic || !analyser;

    if (!useSynthetic) {
      analyser.getByteFrequencyData(freq);
      var total = 0;
      for (i = 0; i < freq.length; i++) total += freq[i];
      // Mở file trực tiếp (file://) có thể làm analyser trả về toàn số 0
      if (total === 0 && audio.currentTime > 0.6 && !audio.paused) {
        zeroFrames++;
        if (zeroFrames > 120) synthetic = true;
      } else {
        zeroFrames = 0;
      }
    }

    if (useSynthetic) {
      var beat = Math.pow((Math.sin(t * Math.PI * 2 * 2) + 1) / 2, 3);
      for (i = 0; i < BAR_COUNT; i++) {
        var v = 0.22 + 0.5 * Math.abs(Math.sin(t * 3 + i * 0.7)) * (0.6 + 0.4 * beat);
        bars[i] += (v - bars[i]) * 0.3;
      }
      out.bass = 0.25 + beat * 0.6;
      out.level = 0.3 + beat * 0.3;
      return out;
    }

    for (i = 0; i < BAR_COUNT; i++) {
      lo = Math.floor(1 + Math.pow(i / BAR_COUNT, 1.7) * 70);
      hi = Math.max(lo + 1, Math.floor(1 + Math.pow((i + 1) / BAR_COUNT, 1.7) * 70));
      sum = 0;
      for (j = lo; j < hi; j++) sum += freq[j];
      var val = sum / (hi - lo) / 255;
      bars[i] += (val - bars[i]) * 0.45;
    }

    var bsum = 0;
    for (j = 1; j <= 5; j++) bsum += freq[j];
    out.bass = Math.min(1, Math.pow(bsum / 5 / 255, 1.4) * 1.25);

    var all = 0;
    for (i = 0; i < BAR_COUNT; i++) all += bars[i];
    out.level = Math.min(1, (all / BAR_COUNT) * 1.5);
    return out;
  }

  function drawBars() {
    var w = barsCanvas.clientWidth || 64;
    var h = barsCanvas.clientHeight || 28;
    barsCtx.clearRect(0, 0, w, h);
    var gap = 2;
    var bw = (w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
    barsCtx.fillStyle = gradient || '#ff2438';
    for (var i = 0; i < BAR_COUNT; i++) {
      var bh = Math.max(2, Math.min(1, bars[i] * 1.35) * h);
      var x = i * (bw + gap);
      barsCtx.fillRect(x, (h - bh) / 2, bw, bh);
    }
  }

  function audioLoop() {
    requestAnimationFrame(audioLoop);
    if (document.hidden) return;
    var s = readSpectrum();
    drawBars();
    scene3d.setAudio(s.level, s.bass);
  }
  audioLoop();

  /* ==========================================================
     3. Nghiêng 3D: chuột dùng VanillaTilt, cảm ứng dùng bản nhỏ tự viết
     ========================================================== */
  var tiltEls = $$('[data-tilt]');

  function touchTilt(el) {
    var max = 10;
    var active = false;

    function apply(e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transition = 'transform 0.08s linear';
      el.style.transform =
        'perspective(900px) rotateX(' + (-y * max * 2).toFixed(2) + 'deg) rotateY(' + (x * max * 2).toFixed(2) + 'deg) scale3d(1.02,1.02,1.02)';
    }
    function reset() {
      active = false;
      el.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)';
      el.style.transform = '';
    }

    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      active = true;
      apply(e);
    });
    el.addEventListener('pointermove', function (e) {
      if (!active || e.pointerType === 'mouse') return;
      apply(e);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.addEventListener(ev, function (e) {
        if (e.pointerType === 'mouse') return;
        reset();
      });
    });
  }

  if (isTouch) {
    tiltEls.forEach(touchTilt);
  } else if (window.VanillaTilt) {
    window.VanillaTilt.init(tiltEls, {
      max: 13,
      speed: 450,
      perspective: 900,
      scale: 1.02,
      glare: true,
      'max-glare': 0.22
    });
  }

  /* ==========================================================
     4. Sóng sáng khi chạm vào nút liên hệ
     ========================================================== */
  $$('.btn3d').forEach(function (btn) {
    var face = $('.btn3d__face', btn);
    btn.addEventListener('pointerdown', function (e) {
      var r = face.getBoundingClientRect();
      var x = e.clientX - r.left;
      var y = e.clientY - r.top;
      [false, true].forEach(function (late) {
        var rip = document.createElement('span');
        rip.className = 'ripple' + (late ? ' ripple--late' : '');
        rip.style.left = x + 'px';
        rip.style.top = y + 'px';
        face.appendChild(rip);
        rip.addEventListener('animationend', function () { rip.remove(); });
      });
    });
  });

  /* ==========================================================
     5. Hiệu ứng glitch cho tên
     ========================================================== */
  var nameEl = $('.hero__name');
  var glitchTimer = null;

  function glitchBurst() {
    nameEl.classList.add('is-glitching');
    setTimeout(function () { nameEl.classList.remove('is-glitching'); }, 520);
  }
  function glitchLoop() {
    glitchBurst();
    glitchTimer = setTimeout(glitchLoop, 2800 + Math.random() * 3600);
  }
  nameEl.addEventListener('pointerenter', function () {
    if (!reduce) glitchBurst();
  });
  nameEl.addEventListener('pointerdown', function () {
    if (!reduce) glitchBurst();
  });

  /* ==========================================================
     6. Trạng thái ẩn ban đầu (chỉ đặt bằng JS, nên nếu JS lỗi nội dung vẫn hiện)
     ========================================================== */
  var heroTargets = {
    lines: $$('.hero__name .line'),
    tagline: $('.hero__tagline'),
    tags: $$('.tag-item'),
    avatar: $('.avatar-wrap'),
    cue: $('.scroll-cue'),
    player: player
  };

  if (hasGsap && !reduce) {
    var g = window.gsap;
    g.set(heroTargets.lines, { yPercent: 120, rotationX: -80, transformOrigin: '50% 100%' });
    g.set(heroTargets.tagline, { autoAlpha: 0, y: 20 });
    g.set(heroTargets.tags, { autoAlpha: 0, scale: 0.5 });
    g.set(heroTargets.avatar, { autoAlpha: 0, rotationY: -75, z: -400, transformPerspective: 900 });
    g.set(heroTargets.cue, { autoAlpha: 0 });
    g.set(heroTargets.player, { autoAlpha: 0, scale: 0.6, transformOrigin: '100% 100%' });
  } else {
    // Không GSAP hoặc giảm chuyển động: hiện ngay
    player.style.opacity = '1';
  }

  /* ==========================================================
     7. Màn hình chờ -> vào trang
     ========================================================== */
  var splash = $('#splash');
  var entered = false;

  function unlockScroll() {
    document.documentElement.classList.remove('is-locked');
    document.body.classList.remove('is-locked');
    if (hasST) window.ScrollTrigger.refresh();
  }

  function introHero() {
    if (!hasGsap || reduce) {
      unlockScroll();
      initScrollEffects();
      if (!reduce) glitchLoop();
      return;
    }
    var g = window.gsap;
    var tl = g.timeline({
      defaults: { ease: 'expo.out' },
      onComplete: function () {
        unlockScroll();
        initScrollEffects();
        glitchTimer = setTimeout(glitchLoop, 900);
      }
    });
    tl.to(heroTargets.avatar, { autoAlpha: 1, rotationY: 0, z: 0, duration: 1.7 }, 0)
      .to(heroTargets.lines, { yPercent: 0, rotationX: 0, duration: 1.3, stagger: 0.14 }, 0.15)
      .to(heroTargets.tagline, { autoAlpha: 1, y: 0, duration: 1 }, 0.7)
      .to(heroTargets.tags, { autoAlpha: 1, scale: 1, duration: 0.8, stagger: 0.09, ease: 'back.out(2)' }, 0.85)
      .to(heroTargets.cue, { autoAlpha: 1, duration: 0.8 }, 1.3)
      .to(heroTargets.player, { autoAlpha: 1, scale: 1, duration: 0.8, ease: 'back.out(2)' }, 1.2);
  }

  function enter() {
    if (entered) return;
    entered = true;

    startMusic();

    // Mở khóa cuộn sớm một chút để ScrollTrigger đo đúng chiều cao
    if (hasGsap) {
      window.gsap.to(splash, {
        autoAlpha: 0,
        scale: 1.7,
        duration: 0.95,
        delay: 0.2,
        ease: 'power3.in',
        onComplete: function () { splash.remove(); }
      });
    } else {
      splash.style.display = 'none';
    }

    scene3d.zoomIn({
      onPeak: introHero,
      onDone: function () { /* camera đã vào vị trí xem trang */ }
    });
  }

  splash.addEventListener('click', enter);
  $('#enterBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    enter();
  });

  /* ==========================================================
     8. Hiệu ứng khi cuộn
     ========================================================== */
  var scrollFxReady = false;

  function initScrollEffects() {
    if (scrollFxReady) return;
    scrollFxReady = true;

    // Đồng bộ camera 3D với tiến độ cuộn
    var maxScroll = function () {
      return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        scene3d.setScroll(window.scrollY / maxScroll());
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Làm mờ nhẹ hero khi cuộn qua
    if (!hasGsap || !hasST || reduce) return;
    var g = window.gsap;

    // Đoạn giới thiệu: chữ sáng dần theo cuộn
    var lead = $('.about__lead');
    var words = lead.textContent.trim().split(/\s+/);
    lead.textContent = '';
    words.forEach(function (w, i) {
      var span = document.createElement('span');
      span.className = 'w';
      span.textContent = w;
      lead.appendChild(span);
      if (i < words.length - 1) lead.appendChild(document.createTextNode(' '));
    });
    g.fromTo($$('.about__lead .w'), { opacity: 0.18 }, {
      opacity: 1,
      ease: 'none',
      stagger: 0.12,
      scrollTrigger: {
        trigger: lead,
        start: 'top 85%',
        end: 'bottom 50%',
        scrub: true
      }
    });

    // Tiêu đề: lộ ra từ trái sang phải
    $$('.sec-title').forEach(function (title) {
      g.fromTo(title,
        { clipPath: 'inset(0 100% 0 0)' },
        {
          clipPath: 'inset(0 0% 0 0)',
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: { trigger: title, start: 'top 88%', once: true }
        });
    });

    // Bảng tính cách
    g.from('.about__panel', {
      autoAlpha: 0,
      rotationY: 25,
      transformPerspective: 900,
      transformOrigin: '0% 50%',
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: '.about__panel', start: 'top 88%', once: true }
    });

    // Thẻ dịch vụ: gập phẳng từ dưới lên
    g.from('.card-wrap', {
      autoAlpha: 0,
      y: 70,
      rotationX: -35,
      transformPerspective: 900,
      transformOrigin: '50% 100%',
      duration: 1.1,
      stagger: 0.15,
      ease: 'expo.out',
      scrollTrigger: { trigger: '.cards', start: 'top 85%', once: true }
    });

    // Nút liên hệ
    g.from('.btn-wrap', {
      autoAlpha: 0,
      y: 50,
      scale: 0.9,
      duration: 1,
      stagger: 0.18,
      ease: 'back.out(1.6)',
      scrollTrigger: { trigger: '.links', start: 'top 90%', once: true }
    });

    // Khung avatar dịch nhẹ theo cuộn
    g.to('.hero__visual', {
      yPercent: -12,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });

    window.addEventListener('load', function () { window.ScrollTrigger.refresh(); });
  }

  // Cuộn mượt khi bấm "Cuộn xuống"
  $('.scroll-cue').addEventListener('click', function (e) {
    var target = $('#about');
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
})();
