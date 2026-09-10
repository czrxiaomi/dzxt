/**
 * watermark.js
 * 1) 页面底层极淡水印「大家好我是小咪--@bilibili制作」（文字来自 config.js WATERMARK）
 * 2) 华为式氛围粒子漂浮光效（canvas，克制淡雅）
 * 自动执行：页面加载后自动注入，无需额外调用。
 */
(function () {
  'use strict';

  function getText() {
    try {
      var cfg = window.APP_CONFIG || {};
      return cfg.WATERMARK || '大家好我是小咪--@bilibili制作';
    } catch (e) {
      return '大家好我是小咪--@bilibili制作';
    }
  }

  function mountWatermark() {
    if (document.getElementById('wm-ambient')) return;
    var text = getText();

    // 背景氛围水印（居中大字，极低透明度，铺在页面底层）
    var ambient = document.createElement('div');
    ambient.id = 'wm-ambient';
    ambient.className = 'wm-ambient';
    ambient.setAttribute('aria-hidden', 'true');
    ambient.textContent = text;
    document.body.appendChild(ambient);

    // 底部小字水印
    var foot = document.createElement('div');
    foot.id = 'wm-foot';
    foot.className = 'wm-foot';
    foot.setAttribute('aria-hidden', 'true');
    foot.textContent = text;
    document.body.appendChild(foot);
  }

  function initParticles() {
    if (document.getElementById('fx-particles')) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'fx-particles';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var W = 0;
    var H = 0;
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var particles = [];
    var reduced = false;
    try {
      reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { /* ignore */ }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn() {
      var count = Math.min(46, Math.max(10, Math.floor((W * H) / 32000)));
      particles = [];
      var colors = [
        'rgba(130,170,220,',   // 淡蓝
        'rgba(150,190,230,',   // 天蓝
        'rgba(170,205,240,',   // 浅蓝
        'rgba(255,214,170,',   // 极淡暖橙
        'rgba(190,215,250,'    // 雾蓝
      ];
      for (var i = 0; i < count; i++) {
        var r = 0.7 + Math.random() * 1.8;
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: r,
          vx: (Math.random() - 0.5) * 0.16,
          vy: -(0.05 + Math.random() * 0.22),
          alpha: 0.10 + Math.random() * 0.22,
          pulse: Math.random() * Math.PI * 2,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }
    }

    function frame(now) {
      if (reduced) return; // 用户偏好减少动效时保持静态
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += 0.012;
        if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
        if (p.x < -8) p.x = W + 8;
        if (p.x > W + 8) p.x = -8;
        var a = p.alpha * (0.72 + 0.28 * Math.sin(p.pulse));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + a + ')';
        ctx.fill();
        // 极淡光晕
        if (p.r > 1.6) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = p.color + (a * 0.18) + ')';
          ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    }

    function start() {
      resize();
      spawn();
      if (!reduced) requestAnimationFrame(frame);
    }

    var timer = null;
    window.addEventListener('resize', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        resize();
        spawn();
      }, 160);
    }, false);

    start();
  }

  function mount() {
    mountWatermark();
    initParticles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, false);
  } else {
    mount();
  }
})();
