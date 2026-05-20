export const mainAdminAppManifest = {
  id: "main-admin",
  name: "基础管理中心",
  ownership: "租户账号、组织项目、权限策略、服务治理、菜单契约与微应用注册控制面",
  pageRoots: ["src/pages/overview", "src/pages/portfolio", "src/pages/admin", "src/pages/organization", "src/pages/projects"],
  modules: [
    "战略总览、项目组合与组织运营",
    "租户账号、项目成员与业务线治理",
    "角色权限、访问评审与权限矩阵",
    "菜单管理、页面注册、微应用注册与模块治理",
  ],
} as const;
