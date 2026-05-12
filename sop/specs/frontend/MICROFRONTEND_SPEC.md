# 微前端架构规范

> 版本: v1.0 | 更新: 2026-05-12
> 覆盖: Wujie · qiankun · Module Federation · micro-app

## 1. 方案选型

| 方案 | 隔离方式 | 适用场景 | 推荐度 |
|------|---------|---------|--------|
| **Wujie** | WebComponent + Shadow DOM | Vue3 生态，高隔离 | ⭐⭐⭐⭐⭐ |
| **qiankun** | JS 沙箱 + CSS 隔离 | React/Vue 混合，蚂蚁生态 | ⭐⭐⭐⭐ |
| **Module Federation** | 编译时共享 | Webpack5+，同技术栈 | ⭐⭐⭐ |
| **micro-app** | WebComponent | 轻量，京东出品 | ⭐⭐⭐⭐ |

## 2. 主应用规范

```typescript
// src/micro/apps.ts
export interface MicroApp {
  name: string;           // 唯一标识
  entry: string;          // 子应用入口 URL
  container: string;      // 挂载容器选择器
  activeRule: string;     // 激活路由规则
  props?: Record<string, unknown>;  // 传递给子应用的数据
}

export const microApps: MicroApp[] = [
  {
    name: 'user-center',
    entry: process.env.VUE_APP_USER_URL!,
    container: '#micro-container',
    activeRule: '/micro/user',
    props: { theme: 'light' },
  },
];
```

```vue
<!-- 主应用布局 -->
<template>
  <div id="micro-container" />
</template>
```

## 3. 子应用规范

```typescript
// 子应用生命周期导出（qiankun）
let app: App | null = null;

export async function bootstrap() {}

export async function mount(props: { container: HTMLElement; token?: string }) {
  if (props.token) localStorage.setItem('token', props.token);
  app = createApp(App);
  app.use(router).use(pinia).mount(props.container.querySelector('#app')!);
}

export async function unmount() {
  app?.unmount();
  app = null;
}

// 独立运行时
if (!window.__POWERED_BY_QIANKUN__) {
  createApp(App).use(router).use(pinia).mount('#app');
}
```

## 4. 主子通信规范

```typescript
// ✅ 推荐：事件总线（解耦）
import mitt from 'mitt';

type MicroEvents = {
  'token:change': string;
  'theme:change': 'light' | 'dark';
  'navigate': { app: string; path: string };
};

export const bus = mitt<MicroEvents>();

// 主应用发送
bus.emit('token:change', newToken);

// 子应用监听
bus.on('token:change', (token) => {
  localStorage.setItem('token', token);
});
```

## 5. 样式隔离规范

```typescript
// qiankun 严格样式隔离
start({ sandbox: { strictStyleIsolation: true } });

// 子应用 CSS 加前缀（防污染）
// postcss.config.js
module.exports = {
  plugins: [
    require('postcss-prefix-selector')({
      prefix: '#sub-app-user',
      exclude: [':root', 'html', 'body'],
    }),
  ],
};
```

## 6. 性能规范

```typescript
// ✅ 预加载子应用
start({ prefetch: 'all' });

// ✅ 子应用缓存（不每次重新加载）
// qiankun 默认缓存，Wujie 需配置 alive: true
startApp({ name: 'user', alive: true });
```

## 7. 部署规范

```nginx
# 主应用 nginx.conf
server {
    location /micro/user/ {
        proxy_pass http://user-service:3001/;
    }
    location /micro/order/ {
        proxy_pass http://order-service:3002/;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**规范**：
- 子应用独立仓库、独立部署
- 子应用 URL 通过环境变量配置，不硬编码
- 主应用不依赖子应用的具体实现
