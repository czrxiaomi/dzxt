/**
 * practice-engine.js
 * 打字练习引擎：逐字比对、绿/红高亮、实时正确率与速度、成绩保存（防重复提交 + 断网草稿重试）
 * 依赖：supabase-init.js、auth.js（window.APP.auth）
 * 暴露：window.APP.practice
 *
 * 比对模型（Lock 模型）：
 * - 将文章正文折叠空白后作为目标字符序列（中文按汉字/标点逐字；英文按字母/空格逐字）。
 * - 学生输入框内容与目标从当前位置做前缀比对；正确字符立即消费（标绿）并从输入框移除；
 * - 首个不匹配字符标红并锁定，学生需要删除错字后继续，避免连锁错位与“越打越乱”。
 * - 同时兼容中文输入法（composition 期间不处理，仅在上屏后比对）。
 */
(function () {
  'use strict';

  window.APP = window.APP || {};
  var APP = window.APP;
  var PENDING_KEY = 'gslw-pending-saves';

  var client = function () {
    if (!APP.supabase) throw new Error(APP.supabaseInitError || '后端服务未初始化');
    return APP.supabase;
  };

  function normalize(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function toast(msg, kind) {
    var host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .4s';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 420);
    }, 3200);
  }

  /* ============ 文章加载 ============ */
  async function loadPassages(opts) {
    opts = opts || {};
    var sb = client();
    var q = sb.from('passages').select('*').eq('enabled', true).order('created_at', { ascending: false }).limit(200);
    var res = await q;
    if (res.error) throw res.error;
    var list = res.data || [];
    if (opts.category && opts.category !== 'all') list = list.filter(function (p) { return p.category === opts.category; });
    if (opts.difficulty) list = list.filter(function (p) { return Number(p.difficulty) === Number(opts.difficulty); });
    return list;
  }

  /* ============ 成绩保存（防重复 + 草稿） ============ */
  function getPending() {
    try {
      var raw = localStorage.getItem(PENDING_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function setPending(arr) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
    } catch (e) { console.warn('[records] 保存草稿失败', e); }
  }

  /**
   * record: { user_id, passage_id, accuracy, speed, raw_speed, keystrokes, errors, duration_sec, finished_at }
   */
  async function saveRecord(record) {
    var sb = client();
    if (!record || !record.user_id) throw new Error('缺少用户信息，无法保存成绩');
    var res = await sb.from('typing_records').insert(record).select();
    if (res.error) throw res.error;
    return res.data && res.data[0];
  }

  async function saveRecordWithDraft(record, sessionUser) {
    var payload = {
      user_id: sessionUser ? sessionUser.id : record.user_id,
      passage_id: record.passage_id || null,
      accuracy: round2(record.accuracy || 0),
      speed: round2(record.speed || 0),
      raw_speed: round2(record.raw_speed || 0),
      keystrokes: record.keystrokes || 0,
      errors: record.errors || 0,
      duration_sec: record.duration_sec || 0,
      finished_at: new Date().toISOString()
    };
    try {
      var saved = await saveRecord(payload);
      // 保存成功：清理该条草稿（同一 id 的旧草稿）
      setPending(getPending().filter(function (d) { return d.draftId !== record.draftId; }));
      return { ok: true, saved: saved };
    } catch (e) {
      // 保存失败：保留本地草稿，供断网恢复后重试
      var list = getPending();
      var draft = {
        draftId: record.draftId || ('d' + Date.now() + Math.floor(Math.random() * 10000)),
        payload: payload,
        createdAt: new Date().toISOString()
      };
      var existed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].draftId === draft.draftId) { list[i] = draft; existed = true; break; }
      }
      if (!existed) list.push(draft);
      setPending(list);
      return { ok: false, error: e };
    }
  }

  async function retryPendingSaves() {
    var list = getPending();
    if (!list.length) return { retried: 0, okCount: 0, failed: 0 };
    var remain = [];
    var okCount = 0;
    for (var i = 0; i < list.length; i++) {
      var dd = list[i];
      try {
        await saveRecord(dd.payload);
        okCount++;
      } catch (e) {
        remain.push(dd);
      }
    }
    setPending(remain);
    return { retried: list.length, okCount: okCount, failed: remain.length };
  }

  function pendingCount() {
    return getPending().length;
  }

  /* ============ 练习引擎 ============ */
  var S = null; // 引擎状态（单实例）

  function start(passage, ui) {
    stop();
    var target = normalize(passage.content);
    if (!target.length) throw new Error('该文章内容为空，无法练习');

    S = {
      passage: passage,
      passageId: passage.id,
      target: target,
      chars: target.split(''),
      N: target.length,
      pos: 0,
      errors: 0,
      prevRestLen: 0,
      composing: false,
      finished: false,
      startAt: Date.now(),
      ui: ui || {},
      lastTick: Date.now(),
      inputEl: ui.inputEl || null
    };
    buildRender();
    refresh();
    tick();
    return S;
  }

  function stop() {
    if (S && S.ui && S.ui.timerId) {
      clearInterval(S.ui.timerId);
      S.ui.timerId = null;
    }
    if (S) S.finished = true;
    S = null;
  }

  function buildRender() {
    var box = S.ui.charsBox;
    if (!box) return;
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < S.chars.length; i++) {
      var span = document.createElement('span');
      span.className = 'ch';
      span.textContent = S.chars[i] === ' ' ? '\u00A0' : S.chars[i];
      span.dataset.idx = String(i);
      frag.appendChild(span);
    }
    box.appendChild(frag);
    if (S.ui.scrollBox) S.ui.scrollBox.scrollTop = 0;
  }

  function refresh() {
    var ui = S.ui;
    var box = ui.charsBox;
    if (box) {
      var spans = box.children;
      var firstVisible = -1;
      var curVisible = -1;
      var visibleTop = box.scrollTop;
      var visibleBottom = visibleTop + box.clientHeight;
      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        var cls = 'ch';
        if (i < S.pos) cls += ' ch-ok';
        else if (i === S.pos) {
          // 存在锁定错误则标红
          cls += (S.errLocked ? ' ch-err' : ' ch-cur');
          curVisible = i;
        } else {
          cls += ' ch-done';
        }
        if (el.className !== cls) el.className = cls;
      }
      // 将当前输入位置滚动到可见区域（每若干字符才滚动，避免抖动）
      if (curVisible >= 0) {
        var curEl = spans[curVisible];
        var rect = curEl.getBoundingClientRect();
        var boxRect = box.getBoundingClientRect();
        if (rect.top < boxRect.top + 8 || rect.bottom > boxRect.bottom - 8) {
          try { curEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
        }
      }
    }
    // 统计条
    var accuracy = S.N ? round2((S.pos / S.N) * 100) : 0;
    var minutes = elapsedMin();
    var speed = minutes > 0 ? round2(S.pos / minutes) : 0;
    if (ui.accEl) ui.accEl.textContent = accuracy.toFixed(1) + '%';
    if (ui.speedEl) ui.speedEl.textContent = String(speed);
    if (ui.errEl) ui.errEl.textContent = String(S.errors);
    if (ui.timeEl) ui.timeEl.textContent = fmtTime(elapsedSec());
    if (ui.progressEl) ui.progressEl.style.width = (S.N ? (S.pos / S.N) * 100 : 0) + '%';
    if (ui.progressTextEl) ui.progressTextEl.textContent = S.pos + ' / ' + S.N;
  }

  function elapsedMs() { return Math.max(0, Date.now() - S.startAt); }
  function elapsedSec() { return Math.round(elapsedMs() / 1000); }
  function elapsedMin() { return elapsedMs() / 60000; }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function tick() {
    if (S.ui.timerId) clearInterval(S.ui.timerId);
    S.ui.timerId = setInterval(function () {
      if (!S || S.finished) { if (S && S.ui.timerId) clearInterval(S.ui.timerId); return; }
      refresh();
    }, 600);
  }

  function setCaretEnd() {
    var el = S.inputEl;
    if (!el) return;
    try {
      var len = el.value.length;
      el.setSelectionRange(len, len);
    } catch (e) { /* ignore */ }
  }

  function handleInput() {
    if (!S || S.finished || S.composing) return;
    var el = S.inputEl;
    if (!el) return;
    var v = el.value || '';
    // 1) 消费正确前缀
    var consumed = 0;
    while (S.pos + consumed < S.N && consumed < v.length && v.charAt(consumed) === S.chars[S.pos + consumed]) {
      consumed++;
    }
    if (consumed > 0) {
      S.pos += consumed;
      var rest = v.slice(consumed);
      el.value = rest;
      setCaretEnd();
      v = rest;
    }
    // 2) 残余错误锁定判定
    if (v.length > 0) {
      var delta = v.length - S.prevRestLen;
      if (delta > 0 && (S.pos >= S.N || v.charAt(0) !== S.chars[S.pos])) {
        S.errors += delta;
      }
      S.errLocked = true;
    } else {
      S.errLocked = false;
    }
    S.prevRestLen = v.length;
    refresh();
    // 3) 完成
    if (S.pos >= S.N) {
      finish();
    }
  }

  function finish() {
    if (S.finished) return;
    S.finished = true;
    if (S.ui.timerId) clearInterval(S.ui.timerId);
    var elapsed = elapsedSec();
    var durSec = Math.max(1, elapsed);
    var minutes = durSec / 60;
    var totalChars = S.N;
    var accuracy = round2((S.pos / totalChars) * 100);
    var speed = round2(S.pos / minutes);
    var rawSpeed = round2((S.pos + S.errors) / minutes);
    var result = {
      passage: S.passage,
      passageId: S.passageId,
      totalChars: totalChars,
      correct: S.pos,
      errors: S.errors,
      accuracy: accuracy,
      speed: speed,
      rawSpeed: rawSpeed,
      keystrokes: S.pos + S.errors,
      durationSec: durSec
    };
    if (S.ui.inputEl) {
      S.ui.inputEl.value = '';
      S.ui.inputEl.disabled = true;
    }
    if (typeof S.ui.onFinish === 'function') {
      try { S.ui.onFinish(result); } catch (e) { console.error('[engine] onFinish error', e); }
    }
    S = null; // 引擎会话结束
  }

  /* ============ 对外 API ============ */
  window.APP.practice = {
    loadPassages: loadPassages,
    saveRecord: saveRecord,
    saveRecordWithDraft: saveRecordWithDraft,
    retryPendingSaves: retryPendingSaves,
    pendingCount: pendingCount,
    start: start,
    stop: stop,
    finishNow: function () { if (S) finish(); },
    isRunning: function () { return !!S && !S.finished; },
    markComposing: function (v) { if (S) S.composing = !!v; },
    handleInputSafe: function () {
      // composition 期间产生的中间输入不处理；此方法供 compositionend 兜底触发
      if (S && S.composing) return;
      if (S) handleInput();
    },
    getState: function () { return S; },
    toast: toast
  };
})();
