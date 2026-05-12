# Vue3 专项开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 前置阅读: `FRONTEND_SPEC.md`

## 1. 组合式 API 规范

```vue
<script setup lang="ts">
// 导入顺序：Vue 核心 → 第三方 → 内部模块
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { userApi } from '@api/user';

// 代码块顺序：store → 状态 → 计算属性 → 方法 → 生命周期
const userStore = useUserStore();
const loading = ref(false);
const list = ref<User[]>([]);

const isAdmin = computed(() => userStore.role === 'admin');

async function fetchList() {
  loading.value = true;
  try {
    const res = await userApi.getList();
    list.value = res.data.list;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchList);
</script>
```

## 2. Props / Emits 规范

```vue
<script setup lang="ts">
// ✅ 使用 TypeScript 泛型语法（Vue 3.3+）
interface Props {
  user: User;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  disabled: false,
});

const emit = defineEmits<{
  change: [user: User];
  delete: [id: number];
}>();
</script>
```

## 3. 自定义 Hook 规范

```typescript
// hooks/useTable.ts
// ✅ 返回响应式状态 + 操作方法
export function useTable<T>(
  fetchFn: (params: PaginationParams) => Promise<PaginationResult<T>>,
) {
  const data = ref<T[]>([]);
  const loading = ref(false);
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 });

  async function fetch() {
    loading.value = true;
    try {
      const res = await fetchFn({ page: pagination.page, pageSize: pagination.pageSize });
      data.value = res.list;
      pagination.total = res.total;
    } finally {
      loading.value = false;
    }
  }

  onMounted(fetch);

  return { data, loading, pagination, fetch };
}
```

## 4. Pinia Store 规范

```typescript
// stores/user.ts
export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('token') ?? '');
  const userInfo = ref<User | null>(null);

  const isLoggedIn = computed(() => !!token.value);

  async function login(username: string, password: string) {
    const res = await authApi.login({ username, password });
    token.value = res.data.token;
    localStorage.setItem('token', res.data.token);
  }

  function logout() {
    token.value = '';
    userInfo.value = null;
    localStorage.removeItem('token');
  }

  return { token, userInfo, isLoggedIn, login, logout };
});
```

## 5. 模板规范

```vue
<template>
  <!-- ✅ 条件渲染：v-if 优先于 v-show（除非频繁切换） -->
  <div v-if="isLoggedIn">已登录内容</div>

  <!-- ✅ 列表渲染：必须有 key，用唯一 ID -->
  <div v-for="item in list" :key="item.id">{{ item.name }}</div>

  <!-- ✅ 事件处理：复杂逻辑提取为方法 -->
  <button @click="handleDelete(item.id)">删除</button>

  <!-- ❌ 禁止在模板中写复杂逻辑 -->
  <div>{{ list.filter(i => i.status === 1).map(i => i.name).join(', ') }}</div>
  <!-- ✅ 改为计算属性 -->
  <div>{{ activeUserNames }}</div>
</template>
```

## 6. 性能优化

```vue
<script setup lang="ts">
import { defineAsyncComponent, shallowRef } from 'vue';

// ✅ 大型组件懒加载
const HeavyChart = defineAsyncComponent(() => import('./HeavyChart.vue'));

// ✅ 大型列表用 shallowRef（避免深度响应式）
const bigList = shallowRef<Item[]>([]);

// ✅ 虚拟滚动（列表 > 100 条）
// 使用 vue-virtual-scroller 或 TDesign 的虚拟滚动
</script>
```

## 7. 推荐技术栈版本

```json
{
  "vue": "^3.5",
  "vue-router": "^4.5",
  "pinia": "^2.3",
  "vite": "^6.2",
  "typescript": "~5.7",
  "tdesign-vue-next": "^1.18",
  "axios": "^1.8"
}
```
