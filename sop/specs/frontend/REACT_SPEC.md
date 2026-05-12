# React 专项开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 前置阅读: `FRONTEND_SPEC.md`

## 1. 函数组件规范

```tsx
// ✅ 标准函数组件结构
import { useState, useEffect, useCallback, memo } from 'react';
import type { FC } from 'react';

interface Props {
  userId: number;
  onDelete?: (id: number) => void;
}

const UserCard: FC<Props> = memo(({ userId, onDelete }) => {
  // 状态声明
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  // 副作用
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    userApi.getById(userId)
      .then(res => { if (!cancelled) setUser(res.data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };  // 清理
  }, [userId]);

  // 事件处理
  const handleDelete = useCallback(() => {
    onDelete?.(userId);
  }, [userId, onDelete]);

  if (loading) return <Skeleton />;
  if (!user) return null;

  return (
    <div className="user-card">
      <span>{user.name}</span>
      <button onClick={handleDelete}>删除</button>
    </div>
  );
});

UserCard.displayName = 'UserCard';
export default UserCard;
```

## 2. 自定义 Hook 规范

```typescript
// hooks/useTable.ts
export function useTable<T>(
  fetchFn: (params: PaginationParams) => Promise<PaginationResult<T>>,
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchFn({ page: pagination.page, pageSize: pagination.pageSize });
      setData(res.list);
      setPagination(prev => ({ ...prev, total: res.total }));
    } finally {
      setLoading(false);
    }
  }, [fetchFn, pagination.page, pagination.pageSize]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, pagination, setPagination, fetch };
}
```

## 3. 状态管理规范

```typescript
// ✅ 服务端状态用 React Query（推荐）
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function useUsers(params: ListParams) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => userApi.getList(params),
    staleTime: 5 * 60 * 1000,  // 5 分钟缓存
  });
}

function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => userApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ✅ 客户端全局状态用 Zustand
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserStore {
  token: string;
  setToken: (token: string) => void;
  logout: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      token: '',
      setToken: (token) => set({ token }),
      logout: () => set({ token: '' }),
    }),
    { name: 'user-store', partialize: (s) => ({ token: s.token }) },
  ),
);
```

## 4. 性能优化

```tsx
// ✅ memo 避免不必要重渲染
const ExpensiveList = memo(({ items }: { items: Item[] }) => (
  <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
));

// ✅ useMemo 缓存计算结果
const sortedItems = useMemo(
  () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
  [items],
);

// ✅ useCallback 稳定函数引用
const handleClick = useCallback((id: number) => {
  onDelete(id);
}, [onDelete]);

// ✅ 懒加载路由
const UserPage = lazy(() => import('./pages/UserPage'));
```

## 5. 推荐技术栈版本

```json
{
  "react": "^19.0",
  "react-dom": "^19.0",
  "react-router-dom": "^7.0",
  "@tanstack/react-query": "^5.0",
  "zustand": "^5.0",
  "antd": "^5.24",
  "vite": "^6.2",
  "typescript": "~5.7"
}
```
