import 'package:flutter/material.dart';

class HermesTheme {
  static const _seed = Color(0xff2f6f68);

  static ThemeData get light => _build(Brightness.light);

  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: brightness,
      secondary: const Color(0xffa36a2d),
      tertiary: const Color(0xff4f6ea8),
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      visualDensity: VisualDensity.standard,
      cardTheme: const CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
        ),
      ),
    );
  }
}
