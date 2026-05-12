# 前端通用开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 技术栈无关，适用于所有前端项目。

## 1. 核心原则

| 原则 | 说明 |
|------|------|
| **组件单一职责** | 一个组件只做一件事 |
| **状态最小化** | 只保留必要的状态，派生数据用计算属性 |
| **类型安全** | 所有项目使用 TypeScript，禁止 `any`（除非有充分理由） |
| **可访问性** | 交互元素必须有 `aria-label`，图片必须有 `alt` |
| **性能优先** | 列表虚拟化、懒加载、代码分割 |

## 2. 技术栈选型

不限定技术栈，根据项目需求选择。选型后记录到 `memory/decisions/`。

**常见选型参考**：

| 场景 | 推荐方案 | 备选 |
|------|---------|------|
| 管理后台 | Vue3 + TDesign | React + Ant Design |
| 复杂交互（编辑器/画布） | React | Vue3 |
| 移动端 H5 | Vue3 + Vant | React + Ant Design Mobile |
| 小程序 | Taro + React | uni-app + Vue3 |
| SSR/SSG | Next.js | Nuxt3 |
| 桌面应用 | Electron + Vue3/React | Tauri |

## 3. 项目结构原则

```
src/
├── components/     # 可复用组件（无业务逻辑）
├── modules/        # 业务模块（按领域拆分）
│   └── {domain}/
│       ├── api.ts
│       ├── types.ts
│       └── components/
├── pages/          # 路由页面
├── stores/         # 全局状态
├── api/            # HTTP 请求层
├── utils/          # 工具函数
├── hooks/          # 自定义 Hooks
└── types/          # 全局类型
```

## 4. TypeScript 规范

```typescript
// ✅ 接口用于可扩展的对象类型
interface User {
  id: number;
  name: string;
  status: UserStatus;
}

// ✅ type 用于联合类型、工具类型
type UserStatus = 'active' | 'inactive' | 'banned';
type UserWithoutId = Omit<User, 'id'>;

// ✅ API 响应通用类型
interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

// ❌ 禁止
const user: any = {};
function process(data: any) {}
```

## 5. 组件规范

### 命名
- 文件名：`kebab-case.vue` / `PascalCase.tsx`
- 组件名：`PascalCase`
- 多单词（避免与 HTML 标签冲突）

### Props 设计
```typescript
// ✅ 明确类型，提供默认值
interface Props {
  title: string;
  size?: 'sm' | 'md' | 'lg';  // 用联合类型而非 string
  disabled?: boolean;
}
// 默认值在解构时提供，不在 interface 中
```

### 组件大小
- 单个组件 < 300 行（含模板/JSX）
- 超过时拆分为子组件或提取 Hook

## 6. 状态管理规范

```
本地状态（useState/ref）→ 组件内部
提升状态（props drilling）→ 2-3 层以内
全局状态（Pinia/Zustand）→ 跨组件共享
服务端状态（React Query/SWR）→ 异步数据
```

**禁止**：将服务端数据缓存在全局 store（用 React Query/SWR 代替）

## 7. API 调用规范

```typescript
// ✅ 统一封装，集中管理
// api/modules/user.ts
export const userApi = {
  getList: (params: ListParams) => request.get<ApiResponse<User[]>>('/users', { params }),
  create: (data: CreateUserDto) => request.post<ApiResponse<User>>('/users', data),
};

// ✅ 在组件/Hook 中调用
const { data, loading } = useQuery(() => userApi.getList(params));

// ❌ 禁止在组件中直接使用 axios
import axios from 'axios';
axios.get('/api/users');  // 禁止
```

## 8. 错误处理规范

```typescript
// ✅ 全局错误拦截（axios interceptor）
// ✅ 组件级错误边界（Error Boundary）
// ✅ 异步操作的 loading/error 状态

// ❌ 禁止吞掉错误
try {
  await api.call();
} catch (e) {
  // 什么都不做  ← 禁止
}
```

## 9. 性能规范

| 场景 | 要求 |
|------|------|
| 列表 > 100 条 | 必须虚拟滚动 |
| 图片 | 懒加载 + WebP 格式 |
| 路由 | 懒加载（动态 import） |
| 大型依赖 | 按需引入（tree-shaking） |
| 首屏 | LCP < 2.5s，FID < 100ms |

## 10. 可访问性（a11y）

```html
<!-- ✅ 图片必须有 alt -->
<img src="logo.png" alt="公司 Logo" />

<!-- ✅ 按钮必须有可读文本 -->
<button aria-label="关闭对话框">×</button>

<!-- ✅ 表单必须有 label -->
<label for="email">邮箱</label>
<input id="email" type="email" />

<!-- ✅ 颜色对比度 ≥ 4.5:1（WCAG AA） -->
```

## 11. 代码质量工具

每个项目必须配置：
- **ESLint**：代码规范检查
- **Prettier**：代码格式化
- **TypeScript**：类型检查
- **Husky + lint-staged**：提交前检查

推荐使用 `@antfu/eslint-config`（统一 Vue/React 规范）。

## 12. 路由与权限规范

```typescript
// 路由守卫（Vue3 Router）
router.beforeEach(async (to) => {
  const token = useAuthStore().token;
  if (to.meta.requiresAuth && !token) return '/login';
  if (to.meta.roles && !to.meta.roles.includes(useAuthStore().role)) return '/403';
});

// 路由元信息
const routes = [
  { path: '/admin', meta: { requiresAuth: true, roles: ['admin'] } },
  { path: '/dashboard', meta: { requiresAuth: true } },
];
```

## 13. 自定义 Hook 规范

```typescript
// Vue3 - usePagination
export function usePagination<T>(fetchFn: (p: PaginationParams) => Promise<PaginationResult<T>>) {
  const data = ref<T[]>([]);
  const loading = ref(false);
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 });

  const fetch = async () => {
    loading.value = true;
    try {
      const res = await fetchFn({ page: pagination.page, pageSize: pagination.pageSize });
      data.value = res.list;
      pagination.total = res.total;
    } finally { loading.value = false; }
  };

  onMounted(fetch);
  return { data, loading, pagination, fetch };
}

// React - useAntdTable
export function useAntdTable<T>(fetchFn: (p: PaginationParams) => Promise<PaginationResult<T>>) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchFn({ page: pagination.current, pageSize: pagination.pageSize });
      setData(res.list);
      setPagination(p => ({ ...p, total: res.total }));
    } finally { setLoading(false); }
  }, [fetchFn, pagination.current, pagination.pageSize]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, pagination, fetchData, setPagination };
}
```

## 14. 构建与部署规范

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          ui: ['ant-design-vue'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
});
```

**部署检查清单**：
- [ ] 生产构建 `npm run build`，无 TypeScript 错误
- [ ] 环境变量通过 `.env.production` 注入，不硬编码
- [ ] 静态资源上传 CDN
- [ ] Nginx 配置 `try_files $uri /index.html`（SPA 路由）
- [ ] 开启 gzip/brotli 压缩
