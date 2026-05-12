# Flutter 跨平台开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 覆盖平台: Android · iOS · Web · Windows · macOS · Linux · TV（Android TV / Apple TV）

## 1. 平台覆盖策略

```
Flutter 单代码库 → 多平台产物

移动端:   Android (手机/平板/TV)  iOS (手机/iPad)
桌面端:   Windows  macOS  Linux
Web:      PWA / 浏览器
TV:       Android TV  (Apple TV 需 tvOS 适配)
```

**选型原则**：优先 Flutter，以下场景考虑原生：
- 需要深度系统集成（NFC、蓝牙 BLE 复杂协议）
- 性能极致要求（游戏引擎级别）
- 平台专属 UI 规范强制要求（如 Apple TV 焦点导航）

## 2. 项目结构

```
lib/
├── main.dart                    # 入口，平台检测
├── app/
│   ├── app.dart                 # MaterialApp / CupertinoApp
│   ├── router.dart              # go_router 路由配置
│   └── theme.dart               # 主题（含暗色模式）
├── core/
│   ├── di/                      # 依赖注入（get_it）
│   ├── network/                 # Dio + 拦截器
│   ├── storage/                 # 本地存储（hive / shared_preferences）
│   ├── error/                   # 错误处理
│   └── platform/                # 平台适配层
│       ├── platform_service.dart
│       ├── mobile_service.dart
│       ├── desktop_service.dart
│       └── tv_service.dart
├── features/                    # 功能模块（Feature-First 结构）
│   └── {feature}/
│       ├── data/
│       │   ├── datasources/
│       │   ├── models/
│       │   └── repositories/
│       ├── domain/
│       │   ├── entities/
│       │   ├── repositories/    # 抽象接口
│       │   └── usecases/
│       └── presentation/
│           ├── bloc/            # BLoC / Cubit
│           ├── pages/
│           └── widgets/
├── shared/
│   ├── widgets/                 # 跨功能公共组件
│   └── utils/
└── l10n/                        # 国际化
    ├── app_zh.arb
    └── app_en.arb
```

## 3. 状态管理规范

使用 **flutter_bloc**（BLoC/Cubit），规则：

```dart
// ✅ 简单状态用 Cubit
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);
  void increment() => emit(state + 1);
}

// ✅ 复杂状态用 BLoC（事件驱动）
// Event → BLoC → State
sealed class UserEvent {}
class UserLoadRequested extends UserEvent { final int id; UserLoadRequested(this.id); }

sealed class UserState {}
class UserInitial extends UserState {}
class UserLoading extends UserState {}
class UserLoaded extends UserState { final User user; UserLoaded(this.user); }
class UserError extends UserState { final String message; UserError(this.message); }

class UserBloc extends Bloc<UserEvent, UserState> {
  final GetUserUseCase _getUser;
  UserBloc(this._getUser) : super(UserInitial()) {
    on<UserLoadRequested>(_onLoadRequested);
  }

  Future<void> _onLoadRequested(UserLoadRequested event, Emitter<UserState> emit) async {
    emit(UserLoading());
    final result = await _getUser(event.id);
    result.fold(
      (failure) => emit(UserError(failure.message)),
      (user) => emit(UserLoaded(user)),
    );
  }
}
```

## 4. 平台适配规范

### 响应式布局
```dart
// ✅ 使用 LayoutBuilder 适配不同屏幕
class AdaptiveLayout extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 1200) return DesktopLayout();
        if (constraints.maxWidth >= 600) return TabletLayout();
        return MobileLayout();
      },
    );
  }
}

// ✅ 平台检测
import 'package:flutter/foundation.dart';

bool get isTV => _detectTV();
bool get isMobile => defaultTargetPlatform == TargetPlatform.android
    || defaultTargetPlatform == TargetPlatform.iOS;
bool get isDesktop => defaultTargetPlatform == TargetPlatform.windows
    || defaultTargetPlatform == TargetPlatform.macOS
    || defaultTargetPlatform == TargetPlatform.linux;
```

