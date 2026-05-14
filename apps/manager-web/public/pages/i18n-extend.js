/**
 * i18n 模块化扩展机制
 * 每个页面模块调用 window.i18nExtend({ zh: {...}, en: {...} }) 注册自己的翻译
 * 不修改主 i18n.js，防止单文件过大
 */
(function(global) {
  global.i18nExtend = function(pack) {
    var I = global.DEVDASH_I18N;
    if (!I) { global.DEVDASH_I18N = pack; return; }
    if (pack.zh) Object.assign(I.zh || (I.zh = {}), pack.zh);
    if (pack.en) Object.assign(I.en || (I.en = {}), pack.en);
  };
})(window);
