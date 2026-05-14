/** 与 index.html 内联脚本共用键名，勿改。 */
export const THEME_STORAGE_KEY = "sop-ui-theme";
function parseStored(raw) {
    if (raw === "light" || raw === "dark" || raw === "system")
        return raw;
    return "system";
}
export function getThemePreference() {
    try {
        return parseStored(localStorage.getItem(THEME_STORAGE_KEY));
    }
    catch {
        return "system";
    }
}
export function systemPrefersDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
/** 当前是否应用暗色样式（含 system 解析结果）。 */
export function isDarkResolved(pref) {
    if (pref === "dark")
        return true;
    if (pref === "light")
        return false;
    return systemPrefersDark();
}
export function applyResolvedTheme(pref) {
    const dark = isDarkResolved(pref);
    document.documentElement.classList.toggle("dark", dark);
    document.body?.classList.toggle("dark", dark);
    document.documentElement.dataset.themePref = pref;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
export function setThemePreference(pref) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
    catch {
        /* ignore */
    }
    applyResolvedTheme(pref);
    window.dispatchEvent(new CustomEvent("sop-theme"));
}
/** 首屏前调用；system 时监听系统配色变化。 */
export function initTheme() {
    applyResolvedTheme(getThemePreference());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
        if (getThemePreference() === "system")
            applyResolvedTheme("system");
    };
    mq.addEventListener("change", onMedia);
}
