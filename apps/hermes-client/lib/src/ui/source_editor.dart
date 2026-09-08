import 'package:flutter/material.dart';
import 'package:re_editor/re_editor.dart';

class SourceEditor extends StatelessWidget {
  const SourceEditor({
    required this.controller,
    this.height = 220,
    super.key,
  });

  final CodeLineEditingController controller;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(8),
        ),
        child: CodeEditor(
          controller: controller,
          style: CodeEditorStyle(
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}
