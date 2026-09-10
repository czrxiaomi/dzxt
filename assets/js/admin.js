/**
 * admin.js — 后端管理系统（管理端 CRUD 与统计）
 * 依赖：supabase-init.js、auth.js（APP.auth）、practice-engine.js 的 toast 能力
 * 页面需先完成 guardAdmin() 校验，再调用 APP.admin.init()
 * 暴露：window.APP.admin
 */
(function () {
  'use strict';

  window.APP = window.APP || {};
  var APP = window.APP;

  function client() {
    if (!APP.supabase) throw new Error(APP.supabaseInitError || '后端服务未初始化');
    return APP.supabase;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function r1(n) { return Math.round(Number(n || 0) * 10) / 10; }
  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function toast(msg, kind) { if (APP.practice) APP.practice.toast(msg, kind); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  var state = {
    students: [],
    passages: [],
    records: [],
    studentFilter: '',
    passageDraft: null, // 正在编辑的文章（null=新增）
    statMode: 'passage'
  };

  /* ============ 学生管理 ============ */
  async function loadStudents() {
    var res = await client().from('profiles')
      .select('id,email,full_name,student_no,class_name,role,is_active,created_at')
      .order('created_at', { ascending: false }).limit(2000);
    if (res.error) throw res.error;
    state.students = res.data || [];
  }

  function renderStudents() {
    var box = $('students-tbody');
    if (!box) return;
    var kw = state.studentFilter.trim().toLowerCase();
    var list = state.students.filter(function (s) {
      if (!kw) return true;
      return [s.full_name, s.student_no, s.class_name, s.email, s.role].some(function (v) {
        return String(v || '').toLowerCase().indexOf(kw) >= 0;
      });
    });
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('tr', '', '<td colspan="8" class="empty-tip">未找到学生记录</td>'));
      return;
    }
    list.forEach(function (s) {
      var tr = document.createElement('tr');
      var roleBadge = s.role === 'admin' ? '<span class="badge badge-off">管理员</span>'
        : s.role === 'teacher' ? '<span class="badge badge-soft">教师</span>'
        : '<span class="badge badge-chinese">学生</span>';
      var statusBadge = s.is_active === false
        ? '<span class="badge badge-off">已停用</span>'
        : '<span class="badge badge-english">正常</span>';
      tr.innerHTML =
        '<td><strong>' + esc(s.full_name || '-') + '</strong></td>' +
        '<td>' + esc(s.student_no || '-') + '</td>' +
        '<td>' + esc(s.class_name || '-') + '</td>' +
        '<td>' + esc(s.email || '-') + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="num">' + fmtDate(s.created_at) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-ghost btn-sm" data-act="email" data-id="' + s.id + '">复制邮箱</button>' +
          (s.role === 'student'
            ? (s.is_active === false
                ? '<button class="btn btn-soft btn-sm" data-act="enable" data-id="' + s.id + '">启用</button>'
                : '<button class="btn btn-danger btn-sm" data-act="disable" data-id="' + s.id + '">停用</button>')
            : '') +
        '</div></td>';
      box.appendChild(tr);
    });
    // 事件代理
    var prev = box._handler;
    if (prev) box.removeEventListener('click', prev);
    box._handler = function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      var stu = state.students.find(function (x) { return x.id === id; });
      if (!stu) return;
      if (act === 'email') {
        try { navigator.clipboard.writeText(stu.email || ''); } catch (err) { /* Safari 需 https */ }
        toast('邮箱已复制', 'ok');
      } else if (act === 'enable') {
        setStudentActive(id, true);
      } else if (act === 'disable') {
        setStudentActive(id, false);
      }
    };
    box.addEventListener('click', box._handler);
  }

  async function setStudentActive(id, active) {
    var stu = state.students.find(function (x) { return x.id === id; });
    if (!stu) return;
    var tip = active ? '确定恢复该学生账号？' : '停用后该学生将无法登录系统，确定停用？';
    if (!window.confirm(tip)) return;
    try {
      var res = await client().from('profiles').update({ is_active: active }).eq('id', id);
      if (res.error) throw res.error;
      toast(active ? '已启用' : '已停用', 'ok');
      await loadStudents();
      renderStudents();
    } catch (e) {
      toast(APP.auth.friendlyError(e, '操作失败'), 'err');
    }
  }

  /* ============ 文章库管理 ============ */
  async function loadPassages() {
    var res = await client().from('passages')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (res.error) throw res.error;
    state.passages = res.data || [];
  }

  function catBadge(c) {
    if (c === 'chinese') return '<span class="badge badge-chinese">中文</span>';
    if (c === 'english') return '<span class="badge badge-english">英文</span>';
    return '<span class="badge badge-off">' + esc(c) + '</span>';
  }
  function stars(d) {
    var n = Number(d || 1); if (n < 1) n = 1; if (n > 3) n = 3;
    return '<span class="stars">' + '★★★★★'.slice(0, n) + '</span><span style="opacity:.35">' + '★★★★★'.slice(n) + '</span>';
  }

  function renderPassages() {
    var box = $('passages-tbody');
    if (!box) return;
    box.innerHTML = '';
    if (!state.passages.length) {
      box.appendChild(el('tr', '', '<td colspan="7" class="empty-tip">暂无文章，点击右上角“新增文章”创建</td>'));
      return;
    }
    state.passages.forEach(function (p) {
      var tr = document.createElement('tr');
      var len = String(p.content || '').length;
      tr.innerHTML =
        '<td><strong>' + esc(p.title || '-') + '</strong></td>' +
        '<td>' + catBadge(p.category) + '</td>' +
        '<td>' + stars(p.difficulty) + '</td>' +
        '<td class="num">' + len + ' 字</td>' +
        '<td>' + (p.enabled ? '<span class="badge badge-english">上架中</span>' : '<span class="badge badge-off">已下架</span>') + '</td>' +
        '<td class="num">' + fmtDate(p.created_at) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-soft btn-sm" data-act="edit" data-id="' + p.id + '">编辑</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="toggle" data-id="' + p.id + '">' + (p.enabled ? '下架' : '上架') + '</button>' +
          '<button class="btn btn-danger btn-sm" data-act="del" data-id="' + p.id + '">删除</button>' +
        '</div></td>';
      box.appendChild(tr);
    });
    var prev = box._handler;
    if (prev) box.removeEventListener('click', prev);
    box._handler = function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      var p = state.passages.find(function (x) { return String(x.id) === id; });
      if (!p) return;
      if (act === 'edit') openPassageModal(p);
      else if (act === 'toggle') togglePassage(p);
      else if (act === 'del') deletePassage(p);
    };
    box.addEventListener('click', box._handler);
  }

  function openPassageModal(p) {
    state.passageDraft = p || null;
    var mask = $('passage-modal');
    var titleEl = $('passage-modal-title');
    titleEl.textContent = p ? '编辑文章' : '新增文章';
    $('pf-title').value = p ? (p.title || '') : '';
    $('pf-category').value = p ? (p.category || 'chinese') : 'chinese';
    $('pf-difficulty').value = p ? String(p.difficulty || 1) : '1';
    $('pf-content').value = p ? (p.content || '') : '';
    $('pf-enabled').checked = p ? (p.enabled !== false) : true;
    $('pf-error').style.display = 'none';
    mask.classList.add('show');
  }
  function closePassageModal() {
    var mask = $('passage-modal');
    mask.classList.remove('show');
    state.passageDraft = null;
  }

  async function savePassageForm() {
    var title = $('pf-title').value.trim();
    var category = $('pf-category').value;
    var difficulty = Number($('pf-difficulty').value || 1);
    var content = $('pf-content').value.replace(/\r\n/g, '\n').trim();
    var enabled = $('pf-enabled').checked;
    var errBox = $('pf-error');
    if (!title) { errBox.textContent = '请填写文章标题'; errBox.style.display = 'block'; return; }
    if (!content) { errBox.textContent = '请填写文章正文'; errBox.style.display = 'block'; return; }
    if (content.length < 10) { errBox.textContent = '正文过短（至少 10 个字符），不利于练习'; errBox.style.display = 'block'; return; }
    errBox.style.display = 'none';
    var btn = $('pf-save-btn');
    btn.disabled = true;
    try {
      var payload = { title: title, category: category, difficulty: difficulty, content: content, enabled: enabled };
      var res;
      if (state.passageDraft && state.passageDraft.id) {
        res = await client().from('passages').update(payload).eq('id', state.passageDraft.id);
      } else {
        res = await client().from('passages').insert(payload);
      }
      if (res.error) throw res.error;
      toast('文章已保存', 'ok');
      closePassageModal();
      await loadPassages();
      renderPassages();
    } catch (e) {
      toast(APP.auth.friendlyError(e, '保存失败'), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function togglePassage(p) {
    try {
      var next = !p.enabled;
      var res = await client().from('passages').update({ enabled: next }).eq('id', p.id);
      if (res.error) throw res.error;
      toast(next ? '已上架' : '已下架', 'ok');
      await loadPassages();
      renderPassages();
    } catch (e) {
      toast(APP.auth.friendlyError(e, '操作失败'), 'err');
    }
  }

  async function deletePassage(p) {
    if (!window.confirm('确定删除文章《' + p.title + '》？\n若该文章已有学生成绩记录，将无法删除（可改为下架）。')) return;
    try {
      var res = await client().from('passages').delete().eq('id', p.id);
      if (res.error) throw res.error;
      toast('文章已删除', 'ok');
      await loadPassages();
      renderPassages();
    } catch (e) {
      var msg = APP.auth.friendlyError(e, '删除失败');
      if (/foreign key|foreign|restrict|violates/i.test(msg)) {
        msg = '该文章已有学生练习成绩，无法删除。建议改为“下架”以保留历史数据。';
      }
      toast(msg, 'err');
    }
  }

  /* ============ 成绩统计 ============ */
  async function loadRecords() {
    var res = await client().from('typing_records')
      .select('id,user_id,passage_id,accuracy,speed,raw_speed,keystrokes,errors,duration_sec,finished_at')
      .order('finished_at', { ascending: false }).limit(5000);
    if (res.error) throw res.error;
    state.records = res.data || [];
    // 关联数据（客户端 join，避免嵌入查询边界问题）
    var pl = await client().from('passages').select('id,title,category,difficulty');
    if (pl.error) throw pl.error;
    var pp = await client().from('profiles').select('id,full_name,student_no,class_name');
    if (pp.error) throw pp.error;
    var pm = {}; (pl.data || []).forEach(function (x) { pm[x.id] = x; });
    var prm = {}; (pp.data || []).forEach(function (x) { prm[x.id] = x; });
    state.records.forEach(function (r) {
      r._passage = pm[r.passage_id] || null;
      r._profile = prm[r.user_id] || null;
    });
  }

  function renderStats() {
    var mode = state.statMode;
    var groups = {}; // key -> agg
    var order = [];
    state.records.forEach(function (r) {
      var key = '';
      var name = '';
      if (mode === 'passage') {
        key = 'p' + r.passage_id;
        name = r._passage ? r._passage.title : '（文章已删除）';
      } else if (mode === 'class') {
        key = 'c' + (r._profile ? r._profile.class_name : '-');
        name = r._profile && r._profile.class_name ? r._profile.class_name : '（未填写班级）';
      } else {
        key = 'u' + r.user_id;
        name = r._profile ? (r._profile.full_name + (r._profile.class_name ? ' · ' + r._profile.class_name : '')) : '（未知学生）';
      }
      if (!groups[key]) {
        groups[key] = { name: name, attempts: 0, accSum: 0, speedSum: 0, rawSum: 0, best: -1, errSum: 0 };
        order.push(key);
      }
      var g = groups[key];
      g.attempts++;
      g.accSum += Number(r.accuracy || 0);
      g.speedSum += Number(r.speed || 0);
      g.rawSum += Number(r.raw_speed || 0);
      g.errSum += Number(r.errors || 0);
      if (Number(r.speed || 0) > g.best) g.best = Number(r.speed || 0);
    });
    var list = order.map(function (k) { return groups[k]; });
    list.sort(function (a, b) { return b.attempts - a.attempts || b.accSum / b.attempts - a.accSum / a.attempts; });

    var box = $('stats-tbody');
    box.innerHTML = '';
    if (!state.records.length) {
      box.appendChild(el('tr', '', '<td colspan="5" class="empty-tip">暂无成绩数据，学生完成练习后此处会展示统计</td>'));
      return;
    }
    if (!list.length) {
      box.appendChild(el('tr', '', '<td colspan="5" class="empty-tip">无数据</td>'));
      return;
    }
    list.slice(0, 300).forEach(function (g) {
      var tr = document.createElement('tr');
      var avgAcc = r1(g.accSum / g.attempts);
      var avgSpeed = r1(g.speedSum / g.attempts);
      var best = g.best >= 0 ? r1(g.best) : '-';
      tr.innerHTML =
        '<td><strong>' + esc(g.name) + '</strong></td>' +
        '<td class="num">' + g.attempts + '</td>' +
        '<td class="num">' + avgAcc.toFixed(1) + '%</td>' +
        '<td class="num">' + avgSpeed.toFixed(1) + '</td>' +
        '<td class="num">' + best + '</td>';
      box.appendChild(tr);
    });
  }

  function setStatMode(mode) {
    state.statMode = mode;
    var map = { passage: 'stats-btn-passage', class: 'stats-btn-class', student: 'stats-btn-student' };
    Object.keys(map).forEach(function (k) {
      var btn = $(map[k]);
      if (btn) btn.classList.toggle('on', k === mode);
    });
    var label = $('stats-label');
    if (label) {
      label.textContent = mode === 'passage' ? '按文章' : mode === 'class' ? '按班级' : '按学生';
    }
    renderStats();
  }

  /* ============ 初始化 ============ */
  function bindTabs() {
    var tabs = document.querySelectorAll('.admin-tabs button[data-tab]');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-tab');
        tabs.forEach(function (b) { b.classList.toggle('on', b === btn); });
        ['students', 'passages', 'stats'].forEach(function (p) {
          var panel = $('panel-' + p);
          if (panel) panel.classList.toggle('on', p === t);
        });
      });
    });
  }

  function bindEvents() {
    bindTabs();
    var sb = $('student-search');
    if (sb) sb.addEventListener('input', function () {
      state.studentFilter = sb.value;
      renderStudents();
    });
    var addBtn = $('passage-add-btn');
    if (addBtn) addBtn.addEventListener('click', function () { openPassageModal(null); });
    var closeBtn = $('passage-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closePassageModal);
    var cancelBtn = $('pf-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closePassageModal);
    var saveBtn = $('pf-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', savePassageForm);
    var mask = $('passage-modal');
    if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) closePassageModal(); });

    var b1 = $('stats-btn-passage'); if (b1) b1.addEventListener('click', function () { setStatMode('passage'); });
    var b2 = $('stats-btn-class'); if (b2) b2.addEventListener('click', function () { setStatMode('class'); });
    var b3 = $('stats-btn-student'); if (b3) b3.addEventListener('click', function () { setStatMode('student'); });
  }

  async function init() {
    bindEvents();
    // 先展示空壳避免白屏，随后异步填充
    try {
      await loadStudents();
      renderStudents();
    } catch (e) {
      toast(APP.auth.friendlyError(e, '学生列表加载失败'), 'err');
    }
    try {
      await loadPassages();
      renderPassages();
    } catch (e) {
      toast(APP.auth.friendlyError(e, '文章列表加载失败'), 'err');
    }
    try {
      await loadRecords();
      setStatMode('passage');
    } catch (e) {
      toast(APP.auth.friendlyError(e, '成绩统计加载失败'), 'err');
    }
  }

  window.APP.admin = {
    init: init,
    refreshStudents: async function () { await loadStudents(); renderStudents(); },
    refreshPassages: async function () { await loadPassages(); renderPassages(); }
  };
})();
