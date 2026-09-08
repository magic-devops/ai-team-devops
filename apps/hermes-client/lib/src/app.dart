import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'pages/assets_page.dart';
import 'pages/automation_page.dart';
import 'pages/plan_page.dart';
import 'pages/runs_page.dart';
import 'pages/settings_page.dart';
import 'pages/workspaces_page.dart';
import 'theme.dart';

class HermesApp extends ConsumerWidget {
  const HermesApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Hermes',
      debugShowCheckedModeBanner: false,
      theme: HermesTheme.light,
      darkTheme: HermesTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: _router,
    );
  }
}

final _router = GoRouter(
  initialLocation: '/workspaces',
  routes: [
    GoRoute(path: '/', redirect: (_, __) => '/workspaces'),
    ShellRoute(
      builder: (context, state, child) => HermesShell(child: child),
      routes: [
        GoRoute(
            path: '/workspaces', builder: (_, __) => const WorkspacesPage()),
        GoRoute(path: '/plan', builder: (_, __) => const PlanPage()),
        GoRoute(path: '/runs', builder: (_, __) => const RunsPage()),
        GoRoute(
            path: '/automation', builder: (_, __) => const AutomationPage()),
        GoRoute(path: '/assets', builder: (_, __) => const AssetsPage()),
        GoRoute(path: '/settings', builder: (_, __) => const SettingsPage()),
      ],
    ),
  ],
);

class HermesShell extends StatefulWidget {
  const HermesShell({required this.child, super.key});

  final Widget child;

  @override
  State<HermesShell> createState() => _HermesShellState();
}

class _HermesShellState extends State<HermesShell> {
  static const _locations = [
    '/workspaces',
    '/plan',
    '/assets',
    '/runs',
    '/automation',
    '/settings'
  ];

  int _selectedIndex(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    final index = _locations.indexWhere(path.startsWith);
    return index < 0 ? 0 : index;
  }

  void _go(BuildContext context, int index) => context.go(_locations[index]);

  @override
  Widget build(BuildContext context) {
    final selected = _selectedIndex(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 760;
        final destinationWidgets = _destinations
            .map(
              (item) => NavigationDestination(
                icon: Icon(item.icon),
                label: item.label,
              ),
            )
            .toList();
        return Scaffold(
          body: SafeArea(
            child: Row(
              children: [
                if (!compact)
                  NavigationRail(
                    selectedIndex: selected,
                    onDestinationSelected: (index) => _go(context, index),
                    labelType: NavigationRailLabelType.all,
                    leading: const _BrandMark(),
                    destinations: _destinations
                        .map(
                          (item) => NavigationRailDestination(
                            icon: Icon(item.icon),
                            label: Text(item.label),
                          ),
                        )
                        .toList(),
                  ),
                Expanded(child: widget.child),
              ],
            ),
          ),
          bottomNavigationBar: compact
              ? NavigationBar(
                  selectedIndex: selected,
                  onDestinationSelected: (index) => _go(context, index),
                  destinations: destinationWidgets,
                )
              : null,
        );
      },
    );
  }
}

const _destinations = [
  _NavItem('工作台', Icons.dashboard_rounded),
  _NavItem('项目', Icons.account_tree_rounded),
  _NavItem('资产', Icons.inventory_2_rounded),
  _NavItem('收件箱', Icons.inbox_rounded),
  _NavItem('自动化', Icons.precision_manufacturing_rounded),
  _NavItem('设置', Icons.tune_rounded),
];

class _NavItem {
  const _NavItem(this.label, this.icon);

  final String label;
  final IconData icon;
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Column(
        children: [
          Icon(
            Icons.hub_rounded,
            color: Theme.of(context).colorScheme.primary,
            size: 30,
          ),
          const SizedBox(height: 8),
          Text('Hermes', style: Theme.of(context).textTheme.labelLarge),
        ],
      ),
    );
  }
}
