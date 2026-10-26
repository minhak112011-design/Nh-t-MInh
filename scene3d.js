/* ==========================================================
   scene3d.js: toàn bộ đồ họa 3D (Three.js r128)
   Công khai ra window.Scene3D:
     setAudio(level, bass)  -> nhạc làm lõi 3D và hạt "thở"
     setScroll(progress)    -> 0..1, camera bay sâu hơn khi cuộn
     zoomIn({onPeak,onDone})-> hiệu ứng camera lao vào khi chạm màn hình chờ
   ========================================================== */
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var isMobile =
    window.matchMedia('(max-width: 820px)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // API dự phòng: trang vẫn chạy bình thường nếu WebGL không dùng được
  var api = {
    ready: false,
    setAudio: function () {},
    setScroll: function () {},
    zoomIn: function (o) {
      o = o || {};
      setTimeout(function () { if (o.onPeak) o.onPeak(); }, 450);
      setTimeout(function () { if (o.onDone) o.onDone(); }, 1000);
    }
  };
  window.Scene3D = api;

  if (!canvas || !window.THREE) {
    document.documentElement.classList.add('no-webgl');
    return;
  }

  var THREE = window.THREE;

  /* ---------- Renderer ---------- */
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !isMobile,
      alpha: false,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    document.documentElement.classList.add('no-webgl');
    return;
  }

  var pixelRatioCap = isMobile ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.setClearColor(0x06070a, 1);

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06070a, 0.014);

  var camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

  var width = window.innerWidth;
  var height = window.innerHeight;

  function resize(force) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    // Trên điện thoại, thanh địa chỉ co giãn làm đổi chiều cao: bỏ qua thay đổi nhỏ
    if (!force && isMobile && w === width && Math.abs(h - height) < 160) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize(true);

  /* ---------- Trạng thái ---------- */
  var state = {
    camZ: 15,
    fov: 60,
    warp: 0,
    punch: 0,
    audio: 0,
    audioT: 0,
    bass: 0,
    bassT: 0,
    scroll: 0,
    scrollT: 0,
    px: 0, py: 0,     // con trỏ / ngón tay đã làm mượt
    tx: 0, ty: 0      // mục tiêu
  };

  /* ---------- Hạt (shader tùy chỉnh, chạy hoàn toàn trên GPU) ---------- */
  var DEPTH = 160;
  var COUNT = reduce ? (isMobile ? 1200 : 3000) : (isMobile ? 2600 : 7000);

  var positions = new Float32Array(COUNT * 3);
  var seeds = new Float32Array(COUNT);
  for (var i = 0; i < COUNT; i++) {
    var a = Math.random() * Math.PI * 2;
    var r = 2.5 + Math.pow(Math.random(), 0.55) * 42;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.sin(a) * r * 0.78;
    positions[i * 3 + 2] = Math.random() * DEPTH;
    seeds[i] = Math.random();
  }

  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  var pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uTravel: { value: 0 },
      uAudio: { value: 0 },
      uPR: { value: renderer.getPixelRatio() },
      uBone: { value: new THREE.Color(0xc9cfd8) },
      uRed: { value: new THREE.Color(0xff2438) }
    },
    vertexShader: [
      'uniform float uTime;',
      'uniform float uTravel;',
      'uniform float uAudio;',
      'uniform float uPR;',
      'attribute float aSeed;',
      'varying float vSeed;',
      'varying float vFade;',
      'const float DEPTH = ' + DEPTH.toFixed(1) + ';',
      'void main() {',
      '  vec3 p = position;',
      '  float ang = atan(p.y, p.x) + uTime * 0.035 * (0.4 + aSeed);',
      '  float rad = length(p.xy) * (1.0 + uAudio * 0.14 * aSeed);',
      '  p.x = cos(ang) * rad;',
      '  p.y = sin(ang) * rad * 0.78;',
      '  p.z = mod(p.z + uTravel, DEPTH) - DEPTH + 14.0;',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  float dist = max(-mv.z, 0.5);',
      '  vFade = smoothstep(0.5, 20.0, dist) * (1.0 - smoothstep(DEPTH * 0.5, DEPTH, dist));',
      '  vSeed = aSeed;',
      '  float size = (1.4 + aSeed * 2.6 + uAudio * 2.2) * uPR * (46.0 / dist);',
      '  gl_PointSize = clamp(size, 1.2 * uPR, 14.0 * uPR);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision mediump float;',
      'uniform vec3 uBone;',
      'uniform vec3 uRed;',
      'varying float vSeed;',
      'varying float vFade;',
      'void main() {',
      '  float d = length(gl_PointCoord - 0.5);',
      '  if (d > 0.5) discard;',
      '  float a = smoothstep(0.5, 0.0, d);',
      '  vec3 col = mix(uBone, uRed, step(0.82, vSeed));',
      '  gl_FragColor = vec4(col, a * vFade * 0.9);',
      '}'
    ].join('\n')
  });

  var points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  /* ---------- Lõi trung tâm ---------- */
  function glowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,80,96,0.7)');
    grad.addColorStop(1, 'rgba(255,36,56,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  var core = new THREE.Group();
  core.position.set(0, 0, -10);
  scene.add(core);

  var shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.7, 1),
    new THREE.MeshBasicMaterial({ color: 0xff2438, wireframe: true, transparent: true, opacity: 0.5 })
  );
  core.add(shell);

  var inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xecebe6, wireframe: true, transparent: true, opacity: 0.38 })
  );
  core.add(inner);

  var nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xff2438 })
  );
  core.add(nucleus);

  var glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xff2438,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  glow.scale.set(9, 9, 1);
  core.add(glow);

  var ringA = new THREE.Mesh(
    new THREE.TorusGeometry(4.5, 0.014, 6, 140),
    new THREE.MeshBasicMaterial({ color: 0xecebe6, transparent: true, opacity: 0.5 })
  );
  ringA.rotation.x = Math.PI / 2.4;
  core.add(ringA);

  var ringB = new THREE.Mesh(
    new THREE.TorusGeometry(5.6, 0.014, 6, 140),
    new THREE.MeshBasicMaterial({ color: 0xff2438, transparent: true, opacity: 0.4 })
  );
  ringB.rotation.y = Math.PI / 2.6;
  core.add(ringB);

  /* ---------- Mảnh hình học lơ lửng ---------- */
  var shardGeos = [
    new THREE.TetrahedronGeometry(0.65),
    new THREE.OctahedronGeometry(0.55),
    new THREE.IcosahedronGeometry(0.5, 0)
  ];
  var shards = [];
  var SHARD_COUNT = isMobile ? 10 : 18;
  for (var s = 0; s < SHARD_COUNT; s++) {
    var red = s % 4 === 0;
    var mesh = new THREE.Mesh(
      shardGeos[s % shardGeos.length],
      new THREE.MeshBasicMaterial({
        color: red ? 0xff2438 : 0xecebe6,
        wireframe: true,
        transparent: true,
        opacity: red ? 0.7 : 0.45
      })
    );
    var ang = Math.random() * Math.PI * 2;
    var rad = 6 + Math.random() * 14;
    mesh.position.set(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.6, -4 - Math.random() * 38);
    mesh.userData = {
      rx: (Math.random() - 0.5) * 0.9,
      ry: (Math.random() - 0.5) * 0.9,
      phase: Math.random() * Math.PI * 2,
      baseY: mesh.position.y,
      amp: 0.3 + Math.random() * 0.7
    };
    var sc = 0.7 + Math.random() * 1.3;
    mesh.scale.set(sc, sc, sc);
    scene.add(mesh);
    shards.push(mesh);
  }

  /* ---------- Điều khiển: chuột và ngón tay ---------- */
  function setPointer(clientX, clientY) {
    state.tx = (clientX / window.innerWidth) * 2 - 1;
    state.ty = (clientY / window.innerHeight) * 2 - 1;
  }
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return; // cảm ứng xử lý riêng bên dưới
    setPointer(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    if (t) setPointer(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (t) setPointer(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchend', function () {
    state.tx = 0;
    state.ty = 0;
  }, { passive: true });

  /* ---------- Tự giảm chất lượng nếu máy yếu ---------- */
  var quality = 2;
  var perfAcc = 0;
  var perfFrames = 0;
  var perfWarmup = 150;

  function applyQuality() {
    var dpr = window.devicePixelRatio || 1;
    var pr = quality === 2 ? Math.min(dpr, pixelRatioCap) : quality === 1 ? Math.min(dpr, 1.25) : 1;
    renderer.setPixelRatio(pr);
    pMat.uniforms.uPR.value = pr;
    renderer.setSize(width, height, false);
    var ratio = quality === 2 ? 1 : quality === 1 ? 0.7 : 0.45;
    pGeo.setDrawRange(0, Math.floor(COUNT * ratio));
  }

  function watchPerf(dt) {
    if (perfWarmup > 0) { perfWarmup--; return; }
    perfAcc += dt;
    perfFrames++;
    if (perfFrames >= 90) {
      var avg = perfAcc / perfFrames;
      if (avg > 0.024 && quality > 0) {
        quality--;
        applyQuality();
      }
      perfAcc = 0;
      perfFrames = 0;
    }
  }

  /* ---------- Vòng lặp render ---------- */
  var clock = new THREE.Clock();
  var travel = 0;
  var lastFov = 60;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) { clock.getDelta(); return; }

    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;
    var k = Math.min(1, dt * 8);

    // Làm mượt các giá trị
    state.audio = lerp(state.audio, state.audioT, Math.min(1, dt * 10));
    state.bass = lerp(state.bass, state.bassT, Math.min(1, dt * 14));
    var prevScroll = state.scroll;
    state.scroll = lerp(state.scroll, state.scrollT, Math.min(1, dt * 4));
    state.px = lerp(state.px, state.tx, Math.min(1, dt * 3.2));
    state.py = lerp(state.py, state.ty, Math.min(1, dt * 3.2));

    // Hạt bay về phía camera
    var motion = reduce ? 0.3 : 1;
    travel += ((6 + state.warp * 150 + state.audio * 8) * dt) * motion;
    travel += (state.scroll - prevScroll) * 90;
    travel = ((travel % DEPTH) + DEPTH) % DEPTH;
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uTravel.value = travel;
    pMat.uniforms.uAudio.value = state.audio;

    // Camera: bay sâu theo cuộn trang, nghiêng theo chuột / ngón tay
    var idle = Math.sin(t * 0.5) * 0.35;
    camera.position.z = state.camZ - state.scroll * 10 + idle;
    camera.position.x = lerp(camera.position.x, state.px * 1.6, k);
    camera.position.y = lerp(camera.position.y, -state.py * 1.0, k);
    camera.lookAt(-state.px * 0.8, state.py * 0.5, -14);

    if (Math.abs(state.fov - lastFov) > 0.01) {
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
      lastFov = state.fov;
    }

    // Lõi phản ứng theo nhạc
    var pulse = 1 + state.bass * 0.38 + state.punch * 0.6;
    core.scale.setScalar(pulse);
    shell.rotation.y += dt * (0.25 + state.audio * 1.4) * motion;
    shell.rotation.x += dt * 0.12 * motion;
    inner.rotation.y -= dt * (0.4 + state.audio * 1.8) * motion;
    inner.rotation.z += dt * 0.2 * motion;
    ringA.rotation.z += dt * 0.35 * motion;
    ringB.rotation.x += dt * 0.28 * motion;
    shell.material.opacity = 0.4 + state.audio * 0.45 + state.punch * 0.3;
    glow.material.opacity = 0.45 + state.bass * 0.5 + state.punch * 0.4;
    var gs = 8 + state.bass * 6 + state.punch * 6;
    glow.scale.set(gs, gs, 1);
    nucleus.scale.setScalar(1 + state.bass * 0.8);
    core.rotation.y = state.px * 0.4;
    core.rotation.x = state.py * 0.25;

    // Mảnh lơ lửng
    for (var n = 0; n < shards.length; n++) {
      var m = shards[n];
      var d = m.userData;
      m.rotation.x += dt * d.rx * (1 + state.audio * 2) * motion;
      m.rotation.y += dt * d.ry * (1 + state.audio * 2) * motion;
      m.position.y = d.baseY + Math.sin(t * 0.6 + d.phase) * d.amp;
    }

    renderer.render(scene, camera);
    watchPerf(dt);
  }

  /* ---------- API công khai ---------- */
  api.ready = true;

  api.setAudio = function (level, bass) {
    state.audioT = Math.max(0, Math.min(1, level || 0));
    state.bassT = Math.max(0, Math.min(1, bass || 0));
  };

  api.setScroll = function (p) {
    state.scrollT = Math.max(0, Math.min(1, p || 0));
  };

  api.zoomIn = function (opts) {
    opts = opts || {};
    var done = function () { if (opts.onDone) opts.onDone(); };
    var peak = function () {
      state.punch = 1;
      if (opts.onPeak) opts.onPeak();
    };

    if (reduce || !window.gsap) {
      state.camZ = 6;
      state.fov = 60;
      peak();
      done();
      return;
    }

    var tl = window.gsap.timeline({ onComplete: done });
    // Lao thẳng vào lõi
    tl.to(state, { camZ: -6.5, fov: 105, warp: 1, duration: 1.25, ease: 'power3.in' });
    tl.add(peak);
    // Bung ra, dừng ở vị trí xem trang
    tl.to(state, { camZ: 6, fov: 60, warp: 0, duration: 1.7, ease: 'expo.out' });
    tl.to(state, { punch: 0, duration: 1.4, ease: 'power2.out' }, '<');
  };

  window.addEventListener('resize', function () { resize(false); });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { resize(true); }, 250);
  });

  // Trạng thái chờ: camera đứng xa, hạt đã chuyển động
  state.camZ = 15;
  frame();
})();
