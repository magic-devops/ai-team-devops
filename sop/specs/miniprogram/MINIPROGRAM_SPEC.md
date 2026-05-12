# 小程序开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 覆盖: 微信小程序 · 支付宝小程序 · 抖音小程序 · 百度小程序 · 快手小程序 · H5

## 1. 跨平台方案选型

| 方案 | 覆盖平台 | 推荐场景 |
|------|---------|---------|
| **Taro 4.x**（推荐） | 微信/支付宝/抖音/百度/快手/H5/RN | 多端统一，React 语法 |
| **uni-app**（备选） | 同上 + App | Vue 语法，HBuilderX 生态 |
| **原生微信小程序** | 仅微信 | 深度微信能力，性能极致 |

**选型原则**：
- 需要覆盖 3+ 平台 → Taro（React 背景）或 uni-app（Vue 背景）
- 仅微信且需要深度能力（微信支付、直播、游戏）→ 原生
- 已有 React Native 项目 → Taro（代码复用）

## 2. Taro 项目规范

### 项目结构
```
src/
├── app.tsx                  # 全局入口
├── app.config.ts            # 全局配置（tabBar、pages）
├── pages/
│   └── {page}/
│       ├── index.tsx        # 页面组件
│       ├── index.config.ts  # 页面配置（navigationBarTitle）
│       └── index.module.scss
├── components/              # 公共组件
├── services/                # API 请求层
├── stores/                  # 状态管理（Zustand / Pinia）
├── hooks/                   # 自定义 Hooks
├── utils/
└── types/
```

### 页面组件规范
```tsx
// pages/home/index.tsx
import { View, Text, Button } from '@tarojs/components';
import Taro, { useLoad, useShareAppMessage } from '@tarojs/taro';
import { useState } from 'react';

// ✅ 页面必须定义分享
useShareAppMessage(() => ({
  title: '分享标题',
  path: '/pages/home/index',
}));

// ✅ 使用 Taro 生命周期（不用 useEffect 替代）
useLoad((options) => {
  console.log('页面加载参数:', options);
});

// ✅ 导航
Taro.navigateTo({ url: '/pages/detail/index?id=1' });
Taro.switchTab({ url: '/pages/home/index' });
```

### 网络请求规范
```typescript
// services/request.ts
import Taro from '@tarojs/taro';

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const token = Taro.getStorageSync('token');

  return new Promise((resolve, reject) => {
    Taro.request({
      url: `${process.env.TARO_APP_API_URL}${options.url}`,
      method: options.method ?? 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        if (res.statusCode === 401) {
          Taro.navigateTo({ url: '/pages/login/index' });
          reject(new Error('未登录'));
          return;
        }
        if (res.data.code !== 0) {
          reject(new Error(res.data.message));
          return;
        }
        resolve(res.data.data as T);
      },
      fail: (err) => reject(new Error(err.errMsg)),
    });
  });
}
```

### 登录规范
```typescript
// ✅ 微信小程序登录流程
async function wxLogin() {
  // 1. 获取 code
  const { code } = await Taro.login();

  // 2. 换取 token（后端调用微信 jscode2session）
  const { token, userInfo } = await request<LoginResult>({
    url: '/auth/wx-login',
    method: 'POST',
    data: { code },
  });

  // 3. 存储 token
  Taro.setStorageSync('token', token);

  // ✅ 不存储 openid（安全）
  // ✅ token 有效期 7 天，过期重新登录
}
```

## 3. uni-app 项目规范

### 项目结构
```
src/
├── pages/
│   └── {page}/
│       └── index.vue
├── components/
├── store/               # Pinia
├── api/
├── utils/
├── static/              # 静态资源
├── App.vue
├── main.ts
├── manifest.json        # 平台配置
└── pages.json           # 页面路由配置
```

### 平台差异处理
```vue
<template>
  <!-- ✅ 条件编译 -->
  <!-- #ifdef MP-WEIXIN -->
  <button open-type="getUserInfo">微信授权</button>
  <!-- #endif -->

  <!-- #ifdef MP-ALIPAY -->
  <button open-type="getAuthorize">支付宝授权</button>
  <!-- #endif -->

  <!-- #ifndef MP-WEIXIN -->
  <view>非微信平台内容</view>
  <!-- #endif -->
</template>

<script setup lang="ts">
// ✅ JS 条件编译
// #ifdef MP-WEIXIN
uni.login({ provider: 'weixin', success: (res) => {} });
// #endif
// #ifdef MP-ALIPAY
uni.login({ provider: 'alipay', success: (res) => {} });
// #endif
</script>
```

## 4. 原生微信小程序规范

### 文件结构
```
pages/
└── {page}/
    ├── index.wxml    # 模板
    ├── index.wxss    # 样式
    ├── index.ts      # 逻辑（TypeScript）
    └── index.json    # 页面配置
```

### TypeScript 配置
```typescript
// pages/home/index.ts
Page<{ list: Item[] }, { loading: boolean }>({
  data: {
    list: [],
    loading: false,
  },

  onLoad(options) {
    this.fetchList();
  },

  async fetchList() {
    this.setData({ loading: true });
    try {
      const list = await api.getList();
      this.setData({ list });
    } finally {
      this.setData({ loading: false });
    }
  },
});
```

## 5. 通用规范（所有小程序）

### 性能规范
```
setData 调用频率: < 20次/秒
单次 setData 数据量: < 256KB
页面节点数: < 1000 个
图片: 使用 CDN，WebP 格式，懒加载
分包: 主包 < 2MB，总包 < 20MB（微信限制）
```

### 分包策略
```json
// app.config.ts (Taro) / pages.json (uni-app)
{
  "subPackages": [
    {
      "root": "packageA",
      "pages": ["pages/detail/index", "pages/order/index"]
    },
    {
      "root": "packageB",
      "pages": ["pages/profile/index"]
    }
  ],
  "preloadRule": {
    "pages/home/index": {
      "network": "all",
      "packages": ["packageA"]
    }
  }
}
```

### 安全规范
```typescript
// ✅ 不在前端存储敏感信息
// ✅ openid 只在后端处理，不传给前端
// ✅ 支付签名在后端生成
// ✅ 用户手机号解密在后端进行

// ✅ 微信支付（后端签名）
const payParams = await api.createOrder(orderData);  // 后端返回签名参数
wx.requestPayment(payParams);
```

### 体验规范
```
页面加载: 骨架屏（Skeleton）替代 loading 转圈
列表: 下拉刷新 + 上拉加载更多
错误: 友好提示 + 重试按钮
空状态: 空态图 + 引导文案
网络异常: 离线提示 + 缓存数据展示
```

## 6. 小程序 CI/CD

```yaml
# miniprogram-ci 自动上传
- name: Upload to WeChat
  run: |
    npx miniprogram-ci upload \
      --pp ./dist/weixin \
      --pkp ./private.key \
      --appid ${{ secrets.WX_APPID }} \
      --uv ${{ github.ref_name }} \
      --desc "自动上传: ${{ github.sha }}"
```

## 7. 多端规范加载策略

| 目标平台 | 加载规范 |
|---------|---------|
| 微信小程序（原生） | 本文件 §4 |
| 多端小程序（Taro） | 本文件 §2 |
| 多端小程序（uni-app） | 本文件 §3 |
| 小程序 + App | `MOBILE_CROSSPLATFORM_SPEC.md` + 本文件 §3 |
