/**
 * supabase-init.js
 * 初始化 Supabase 客户端（复用 class-points 项目，仅含可公开配置）
 * 依赖：页面已通过 CDN 引入 @supabase/supabase-js UMD（window.supabase）
 *      且已先加载 assets/js/config.js（window.APP_CONFIG）
 * 输出：window.supabaseClient / window.APP.supabase / window.APP.config
 * 本文件不修改 config.js。
 */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG || null;
  var initError = null;

  function fail(msg) {
    initError = msg;
    if (window.APP) {
      window.APP.supabaseInitError = msg;
    }
    console.error('[supabase-init] ' + msg);
  }

  if (!cfg) {
    fail('后端配置缺失：请确认 assets/js/config.js 已在本文件之前加载');
  } else if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    fail('后端配置不完整：config.js 缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY');
  } else if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    fail('Supabase SDK 未能加载：请检查网络或 CDN 地址（https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2）');
  }

  window.APP = window.APP || {};

  if (initError) {
    window.APP.supabaseClient = null;
    window.APP.supabaseInitError = initError;
    return;
  }

  try {
    var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'gslw-typing-auth'
      }
    });
    window.APP.config = cfg;
    window.APP.supabase = client;
    window.APP.supabaseClient = client;
    window.APP.supabaseInitError = null;
  } catch (e) {
    fail('初始化 Supabase 客户端失败：' + (e && e.message ? e.message : String(e)));
  }
})();
