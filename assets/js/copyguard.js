/**
 * copyguard.js
 * 学生端防复制 / 防粘贴防作弊守卫（全局注入）
 *
 * 规则：
 * 1. 右键菜单默认拦截；处于 [data-copyable] 区域内放行（管理端编辑区）。
 * 2. 复制/剪切事件默认拦截（Ctrl/Cmd+C、Ctrl/Cmd+X）；[data-copyable] 内放行。
 * 3. 拖拽默认拦截（防止拖选/拖拽文本）。
 * 4. 粘贴事件：落入 [data-paste-block]（练习输入框）一律拦截，防止作弊；
 *    [data-copyable] 区域内（管理端编辑区）放行粘贴/复制。
 * 5. 文本选择的禁用由 CSS（body user-select:none）负责，本脚本不再拦截 selectstart，
 *    以免影响输入框/管理端正常编辑。
 */
(function () {
  'use strict';

  function isCopyable(target) {
    return !!(target && target.closest && target.closest('[data-copyable]'));
  }

  function isPasteBlocked(target) {
    return !!(target && target.closest && target.closest('[data-paste-block]'));
  }

  function isEditable(target) {
    if (!target) return false;
    var tag = (target.tagName || '').toLowerCase();
    return tag === 'textarea' || tag === 'input' || target.isContentEditable === true;
  }

  // 普通表单编辑控件（登录/注册输入框）放行复制/右键：PRD 明确"表单值复制不做强制拦截"
  // 练习输入区（data-paste-block）与文章/成绩展示区仍受保护
  function isFreeEditable(target) {
    return isEditable(target) && !isPasteBlocked(target);
  }

  // 1) 右键菜单：管理端编辑区、普通表单输入框放行
  document.addEventListener('contextmenu', function (e) {
    if (!isCopyable(e.target) && !isFreeEditable(e.target)) {
      e.preventDefault();
    }
  }, false);

  // 2) 复制 / 剪切：管理端编辑区与普通表单放行，其余一律拦截
  ['copy', 'cut'].forEach(function (evtName) {
    document.addEventListener(evtName, function (e) {
      if (isCopyable(e.target) || isFreeEditable(e.target)) return;
      e.preventDefault();
    }, false);
  });

  // 键盘兜底：即使 copy/cut 事件被某些浏览器漏掉，也拦截组合键
  document.addEventListener('keydown', function (e) {
    if (isCopyable(e.target) || isFreeEditable(e.target)) return;
    var k = e.key || '';
    var isCopyCut = k.toLowerCase() === 'c' || k.toLowerCase() === 'x';
    if ((e.ctrlKey || e.metaKey) && isCopyCut) {
      e.preventDefault();
    }
    // 打印/截图快捷键不强制拦截（机房以纪律约束），仅针对复制粘贴
  }, false);

  // 3) 拖拽：防止拖选文本 / 拖入外部内容
  document.addEventListener('dragstart', function (e) {
    if (!isCopyable(e.target) && !isFreeEditable(e.target)) {
      e.preventDefault();
    }
  }, false);

  // 4) 粘贴：练习输入区（data-paste-block）一律拦截；管理端编辑区放行
  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (!t) return;
    if (isCopyable(t)) return; // 管理端编辑区允许粘贴
    if (isPasteBlocked(t)) {
      e.preventDefault();
      return;
    }
    // 其它输入框（登录/注册表单）按 PRD 不强制拦截，避免可用性差
    if (isEditable(t)) return;
    e.preventDefault();
  }, false);

  // 5) 剪切快捷键在输入框中允许（学生编辑自己表单），但在练习输入框仍禁粘贴即可
})();