### TV 焦点导航
```dart
// ✅ TV 平台必须支持方向键导航
class TVFocusableButton extends StatelessWidget {
  final VoidCallback onPressed;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      child: Builder(
        builder: (context) {
          final focused = Focus.of(context).hasFocus;
          return GestureDetector(
            onTap: onPressed,
            child: Container(
              decoration: BoxDecoration(
                border: focused ? Border.all(color: Colors.white, width: 3) : null,
              ),
              child: child,
            ),
          );
        },
      ),
    );
  }
}
```

### 桌面端适配
```dart
// ✅ 桌面端支持鼠标悬停、右键菜单、键盘快捷键
class DesktopWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onSecondaryTap: () => _showContextMenu(context),
        child: Shortcuts(
          shortcuts: {
            LogicalKeySet(LogicalKeyboardKey.control, LogicalKeyboardKey.keyS):
                SaveIntent(),
          },
          child: Actions(
            actions: { SaveIntent: CallbackAction(onInvoke: (_) => _save()) },
            child: content,
          ),
        ),
      ),
    );
  }
}
```

## 5. 网络层规范

```dart
// ✅ Dio + 拦截器
class ApiClient {
  late final Dio _dio;

  ApiClient(String baseUrl) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ))
      ..interceptors.add(AuthInterceptor())
      ..interceptors.add(LogInterceptor(requestBody: kDebugMode));
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? params}) async {
    try {
      final res = await _dio.get(path, queryParameters: params);
      return res.data as T;
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }
}

class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = GetIt.I<AuthService>().token;
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.response?.statusCode == 401) {
      GetIt.I<AuthService>().logout();
    }
    handler.next(err);
  }
}
```

## 6. 本地存储规范

```dart
// ✅ 敏感数据用 flutter_secure_storage
final secureStorage = FlutterSecureStorage();
await secureStorage.write(key: 'token', value: token);
final token = await secureStorage.read(key: 'token');

// ✅ 普通数据用 Hive（高性能）
@HiveType(typeId: 0)
class UserCache extends HiveObject {
  @HiveField(0) late String id;
  @HiveField(1) late String name;
}

// ✅ 简单 KV 用 shared_preferences
final prefs = await SharedPreferences.getInstance();
await prefs.setString('theme', 'dark');
```

## 7. 推荐依赖版本

```yaml
# pubspec.yaml
dependencies:
  flutter_bloc: ^8.1.6
  go_router: ^14.0.0
  dio: ^5.7.0
  get_it: ^8.0.0
  hive_flutter: ^1.1.0
  flutter_secure_storage: ^9.2.2
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  fpdart: ^1.1.0          # 函数式编程（Either/Option）
  cached_network_image: ^3.4.1
  flutter_localizations:
    sdk: flutter

dev_dependencies:
  build_runner: ^2.4.13
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  bloc_test: ^9.1.7
  mocktail: ^1.0.4
```

## 8. 测试规范

```dart
// ✅ Widget 测试
testWidgets('LoginPage shows error on invalid email', (tester) async {
  await tester.pumpWidget(MaterialApp(home: LoginPage()));
  await tester.enterText(find.byKey(Key('email')), 'invalid');
  await tester.tap(find.byKey(Key('submit')));
  await tester.pump();
  expect(find.text('邮箱格式不正确'), findsOneWidget);
});

// ✅ BLoC 测试
blocTest<UserBloc, UserState>(
  'emits [Loading, Loaded] when load succeeds',
  build: () => UserBloc(mockGetUser),
  act: (bloc) => bloc.add(UserLoadRequested(1)),
  expect: () => [isA<UserLoading>(), isA<UserLoaded>()],
);
```

## 9. 发布规范

```bash
# Android
flutter build apk --release                    # APK
flutter build appbundle --release              # AAB（Google Play）
flutter build apk --target-platform android-arm64  # TV（ARM64）

# iOS
flutter build ipa --release

# Web
flutter build web --release --web-renderer canvaskit

# Desktop
flutter build windows --release
flutter build macos --release
flutter build linux --release
```

## 10. 性能规范

| 指标 | 目标 |
|------|------|
| 启动时间（冷启动） | < 2s |
| 帧率 | 60fps（TV 可 30fps） |
| 内存占用 | < 150MB（移动端） |
| APK 大小 | < 20MB（基础包） |

优化手段：
- 使用 `const` 构造函数（减少重建）
- 列表用 `ListView.builder`（懒加载）
- 图片用 `cached_network_image`
- 避免在 `build()` 中做计算
