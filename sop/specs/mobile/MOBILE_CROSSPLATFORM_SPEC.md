# 移动端跨平台方案选型规范

> 版本: v1.0 | 更新: 2026-05-12
> 覆盖: Android · iOS · Android TV · Apple TV · HarmonyOS · 桌面端

## 1. 方案对比

| 维度 | Flutter | React Native | Kotlin Multiplatform | 原生 |
|------|---------|-------------|---------------------|------|
| 平台覆盖 | Android/iOS/Web/Desktop/TV | Android/iOS/Web | Android/iOS/Desktop | 单平台 |
| 性能 | 接近原生（自绘引擎） | 接近原生（桥接） | 原生 | 最优 |
| UI 一致性 | 完全一致 | 平台风格 | 共享逻辑，UI 各自 | 平台风格 |
| 生态 | pub.dev（丰富） | npm（最丰富） | 较小 | 最完整 |
| TV 支持 | ✅ Android TV / 需适配 | ⚠️ 有限 | ✅ | ✅ |
| HarmonyOS | ⚠️ 社区方案 | ⚠️ | ❌ | ✅ ArkTS |
| 推荐指数 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

## 2. 选型决策树

```
需要覆盖哪些平台？
│
├── Android + iOS（+ 可能的 Web/Desktop）
│   └── → Flutter（首选）
│
├── Android + iOS，团队 React 背景强
│   └── → React Native（Expo 托管工作流）
│
├── 逻辑共享，UI 各自原生
│   └── → Kotlin Multiplatform Mobile (KMM)
│
├── 仅 HarmonyOS
│   └── → ArkTS + ArkUI（原生）
│
└── 单平台，性能极致
    └── → 原生（Kotlin / Swift）
```

## 3. Flutter 为主方案（推荐）

详见 `FLUTTER_SPEC.md`。

### TV 平台特殊要求

**Android TV / Fire TV**：
```dart
// AndroidManifest.xml 需声明 TV 支持
// <uses-feature android:name="android.software.leanback" android:required="false"/>
// <uses-feature android:name="android.hardware.touchscreen" android:required="false"/>

// 焦点导航是核心，所有可交互元素必须可聚焦
// 使用 FocusTraversalGroup 控制焦点顺序
FocusTraversalGroup(
  policy: OrderedTraversalPolicy(),
  child: Row(children: [
    FocusTraversalOrder(order: NumericFocusOrder(1), child: button1),
    FocusTraversalOrder(order: NumericFocusOrder(2), child: button2),
  ]),
)
```

**Apple TV（tvOS）**：
- Flutter 官方不支持 tvOS，需要 `flutter_tvos` 社区插件或原生 SwiftUI
- 推荐：核心逻辑用 KMM 共享，UI 用 SwiftUI（tvOS）+ Flutter（其他平台）

### HarmonyOS 适配

```
方案 A（推荐）：Flutter + flutter_harmony 插件
  - 华为提供官方 Flutter 适配层
  - 代码复用率 ~90%

方案 B：ArkTS 原生开发
  - 完整 HarmonyOS 能力
  - 需要独立代码库
```

## 4. React Native 方案（备选）

适用场景：团队 React/JS 背景，Web + 移动端共享逻辑。

```typescript
// 推荐使用 Expo（简化配置）
// expo init MyApp --template expo-template-blank-typescript

// 平台判断
import { Platform } from 'react-native';

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    ...Platform.select({
      android: { elevation: 4 },
      ios: { shadowOpacity: 0.3 },
    }),
  },
});

// 平台专属文件
// Button.ios.tsx   ← iOS 专用
// Button.android.tsx ← Android 专用
// Button.tsx       ← 通用回退
```

**推荐依赖**：
```json
{
  "expo": "~52.0",
  "react-native": "0.76",
  "@react-navigation/native": "^7.0",
  "zustand": "^5.0",
  "@tanstack/react-query": "^5.0",
  "react-native-mmkv": "^3.0",
  "react-native-reanimated": "^3.0"
}
```

## 5. 多平台 CI/CD

```yaml
# .github/workflows/mobile.yml
jobs:
  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.24.x' }
      - run: flutter build appbundle --release
      - uses: r0adkll/upload-google-play@v1

  ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
      - run: flutter build ipa --release
      - uses: apple-actions/upload-testflight-build@v1

  android-tv:
    runs-on: ubuntu-latest
    steps:
      - uses: subosito/flutter-action@v2
      - run: flutter build apk --target-platform android-arm64 --release
```

## 6. 性能与质量标准

| 平台 | 启动时间 | 帧率 | 包大小 |
|------|---------|------|--------|
| Android 手机 | < 2s | 60fps | < 20MB |
| iOS | < 1.5s | 60fps | < 30MB |
| Android TV | < 3s | 60fps | < 25MB |
| 桌面端 | < 1s | 60fps | < 50MB |
