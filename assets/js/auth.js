/**
 * auth.js
 * 注册 / 登录 / 登出 / 会话恢复 / 角色守卫
 * 依赖：supabase-init.js（window.APP.supabase）
 * 暴露：window.APP.auth
 */
(function () {
  'use strict';

  window.APP = window.APP || {};
  var APP = window.APP;

  function client() {
    if (!APP.supabase) {
      throw new Error(APP.supabaseInitError || '后端服务未初始化，请检查网络后刷新重试');
    }
    return APP.supabase;
  }

  /* ===== 学生账号标识：学号 → 系统内部虚拟邮箱 =====
   * 学生没有真实邮箱，注册/登录时统一把学号映射为 `${学号}@stu.dzxt.local`
   * 该地址仅作 Supabase Auth 的账号标识，系统不会向其发送任何邮件 */
  var STU_EMAIL_DOMAIN = 'stu.dzxt.local';
  function isEmailLike(v) { return String(v == null ? '' : v).indexOf('@') >= 0; }
  function stuEmail(studentNo) {
    return String(studentNo == null ? '' : studentNo).trim().toLowerCase() + '@' + STU_EMAIL_DOMAIN;
  }

  /** 把 Supabase 英文错误映射为友好中文 */
  function humanError(e, extra) {
    if (!e) return extra || '操作失败，请稍后重试';
    var msg = e.message || e.error_description || e.msg || String(e);
    var lower = String(msg).toLowerCase();
    if (/already registered|user_already_exists|already been registered/i.test(lower)) {
      if (/student_no|学号/i.test(lower)) return '该学号已被注册，请检查后重试';
      return '该邮箱已被注册，请直接登录';
    }
    if (/invalid login credentials/i.test(lower)) return '邮箱或密码错误';
    if (/email not confirmed|confirm your email/i.test(lower)) return '该邮箱尚未验证，请先前往邮箱完成验证';
    if (/password should be at least/i.test(lower)) return '密码长度至少 6 位';
    if (/student_no/i.test(lower) && /duplicate|unique|already/i.test(lower)) return '该学号已被注册';
    if (/duplicate key/i.test(lower)) return '信息重复（学号或邮箱可能已存在）';
    if (/rate limit|too many requests/i.test(lower)) return '操作过于频繁，请稍等片刻再试';
    if (/fetch|network|failed to fetch|load failed|typeerror/i.test(lower)) return '网络连接失败，请检查网络后重试';
    if (/jwt|invalid.*token/i.test(lower)) return '登录状态已失效，请重新登录';
    if (/new row violates row-level security|row-level security/i.test(lower)) return '操作被拒绝（权限不足或数据库策略未生效）';
    if (/does not exist|relation .* does not exist/i.test(lower)) return '数据库表不存在：请先在 Supabase 执行 supabase/schema.sql';
    if (/permission denied/i.test(lower)) return '权限不足，无法执行该操作';
    return msg || (extra || '操作失败，请稍后重试');
  }

  var auth = {

    /** 初始化：恢复本地 session（Safari/Chrome 刷新不丢登录态） */
    async ensureSession() {
      var sb = client();
      var d = await sb.auth.getSession();
      if (d && d.error) throw d.error;
      APP.session = d && d.data ? d.data.session : null;
      return APP.session;
    },

    async getSession() {
      if (APP.session) return APP.session;
      return this.ensureSession();
    },

    /** 读取当前用户 profile（含角色） */
    async loadProfile(silent) {
      var session = APP.session;
      if (!session) return null;
      try {
        var res = await client().from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        if (res && res.error) {
          if (!silent) console.warn('[auth] loadProfile:', res.error);
          return null;
        }
        APP.profile = res.data || null;
        return APP.profile;
      } catch (e) {
        if (!silent) console.warn('[auth] loadProfile exception:', e);
        return null;
      }
    },

    async refreshProfile() {
      APP.profile = null;
      return this.loadProfile(true);
    },

    currentUser() {
      return APP.session ? APP.session.user : null;
    },

    profile() {
      return APP.profile || null;
    },

    /** 登录：学生用学号（内部转虚拟邮箱），教师用邮箱 + 密码 */
    async login(account, password) {
      var sb = client();
      var id = String(account == null ? '' : account).trim();
      var byEmail = isEmailLike(id);
      var res = await sb.auth.signInWithPassword({
        email: byEmail ? id : stuEmail(id),
        password: password
      });
      if (res.error) {
        var m = String(res.error.message || '').toLowerCase();
        if (/invalid login credentials/.test(m)) {
          throw new Error(byEmail ? '邮箱或密码错误' : '学号或密码错误');
        }
        throw res.error;
      }
      APP.session = res.data.session;
      if (!APP.session) throw new Error('登录失败：未返回会话，请重试');
      // 读取角色，检查是否被停用
      var p = await this.loadProfile();
      if (p && p.is_active === false) {
        await this.logout();
        throw new Error('该账号已被停用，请联系老师');
      }
      return { profile: p };
    },

    /** 注册：学生用「学号+班级+密码」（学号转虚拟邮箱、姓名用学号兜底），教师用「姓名+邮箱+密码」，成功后自动登录 */
    async register(fields) {
      var sb = client();
      var role = fields.role === 'teacher' ? 'teacher' : 'student';
      var isTeacher = role === 'teacher';
      var studentNo = isTeacher ? '' : String(fields.student_no || '').trim();
      // 学生：账号标识 = 学号虚拟邮箱；姓名缺失时用学号兜底（页面上以学号展示）
      var email = isTeacher ? String(fields.email || '').trim() : stuEmail(studentNo);
      var fullName = isTeacher ? String(fields.full_name || '').trim() : studentNo;
      // 1) 学号唯一性预校验（仅学生注册；依赖 schema.sql 提供的 is_student_no_taken）
      if (!isTeacher && studentNo) {
        try {
          var chk = await sb.rpc('is_student_no_taken', { p_student_no: studentNo });
          if (chk && chk.error) {
            // schema 未执行时跳过预检，交给数据库唯一约束兜底
            console.warn('[auth] is_student_no_taken rpc:', chk.error && chk.error.message);
          } else if (chk && chk.data === true) {
            throw new Error('该学号已被注册，请检查后重试');
          }
        } catch (e) {
          if (e && e.message && e.message.indexOf('该学号已被注册') === 0) throw e;
          console.warn('[auth] 学号预检失败，依赖数据库兜底：', e);
        }
      }
      // 2) 注册（身份/姓名/学号/班级写入 user metadata，由 schema.sql 触发器写入 profiles）
      var res = await sb.auth.signUp({
        email: email,
        password: fields.password,
        options: {
          data: {
            role: role,
            full_name: fullName,
            student_no: studentNo,
            class_name: isTeacher ? '' : (fields.class_name || '')
          }
        }
      });
      if (res.error) {
        var em = String(res.error.message || '').toLowerCase();
        if (/already registered|user_already_exists|already been registered|duplicate key/i.test(em)) {
          throw new Error(isTeacher ? '该邮箱已被注册，请直接登录' : '该学号已注册，请直接登录或换一个学号');
        }
        throw res.error;
      }
      // 关闭邮箱验证时 signUp 直接返回 session；个别情况未返回时尝试自动登录一次
      if (!(res.data && res.data.session)) {
        var s2 = await sb.auth.signInWithPassword({ email: email, password: fields.password });
        if (s2.error) throw s2.error;
        res.data.session = s2.data.session;
      }
      APP.session = res.data.session;
      if (!APP.session) throw new Error('注册后未能建立登录会话，请稍后重试');
      var p = await this.loadProfile(true); // 触发器刚写入，容忍读取失败
      return { autoLogin: true, profile: p };
    },

    async logout() {
      try {
        var sb = client();
        await sb.auth.signOut();
      } catch (e) {
        console.warn('[auth] signOut:', e);
      }
      APP.session = null;
      APP.profile = null;
    },

    /* ============ 角色守卫 ============ */

    /** 登录后可访问：未登录跳 index.html */
    async guardLogin() {
      try {
        var session = await this.ensureSession();
        if (!session) {
          location.replace('index.html');
          return null;
        }
        var p = await this.loadProfile();
        return { session: session, profile: p };
      } catch (e) {
        this.showFatal('网络异常，暂时无法连接服务器', true);
        return null;
      }
    },

    /** 学生页守卫：未登录跳登录；学生/教师/管理员均可使用学生端 */
    async guardStudent() {
      var session = await this.ensureSession();
      if (!session) {
        location.replace('index.html');
        return false;
      }
      var p = await this.loadProfile();
      if (!p) {
        this.showFatal('未能读取您的账号资料。请确认已在 Supabase 执行 supabase/schema.sql，并重新登录后重试。', true);
        return false;
      }
      return true;
    },

    /** 教师端守卫：未登录跳登录；仅 teacher / admin 允许进入 */
    async guardAdmin() {
      var session = await this.ensureSession();
      if (!session) {
        location.replace('index.html');
        return false;
      }
      var p = await this.loadProfile();
      if (!p) {
        this.showFatal('未能读取账号资料，无法校验教师权限。请确认已执行 supabase/schema.sql，或重新登录。', true);
        return false;
      }
      if (p.role !== 'teacher' && p.role !== 'admin') {
        this.showFatal('当前账号不是教师，无权访问教师端。', false);
        return false;
      }
      return true;
    },

    /* ============ 兜底防白屏 ============ */

    showFatal(msg, withRetry) {
      var box = document.getElementById('fatal-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'fatal-box';
        document.body.appendChild(box);
      }
      box.innerHTML = '';
      var inner = document.createElement('div');
      inner.className = 'fatal-inner glass-card';
      var icon = document.createElement('div');
      icon.className = 'fatal-icon';
      icon.textContent = '!';
      var title = document.createElement('div');
      title.className = 'fatal-title';
      title.textContent = '暂时无法进入';
      var desc = document.createElement('div');
      desc.className = 'fatal-desc';
      desc.textContent = msg || '发生未知错误';
      inner.appendChild(icon);
      inner.appendChild(title);
      inner.appendChild(desc);
      var row = document.createElement('div');
      row.className = 'btn-row';
      var back = document.createElement('button');
      back.className = 'btn btn-ghost';
      back.textContent = '返回登录页';
      back.addEventListener('click', function () { location.href = 'index.html'; });
      row.appendChild(back);
      if (withRetry !== false) {
        var retry = document.createElement('button');
        retry.className = 'btn btn-primary';
        retry.textContent = '重试';
        retry.addEventListener('click', function () { location.reload(); });
        row.appendChild(retry);
      }
      inner.appendChild(row);
      box.appendChild(inner);
    },

    /** 供业务代码展示错误（不抛异常） */
    friendlyError(e, fallback) {
      return humanError(e, fallback);
    }
  };

  APP.auth = auth;
})();
