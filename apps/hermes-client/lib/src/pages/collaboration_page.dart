import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../models.dart';
import '../ui/common.dart';

class CollaborationPage extends ConsumerStatefulWidget {
  const CollaborationPage({super.key});

  @override
  ConsumerState<CollaborationPage> createState() => _CollaborationPageState();
}

class _CollaborationPageState extends ConsumerState<CollaborationPage> {
  var _tab = 0;
  var _includeArchived = false;
  var _selectedChannelId = '';
  var _selectedThreadId = '';
  var _requestKey = _newKey('collaboration');
  var _replyTo = '';
  var _messageBody = '';
  var _error = '';
  HermesEnvelope? _channels;
  HermesEnvelope? _threads;
  HermesEnvelope? _messages;
  HermesEnvelope? _inbox;
  List<String> _members = const [];
  HermesEnvelope? _preview;
  HermesEnvelope? _evidence;
  _Draft? _previewDraft;
  bool _loading = false;
  bool _mutating = false;
  bool _moreThreads = false;
  bool _moreMessages = false;
  String? _loadedScopeKey;
  String? _seenScopeKey;
  int _requestGeneration = 0;
  late final ProviderSubscription<String?> _workspaceSubscription;
  late final ProviderSubscription<AsyncValue<ConnectionSettings>>
      _settingsSubscription;

  @override
  void initState() {
    super.initState();
    _workspaceSubscription =
        ref.listenManual<String?>(workspaceSelectionProvider, (_, __) {
      _clearScope();
    });
    _settingsSubscription = ref.listenManual<AsyncValue<ConnectionSettings>>(
        settingsProvider, (_, __) {
      _clearScope();
    });
  }

  @override
  void dispose() {
    _workspaceSubscription.close();
    _settingsSubscription.close();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reloadIfNeeded();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider).asData?.value;
    final workspaceId = ref.watch(workspaceSelectionProvider);
    final currentScopeKey = _scopeKeyFor(settings, workspaceId);
    if (_seenScopeKey == null) {
      _seenScopeKey = currentScopeKey;
    } else if (_seenScopeKey != currentScopeKey) {
      _seenScopeKey = currentScopeKey;
      _requestGeneration++;
      _forgetScopeState();
    }
    final readiness = ref.watch(readinessProvider);
    final permissions = readiness.asData?.value.permissions ?? const [];
    final actor = (_channels?.audit['actor'] ??
            readiness.asData?.value.audit['actor'] ??
            '')
        .toString();
    final offline = settings?.isConfigured != true || workspaceId == null;
    final canRead = !offline && permissions.contains('read');
    final canWrite = canRead && permissions.contains('write');
    final canConfig = canRead && permissions.contains('config');
    final channels = _entities(_channels);
    final selectedChannel = _byId(channels, _selectedChannelId);
    final channelMembers = _stringList(selectedChannel?.data['members']);
    final threads = _entities(_threads);
    final selectedThread = _byId(threads, _selectedThreadId);
    final messages = _entities(_messages);
    final inbox = _entities(_inbox);
    _reloadIfNeeded();

    return WorkbenchPage(
      title: '团队消息',
      actions: [
        IconButton.filledTonal(
          tooltip: '刷新',
          onPressed: canRead && !_loading && !_mutating ? _refresh : null,
          icon: const Icon(Icons.refresh_rounded),
        ),
        GuardedAction(
          enabled: canConfig && !_mutating,
          reason: _disabledReason(offline, permissions, 'config'),
          child: FilledButton.icon(
            onPressed:
                canConfig && !_mutating ? () => _showChannelEditor() : null,
            icon: const Icon(Icons.add_rounded),
            label: const Text('频道'),
          ),
        ),
      ],
      child: Builder(builder: (context) {
        if (offline) {
          return const Center(
            child: ErrorState(message: 'Hermes 未连接。请先在设置中配置服务并选择工作区。'),
          );
        }
        if (readiness.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        if (readiness.hasError) {
          return Center(child: ErrorState(message: readiness.error.toString()));
        }
        if (!permissions.contains('read')) {
          return const Center(
            child: ErrorState(message: '当前身份没有 collaboration read 权限。'),
          );
        }
        return Column(
          children: [
            if (_error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _Banner(
                  icon: Icons.error_outline_rounded,
                  text: _error,
                  action:
                      TextButton(onPressed: _refresh, child: const Text('重试')),
                ),
              ),
            if (!canWrite)
              const Padding(
                padding: EdgeInsets.only(bottom: 10),
                child: _Banner(
                  icon: Icons.lock_outline_rounded,
                  text: '当前身份只读，发送、编辑、归档和已读操作已禁用。',
                ),
              ),
            Expanded(
              child: LayoutBuilder(builder: (context, constraints) {
                final mobile = constraints.maxWidth < 760;
                if (_tab == 1) {
                  return _InboxView(
                    loading: _loading,
                    items: inbox,
                    canWrite: canWrite,
                    mutating: _mutating,
                    onOpen: _openInboxItem,
                    onMarkRead: (item) => _markRead(item),
                  );
                }
                final channelList = _ChannelList(
                  channels: channels,
                  selectedId: _selectedChannelId,
                  includeArchived: _includeArchived,
                  loading: _loading,
                  mutating: _mutating,
                  onIncludeArchived: (value) {
                    setState(() {
                      _includeArchived = value;
                      _requestGeneration++;
                    });
                    _refresh();
                  },
                  onSelect: _openChannel,
                );
                final threadList = _ThreadList(
                  onMore: _moreThreads && !_loading && !_mutating
                      ? () => _loadThreads(append: true)
                      : null,
                  channel: selectedChannel,
                  threads: threads,
                  selectedId: _selectedThreadId,
                  loading: _loading,
                  includeArchived: _includeArchived,
                  canWrite: canWrite,
                  canConfig: canConfig,
                  mutating: _mutating,
                  onSelect: _openThread,
                  onNewThread: selectedChannel == null
                      ? null
                      : () => _showThreadEditor(selectedChannel),
                  onConfigure: selectedChannel == null
                      ? null
                      : () => _showChannelEditor(channel: selectedChannel),
                );
                final conversation = _Conversation(
                  onMore: _moreMessages && !_loading && !_mutating
                      ? () => _loadMessages(append: true)
                      : null,
                  actor: actor,
                  channel: selectedChannel,
                  thread: selectedThread,
                  messages: messages,
                  channelMembers: channelMembers,
                  canWrite: canWrite &&
                      selectedChannel?.status == 'active' &&
                      selectedThread?.status == 'active',
                  canConfig: canConfig,
                  requestReady: _previewDraft == _Draft.message &&
                      _preview != null &&
                      _messageBody.trim().isNotEmpty,
                  replyTo: _replyTo,
                  body: _messageBody,
                  loading: _loading,
                  mutating: _mutating,
                  onBodyChanged: (value) {
                    setState(() {
                      _messageBody = value;
                      _clearPreviewOnly();
                    });
                  },
                  onPreview: () => _sendMessage(dryRun: true),
                  onSend: () => _sendMessage(dryRun: false),
                  onReply: (message) => setState(() {
                    _replyTo = message.id;
                    _clearPreviewOnly();
                  }),
                  onClearReply: () => setState(() {
                    _replyTo = '';
                    _clearPreviewOnly();
                  }),
                  onEdit: (message) => _showMessageEditor(message),
                  onArchiveMessage: (message) => _archive('messages', message),
                  onArchiveThread: selectedThread == null
                      ? null
                      : () => _archive('threads', selectedThread),
                );
                if (mobile) {
                  if (_selectedChannelId.isEmpty) return channelList;
                  if (_selectedThreadId.isEmpty) {
                    return _MobileDetail(
                      title: selectedChannel?.title ?? '频道',
                      onBack: () => _openChannel(''),
                      child: threadList,
                    );
                  }
                  return _MobileDetail(
                    title: selectedThread?.title ?? '线程',
                    onBack: () => _openThread(''),
                    child: conversation,
                  );
                }
                return Row(
                  children: [
                    SizedBox(width: 260, child: channelList),
                    const VerticalDivider(width: 1),
                    SizedBox(width: 300, child: threadList),
                    const VerticalDivider(width: 1),
                    Expanded(child: conversation),
                  ],
                );
              }),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                SegmentedButton<int>(
                  segments: [
                    const ButtonSegment(
                        value: 0,
                        icon: Icon(Icons.tag_rounded),
                        label: Text('频道')),
                    ButtonSegment(
                        value: 1,
                        icon: const Icon(Icons.mark_email_unread_rounded),
                        label: Text('未读 ${inbox.length}')),
                  ],
                  selected: {_tab},
                  onSelectionChanged: (value) =>
                      setState(() => _tab = value.first),
                ),
                const SizedBox(width: 8),
                if (_evidence != null)
                  Expanded(
                    child: Tooltip(
                      message: 'trace ${_evidence!.traceId ?? '-'}',
                      child: Text(
                        'trace ${_evidence!.traceId ?? '-'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.end,
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        );
      }),
    );
  }

  void _reloadIfNeeded() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final settings = ref.read(settingsProvider).asData?.value;
      final workspaceId = ref.read(workspaceSelectionProvider);
      final key = '${settings?.baseUrl}|${settings?.token}|$workspaceId';
      if (settings?.isConfigured == true &&
          workspaceId != null &&
          _loadedScopeKey != key) {
        _loadedScopeKey = key;
        _clearDrafts();
        _refresh();
      }
    });
  }

  Future<void> _refresh() async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    final settings = ref.read(settingsProvider).asData?.value;
    if (settings?.isConfigured != true || workspaceId == null) return;
    final scopeKey = _scopeKey();
    final channelId = _selectedChannelId;
    final threadId = _selectedThreadId;
    final owner = _captureOwner();
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final client = ref.read(apiProvider);
      final members =
          await client.collaborationMembers(workspaceId: workspaceId);
      final channels = await client.collaborationChannels(
        workspaceId: workspaceId,
        includeArchived: _includeArchived,
      );
      final inbox = await client.collaborationInbox(workspaceId: workspaceId);
      HermesEnvelope? threads;
      HermesEnvelope? messages;
      if (channelId.isNotEmpty) {
        threads = await client.collaborationThreads(
          channelId,
          workspaceId: workspaceId,
          includeArchived: _includeArchived,
        );
      }
      if (threadId.isNotEmpty) {
        messages = await client.collaborationMessages(threadId,
            workspaceId: workspaceId);
      }
      if (!_owns(owner) || scopeKey != _scopeKey()) return;
      setState(() {
        _members = members;
        _channels = channels;
        _inbox = inbox;
        if (threads != null) {
          _threads = threads;
          _moreThreads = threads.items.length == 100;
        }
        if (messages != null) {
          _messages = messages;
          _moreMessages = messages.items.length == 100;
        }
      });
    } catch (error) {
      if (_owns(owner)) setState(() => _error = error.toString());
    } finally {
      if (_owns(owner)) setState(() => _loading = false);
    }
  }

  Future<void> _openChannel(String id) async {
    if (_mutating) return;
    setState(() {
      _selectedChannelId = id;
      _selectedThreadId = '';
      _threads = null;
      _messages = null;
      _moreThreads = false;
      _moreMessages = false;
      _requestGeneration++;
      _clearDrafts();
    });
    if (id.isEmpty) return;
    await _loadThreads();
  }

  Future<void> _openThread(String id) async {
    if (_mutating) return;
    setState(() {
      _selectedThreadId = id;
      _messages = null;
      _moreMessages = false;
      _requestGeneration++;
      _clearDrafts();
    });
    if (id.isEmpty) return;
    await _loadMessages();
  }

  Future<void> _loadThreads({bool append = false}) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    final channelId = _selectedChannelId;
    final owner = _captureOwner();
    if (workspaceId == null || channelId.isEmpty) return;
    setState(() => _loading = true);
    try {
      final result = await ref.read(apiProvider).collaborationThreads(
            channelId,
            workspaceId: workspaceId,
            includeArchived: _includeArchived,
            cursor:
                append ? (_threads?.summary['cursor'] ?? '').toString() : '',
          );
      if (_owns(owner) && _selectedChannelId == channelId) {
        setState(() {
          _threads = append ? _mergePage(_threads, result) : result;
          _moreThreads = result.items.length == 100;
        });
      }
    } catch (error) {
      if (_owns(owner)) setState(() => _error = error.toString());
    } finally {
      if (_owns(owner)) setState(() => _loading = false);
    }
  }

  Future<void> _loadMessages({bool append = false}) async {
    final workspaceId = ref.read(workspaceSelectionProvider);
    final threadId = _selectedThreadId;
    final owner = _captureOwner();
    if (workspaceId == null || threadId.isEmpty) return;
    setState(() => _loading = true);
    try {
      final result = await ref.read(apiProvider).collaborationMessages(threadId,
          workspaceId: workspaceId,
          after: append
              ? (_messages?.summary['cursor'] as num?)?.toInt() ?? 0
              : 0);
      if (_owns(owner) && _selectedThreadId == threadId) {
        setState(() {
          _messages = append ? _mergePage(_messages, result) : result;
          _moreMessages = result.items.length == 100;
        });
      }
    } catch (error) {
      if (_owns(owner)) setState(() => _error = error.toString());
    } finally {
      if (_owns(owner)) setState(() => _loading = false);
    }
  }

  Future<void> _showChannelEditor({HermesEntity? channel}) async {
    if (_mutating) return;
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null) return;
    final owner = _captureOwner();
    final result = await showDialog<_ChannelFormResult>(
      context: context,
      useRootNavigator: false,
      builder: (context) => _ChannelDialog(
        channel: channel,
        members: _members,
        requestKey: _requestKey,
        scopeKey: owner.scopeKey,
        providerContainer: owner.providerContainer,
        isCurrent: () => _owns(owner),
        onPreview: (value) =>
            _configureChannel(value, dryRun: true, owner: owner),
      ),
    );
    if (result == null || !_owns(owner)) return;
    await _configureChannel(result, dryRun: false, owner: owner);
  }

  Future<void> _showThreadEditor(HermesEntity channel) async {
    if (_mutating) return;
    final owner = _captureOwner();
    final channelId = channel.id;
    final result = await showDialog<_ThreadFormResult>(
      context: context,
      useRootNavigator: false,
      builder: (context) => _ThreadDialog(
        members: _stringList(channel.data['members']),
        requestKey: _requestKey,
        scopeKey: owner.scopeKey,
        providerContainer: owner.providerContainer,
        isCurrent: () => _owns(owner) && _selectedChannelId == channelId,
        onPreview: (value) => _createThread(value, dryRun: true, owner: owner),
      ),
    );
    if (result == null || !_owns(owner) || _selectedChannelId != channelId) {
      return;
    }
    await _createThread(result, dryRun: false, owner: owner);
  }

  Future<void> _showMessageEditor(HermesEntity message) async {
    if (_mutating) return;
    final channel = _byId(_entities(_channels), _selectedChannelId);
    final owner = _captureOwner();
    final messageId = message.id;
    final result = await showDialog<_MessageEditResult>(
      context: context,
      useRootNavigator: false,
      builder: (context) => _MessageEditDialog(
        message: message,
        members: _stringList(channel?.data['members']),
        requestKey: _requestKey,
        scopeKey: owner.scopeKey,
        providerContainer: owner.providerContainer,
        isCurrent: () => _owns(owner),
        onPreview: (value) =>
            _editMessage(message, value, dryRun: true, owner: owner),
      ),
    );
    if (result == null || !_owns(owner) || message.id != messageId) return;
    await _editMessage(message, result, dryRun: false, owner: owner);
  }

  Future<HermesEnvelope> _configureChannel(
    _ChannelFormResult value, {
    required bool dryRun,
    _ScopeOwner? owner,
  }) async {
    final workspaceId = ref.read(workspaceSelectionProvider)!;
    return _mutate(
      _Draft.channel,
      () => ref.read(apiProvider).collaborationConfigureChannel(
            value.id,
            workspaceId: workspaceId,
            title: value.title,
            members: value.members,
            description: value.description,
            archived: value.archived,
            expectedVersion: value.expectedVersion,
            idempotencyKey: _requestKey,
            dryRun: dryRun,
          ),
      dryRun: dryRun,
      owner: owner,
      afterApply: (result) {
        _selectedChannelId =
            _entities(result).firstOrNull?.id ?? _selectedChannelId;
        _selectedThreadId = '';
      },
    );
  }

  Future<HermesEnvelope> _createThread(
    _ThreadFormResult value, {
    required bool dryRun,
    _ScopeOwner? owner,
  }) async {
    final workspaceId = ref.read(workspaceSelectionProvider)!;
    final channelId = _selectedChannelId;
    return _mutate(
      _Draft.thread,
      () => ref.read(apiProvider).collaborationCreateThread(
            workspaceId: workspaceId,
            channelId: channelId,
            title: value.title,
            body: value.body,
            mentions: value.mentions,
            recipients: value.recipients,
            idempotencyKey: _requestKey,
            dryRun: dryRun,
          ),
      dryRun: dryRun,
      owner: owner,
      afterApply: (result) =>
          _selectedThreadId = _entities(result).firstOrNull?.id ?? '',
    );
  }

  Future<void> _sendMessage({required bool dryRun}) async {
    if (_mutating && !dryRun) return;
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null || _messageBody.trim().isEmpty) return;
    final channel = _byId(_entities(_channels), _selectedChannelId);
    final members = _stringList(channel?.data['members']);
    final owner = _captureOwner();
    final channelId = _selectedChannelId;
    final threadId = _selectedThreadId;
    final parentId = _replyTo;
    final body = _messageBody;
    await _mutate(
      _Draft.message,
      () => ref.read(apiProvider).collaborationSendMessage(
            workspaceId: workspaceId,
            channelId: channelId,
            threadId: threadId,
            parentId: parentId,
            body: body,
            mentions: const [],
            recipients: members,
            idempotencyKey: _requestKey,
            dryRun: dryRun,
          ),
      dryRun: dryRun,
      owner: owner,
      afterApply: (_) {
        _messageBody = '';
        _replyTo = '';
      },
    );
  }

  Future<HermesEnvelope> _editMessage(
    HermesEntity message,
    _MessageEditResult value, {
    required bool dryRun,
    _ScopeOwner? owner,
  }) async {
    final workspaceId = ref.read(workspaceSelectionProvider)!;
    return _mutate(
      _Draft.edit,
      () => ref.read(apiProvider).collaborationEditMessage(
            message.id,
            workspaceId: workspaceId,
            expectedVersion: message.version,
            body: value.body,
            mentions: value.mentions,
            idempotencyKey: _requestKey,
            dryRun: dryRun,
          ),
      dryRun: dryRun,
      owner: owner,
    );
  }

  Future<void> _archive(String resource, HermesEntity entity) async {
    if (_mutating) return;
    final owner = _captureOwner();
    final confirmed = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      builder: (context) => AlertDialog(
        title: Text('归档 ${entity.title}'),
        content: const Text('先预览再应用，应用后列表会刷新。'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('预览并归档')),
        ],
      ),
    );
    if (confirmed != true || !_owns(owner)) return;
    final workspaceId = ref.read(workspaceSelectionProvider)!;
    await _mutate(
      _Draft.archive,
      () => ref.read(apiProvider).collaborationArchive(
            resource,
            entity.id,
            workspaceId: workspaceId,
            expectedVersion: entity.version,
            idempotencyKey: _requestKey,
            dryRun: true,
          ),
      dryRun: true,
      owner: owner,
    );
    await _mutate(
      _Draft.archive,
      () => ref.read(apiProvider).collaborationArchive(
            resource,
            entity.id,
            workspaceId: workspaceId,
            expectedVersion: entity.version,
            idempotencyKey: _requestKey,
            dryRun: false,
          ),
      dryRun: false,
      owner: owner,
      afterApply: (_) {
        if (resource == 'threads') _selectedThreadId = '';
      },
    );
  }

  Future<void> _markRead(HermesEntity item) async {
    if (_mutating) return;
    final workspaceId = ref.read(workspaceSelectionProvider);
    if (workspaceId == null) return;
    final owner = _captureOwner();
    await _mutate(
      _Draft.read,
      () => ref.read(apiProvider).collaborationMarkRead(
            workspaceId: workspaceId,
            channelId: (item.data['channel_id'] ?? '').toString(),
            threadId: (item.data['thread_id'] ?? '').toString(),
            cursor: (item.data['event_seq'] as num?)?.toInt() ?? 0,
            idempotencyKey: _newKey('collaboration-read'),
            dryRun: false,
          ),
      dryRun: false,
      owner: owner,
    );
  }

  Future<HermesEnvelope> _mutate(
    _Draft draft,
    Future<HermesEnvelope> Function() run, {
    required bool dryRun,
    _ScopeOwner? owner,
    void Function(HermesEnvelope result)? afterApply,
  }) async {
    final mutationOwner = owner ?? _captureOwner();
    if (!_owns(mutationOwner)) {
      throw const HermesUnavailableException('Collaboration scope changed.');
    }
    setState(() {
      _mutating = true;
      _error = '';
    });
    try {
      final result = await run();
      if (!_owns(mutationOwner)) return result;
      setState(() {
        if (dryRun) {
          _preview = result;
          _previewDraft = draft;
        } else {
          _evidence = result;
          _clearDrafts();
          _mutating = false;
          afterApply?.call(result);
        }
      });
      if (!dryRun && _ownsRequest(mutationOwner)) {
        await _refresh();
      }
      return result;
    } catch (error) {
      if (_owns(mutationOwner)) {
        setState(() {
          _error = error.toString();
        });
      }
      rethrow;
    } finally {
      if (_ownsRequest(mutationOwner)) setState(() => _mutating = false);
    }
  }

  void _clearScope() {
    setState(() {
      _requestGeneration++;
      _seenScopeKey = _scopeKey();
      _forgetScopeState();
    });
    _reloadIfNeeded();
  }

  void _forgetScopeState() {
    _loadedScopeKey = null;
    _channels = null;
    _threads = null;
    _messages = null;
    _moreThreads = false;
    _moreMessages = false;
    _inbox = null;
    _members = const [];
    _evidence = null;
    _error = '';
    _loading = false;
    _mutating = false;
    _selectedChannelId = '';
    _selectedThreadId = '';
    _clearDrafts();
  }

  void _clearDrafts() {
    _requestKey = _newKey('collaboration');
    _replyTo = '';
    _messageBody = '';
    _clearPreviewOnly();
  }

  void _clearPreviewOnly() {
    _preview = null;
    _previewDraft = null;
  }

  Future<void> _openInboxItem(HermesEntity item) async {
    if (_mutating) return;
    final channelId = (item.data['channel_id'] ?? '').toString();
    final threadId = (item.data['thread_id'] ?? '').toString();
    final owner = _captureOwner();
    setState(() => _tab = 0);
    await _openChannel(channelId);
    if (!_ownsCurrentScope(owner) || _selectedChannelId != channelId) return;
    await _openThread(threadId);
  }

  _ScopeOwner _captureOwner() => _ScopeOwner(
        scopeKey: _scopeKey(),
        providerContainer: ProviderScope.containerOf(context),
        channelId: _selectedChannelId,
        threadId: _selectedThreadId,
        includeArchived: _includeArchived,
        generation: ++_requestGeneration,
      );

  bool _owns(_ScopeOwner owner) {
    return _ownsRequest(owner) &&
        _selectedChannelId == owner.channelId &&
        _selectedThreadId == owner.threadId;
  }

  bool _ownsRequest(_ScopeOwner owner) =>
      _ownsCurrentScope(owner) && _requestGeneration == owner.generation;

  bool _ownsCurrentScope(_ScopeOwner owner) {
    return mounted &&
        _containerScopeKey(owner.providerContainer) == owner.scopeKey &&
        _includeArchived == owner.includeArchived;
  }

  String _scopeKey() {
    final settings = ref.read(settingsProvider).asData?.value;
    final workspaceId = ref.read(workspaceSelectionProvider);
    return _scopeKeyFor(settings, workspaceId);
  }
}

enum _Draft { channel, thread, message, edit, archive, read }

class _ScopeOwner {
  const _ScopeOwner({
    required this.scopeKey,
    required this.providerContainer,
    required this.channelId,
    required this.threadId,
    required this.includeArchived,
    required this.generation,
  });

  final String scopeKey;
  final ProviderContainer providerContainer;
  final String channelId;
  final String threadId;
  final bool includeArchived;
  final int generation;
}

class _ChannelList extends StatelessWidget {
  const _ChannelList({
    required this.channels,
    required this.selectedId,
    required this.includeArchived,
    required this.loading,
    required this.mutating,
    required this.onIncludeArchived,
    required this.onSelect,
  });

  final List<HermesEntity> channels;
  final String selectedId;
  final bool includeArchived;
  final bool loading;
  final bool mutating;
  final ValueChanged<bool> onIncludeArchived;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return _Pane(
      title: '频道',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('归档'),
          Switch(
              value: includeArchived,
              onChanged: mutating ? null : onIncludeArchived),
        ],
      ),
      child: loading && channels.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : channels.isEmpty
              ? const _EmptyText('暂无频道')
              : ListView.separated(
                  itemCount: channels.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 6),
                  itemBuilder: (context, index) {
                    final item = channels[index];
                    return _SelectableTile(
                      selected: item.id == selectedId,
                      icon: Icons.tag_rounded,
                      title: item.title,
                      subtitle:
                          '${_stringList(item.data['members']).length} members · ${item.status}',
                      onTap: mutating ? null : () => onSelect(item.id),
                    );
                  },
                ),
    );
  }
}

class _ThreadList extends StatelessWidget {
  const _ThreadList({
    this.onMore,
    required this.channel,
    required this.threads,
    required this.selectedId,
    required this.loading,
    required this.includeArchived,
    required this.canWrite,
    required this.canConfig,
    required this.mutating,
    required this.onSelect,
    required this.onNewThread,
    required this.onConfigure,
  });

  final HermesEntity? channel;
  final VoidCallback? onMore;
  final List<HermesEntity> threads;
  final String selectedId;
  final bool loading;
  final bool includeArchived;
  final bool canWrite;
  final bool canConfig;
  final bool mutating;
  final ValueChanged<String> onSelect;
  final VoidCallback? onNewThread;
  final VoidCallback? onConfigure;

  @override
  Widget build(BuildContext context) {
    return _Pane(
      title: channel == null
          ? '线程'
          : includeArchived
              ? '${channel!.title} · 含归档'
              : channel!.title,
      trailing: Wrap(
        spacing: 4,
        children: [
          IconButton(
            tooltip: '配置频道',
            onPressed: canConfig && !mutating ? onConfigure : null,
            icon: const Icon(Icons.tune_rounded),
          ),
          IconButton.filledTonal(
            tooltip: '新线程',
            onPressed: canWrite && channel?.status == 'active' && !mutating
                ? onNewThread
                : null,
            icon: const Icon(Icons.add_comment_rounded),
          ),
        ],
      ),
      child: channel == null
          ? const _EmptyText('选择频道查看线程')
          : loading && threads.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : threads.isEmpty
                  ? const _EmptyText('暂无线程')
                  : ListView.separated(
                      itemCount: threads.length + (onMore == null ? 0 : 1),
                      separatorBuilder: (_, __) => const SizedBox(height: 6),
                      itemBuilder: (context, index) {
                        if (index == threads.length) {
                          return TextButton(
                              onPressed: onMore, child: const Text('加载更多主题'));
                        }
                        final item = threads[index];
                        return _SelectableTile(
                          selected: item.id == selectedId,
                          icon: Icons.forum_rounded,
                          title: item.title,
                          subtitle: '${item.status} · v${item.version}',
                          onTap: mutating ? null : () => onSelect(item.id),
                        );
                      },
                    ),
    );
  }
}

class _Conversation extends StatelessWidget {
  const _Conversation({
    this.onMore,
    required this.actor,
    required this.channel,
    required this.thread,
    required this.messages,
    required this.channelMembers,
    required this.canWrite,
    required this.canConfig,
    required this.requestReady,
    required this.replyTo,
    required this.body,
    required this.loading,
    required this.mutating,
    required this.onBodyChanged,
    required this.onPreview,
    required this.onSend,
    required this.onReply,
    required this.onClearReply,
    required this.onEdit,
    required this.onArchiveMessage,
    required this.onArchiveThread,
  });

  final String actor;
  final VoidCallback? onMore;
  final HermesEntity? channel;
  final HermesEntity? thread;
  final List<HermesEntity> messages;
  final List<String> channelMembers;
  final bool canWrite;
  final bool canConfig;
  final bool requestReady;
  final String replyTo;
  final String body;
  final bool loading;
  final bool mutating;
  final ValueChanged<String> onBodyChanged;
  final VoidCallback onPreview;
  final VoidCallback onSend;
  final ValueChanged<HermesEntity> onReply;
  final VoidCallback onClearReply;
  final ValueChanged<HermesEntity> onEdit;
  final ValueChanged<HermesEntity> onArchiveMessage;
  final VoidCallback? onArchiveThread;

  @override
  Widget build(BuildContext context) {
    return _Pane(
      title: thread?.title ?? '消息',
      trailing: IconButton(
        tooltip: '归档线程',
        onPressed:
            canWrite && !mutating && thread != null ? onArchiveThread : null,
        icon: const Icon(Icons.archive_rounded),
      ),
      child: thread == null
          ? const _EmptyText('选择线程查看消息')
          : Column(
              children: [
                Expanded(
                  child: loading && messages.isEmpty
                      ? const Center(child: CircularProgressIndicator())
                      : messages.isEmpty
                          ? const _EmptyText('暂无消息')
                          : ListView.separated(
                              itemCount:
                                  messages.length + (onMore == null ? 0 : 1),
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                if (index == messages.length) {
                                  return TextButton(
                                      onPressed: onMore,
                                      child: const Text('加载更多消息'));
                                }
                                final item = messages[index];
                                final author =
                                    (item.data['author'] ?? '').toString();
                                final editable = canWrite &&
                                    !mutating &&
                                    item.status == 'active' &&
                                    (author == actor || canConfig);
                                return Padding(
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 10),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              author.isEmpty
                                                  ? 'unknown'
                                                  : author,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .labelLarge,
                                            ),
                                          ),
                                          Text('v${item.version}',
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .labelSmall),
                                          IconButton(
                                            tooltip: '回复',
                                            onPressed: canWrite && !mutating
                                                ? () => onReply(item)
                                                : null,
                                            icon:
                                                const Icon(Icons.reply_rounded),
                                          ),
                                          IconButton(
                                            tooltip: '编辑',
                                            onPressed: editable
                                                ? () => onEdit(item)
                                                : null,
                                            icon:
                                                const Icon(Icons.edit_rounded),
                                          ),
                                          IconButton(
                                            tooltip: '归档消息',
                                            onPressed: editable
                                                ? () => onArchiveMessage(item)
                                                : null,
                                            icon: const Icon(
                                                Icons.archive_rounded),
                                          ),
                                        ],
                                      ),
                                      if ((item.data['parent_id'] ?? '')
                                          .toString()
                                          .isNotEmpty)
                                        Text(
                                            '回复 ${(item.data['parent_id']).toString()}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .labelSmall),
                                      Text(
                                          (item.data['body'] ?? '').toString()),
                                      Wrap(
                                        spacing: 4,
                                        children: [
                                          for (final mention in _stringList(
                                              item.data['mentions']))
                                            Chip(
                                              label: Text('@$mention'),
                                              visualDensity:
                                                  VisualDensity.compact,
                                            ),
                                        ],
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                ),
                const SizedBox(height: 8),
                if (replyTo.isNotEmpty)
                  _Banner(
                    icon: Icons.reply_rounded,
                    text: '回复 $replyTo',
                    action: TextButton(
                        onPressed: onClearReply, child: const Text('清除')),
                  ),
                const SizedBox(height: 8),
                _MessageInput(
                  key: ValueKey(thread?.id),
                  enabled: canWrite && !mutating,
                  body: body,
                  label: channelMembers.isEmpty
                      ? '消息'
                      : '消息，将发送给 ${channelMembers.length} 位频道成员',
                  onChanged: onBodyChanged,
                ),
                Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: canWrite && body.trim().isNotEmpty && !mutating
                          ? onPreview
                          : null,
                      icon: const Icon(Icons.fact_check_rounded),
                      label: const Text('预览'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      onPressed:
                          canWrite && requestReady && !mutating ? onSend : null,
                      icon: const Icon(Icons.send_rounded),
                      label: const Text('发送'),
                    ),
                    if (requestReady) ...[
                      const SizedBox(width: 8),
                      const Chip(label: Text('预览就绪')),
                    ],
                  ],
                ),
              ],
            ),
    );
  }
}

class _MessageInput extends StatefulWidget {
  const _MessageInput(
      {super.key,
      required this.body,
      required this.label,
      required this.enabled,
      required this.onChanged});
  final String body;
  final String label;
  final bool enabled;
  final ValueChanged<String> onChanged;
  @override
  State<_MessageInput> createState() => _MessageInputState();
}

class _MessageInputState extends State<_MessageInput> {
  late final _controller = TextEditingController(text: widget.body);
  @override
  void didUpdateWidget(covariant _MessageInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_controller.text != widget.body) {
      _controller.value = TextEditingValue(
          text: widget.body,
          selection: TextSelection.collapsed(offset: widget.body.length));
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
        controller: _controller,
        enabled: widget.enabled,
        minLines: 3,
        maxLines: 6,
        maxLength: 8000,
        onChanged: widget.onChanged,
        decoration: InputDecoration(
            labelText: widget.label, border: const OutlineInputBorder()),
      );
}

class _ChannelDialog extends ConsumerStatefulWidget {
  const _ChannelDialog({
    required this.channel,
    required this.members,
    required this.requestKey,
    required this.scopeKey,
    required this.providerContainer,
    required this.isCurrent,
    required this.onPreview,
  });

  final HermesEntity? channel;
  final List<String> members;
  final String requestKey;
  final String scopeKey;
  final ProviderContainer providerContainer;
  final bool Function() isCurrent;
  final Future<HermesEnvelope> Function(_ChannelFormResult value) onPreview;

  @override
  ConsumerState<_ChannelDialog> createState() => _ChannelDialogState();
}

class _ChannelDialogState extends ConsumerState<_ChannelDialog> {
  final _form = GlobalKey<FormState>();
  late final _id = TextEditingController(
      text: (widget.channel?.data['logical_id'] ?? widget.channel?.id ?? '')
          .toString());
  late final _title = TextEditingController(text: widget.channel?.title ?? '');
  late final _description = TextEditingController(
      text: (widget.channel?.data['description'] ?? '').toString());
  late final Set<String> _selected =
      _stringList(widget.channel?.data['members']).toSet();
  late var _archived = widget.channel?.status == 'archived';
  HermesEnvelope? _preview;
  String _error = '';
  bool _previewing = false;
  int _editEpoch = 0;

  void _invalidatePreview() => setState(() {
        _preview = null;
        _editEpoch++;
      });

  @override
  void dispose() {
    _id.dispose();
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scopeCurrent = _watchedScopeKey(ref) == widget.scopeKey;
    return AlertDialog(
      title: Text(widget.channel == null ? '配置频道' : '编辑频道'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _form,
          onChanged: _invalidatePreview,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_error.isNotEmpty)
                  _Banner(icon: Icons.error_outline, text: _error),
                TextFormField(
                  controller: _id,
                  enabled: widget.channel == null,
                  maxLength: 64,
                  decoration: const InputDecoration(labelText: '频道逻辑 ID'),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '必填' : null,
                ),
                TextFormField(
                  controller: _title,
                  maxLength: 120,
                  decoration: const InputDecoration(labelText: '标题'),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '必填' : null,
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final member in widget.members)
                        FilterChip(
                          label: Text(member),
                          selected: _selected.contains(member),
                          onSelected: (selected) => setState(() {
                            selected
                                ? _selected.add(member)
                                : _selected.remove(member);
                            _preview = null;
                            _editEpoch++;
                          }),
                        ),
                    ],
                  ),
                ),
                TextFormField(
                  controller: _description,
                  maxLength: 2000,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: '描述'),
                ),
                SwitchListTile(
                  value: _archived,
                  title: const Text('归档'),
                  onChanged: (value) => setState(() {
                    _archived = value;
                    _preview = null;
                    _editEpoch++;
                  }),
                ),
                if (_preview != null) _Evidence(envelope: _preview!),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
        OutlinedButton(
          onPressed: scopeCurrent && !_previewing ? _previewAction : null,
          child: const Text('预览'),
        ),
        FilledButton(
          onPressed: _preview == null || !scopeCurrent || _previewing
              ? null
              : () => Navigator.pop(context, _value()),
          child: const Text('应用'),
        ),
      ],
    );
  }

  Future<void> _previewAction() async {
    if (_previewing || !_form.currentState!.validate() || _selected.isEmpty) {
      return;
    }
    final epoch = _editEpoch;
    setState(() {
      _previewing = true;
      _preview = null;
    });
    try {
      final result = await widget.onPreview(_value());
      if (!mounted ||
          epoch != _editEpoch ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() {
        _preview = result;
        _error = '';
      });
    } catch (error) {
      if (!mounted ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  _ChannelFormResult _value() => _ChannelFormResult(
        id: _id.text.trim(),
        title: _title.text.trim(),
        description: _description.text.trim(),
        members: _selected.toList()..sort(),
        archived: _archived,
        expectedVersion: widget.channel?.version,
      );
}

class _ThreadDialog extends ConsumerStatefulWidget {
  const _ThreadDialog({
    required this.members,
    required this.requestKey,
    required this.scopeKey,
    required this.providerContainer,
    required this.isCurrent,
    required this.onPreview,
  });

  final List<String> members;
  final String requestKey;
  final String scopeKey;
  final ProviderContainer providerContainer;
  final bool Function() isCurrent;
  final Future<HermesEnvelope> Function(_ThreadFormResult value) onPreview;

  @override
  ConsumerState<_ThreadDialog> createState() => _ThreadDialogState();
}

class _ThreadDialogState extends ConsumerState<_ThreadDialog> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _body = TextEditingController();
  final Set<String> _mentions = {};
  final Set<String> _recipients = {};
  HermesEnvelope? _preview;
  String _error = '';
  bool _previewing = false;
  int _editEpoch = 0;

  void _invalidatePreview() => setState(() {
        _preview = null;
        _editEpoch++;
      });

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _recipients.addAll(widget.members);
  }

  @override
  Widget build(BuildContext context) {
    final scopeCurrent = _watchedScopeKey(ref) == widget.scopeKey;
    return AlertDialog(
      title: const Text('新线程'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _form,
          onChanged: _invalidatePreview,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_error.isNotEmpty)
                  _Banner(icon: Icons.error_outline, text: _error),
                TextFormField(
                  controller: _title,
                  maxLength: 160,
                  decoration: const InputDecoration(labelText: '标题'),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '必填' : null,
                ),
                TextFormField(
                  controller: _body,
                  maxLength: 8000,
                  minLines: 4,
                  maxLines: 8,
                  decoration: const InputDecoration(labelText: '首条消息'),
                ),
                _IdentityChips(
                    title: '提及',
                    members: widget.members,
                    selected: _mentions,
                    onChanged: _invalidatePreview),
                _IdentityChips(
                    title: '接收人',
                    members: widget.members,
                    selected: _recipients,
                    onChanged: _invalidatePreview),
                if (_preview != null) _Evidence(envelope: _preview!),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
        OutlinedButton(
            onPressed: scopeCurrent && !_previewing ? _previewAction : null,
            child: const Text('预览')),
        FilledButton(
            onPressed: _preview == null || !scopeCurrent || _previewing
                ? null
                : () => Navigator.pop(context, _value()),
            child: const Text('应用')),
      ],
    );
  }

  Future<void> _previewAction() async {
    if (_previewing || !_form.currentState!.validate()) return;
    final epoch = _editEpoch;
    setState(() {
      _previewing = true;
      _preview = null;
    });
    try {
      final result = await widget.onPreview(_value());
      if (!mounted ||
          epoch != _editEpoch ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() {
        _preview = result;
        _error = '';
      });
    } catch (error) {
      if (!mounted ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  _ThreadFormResult _value() => _ThreadFormResult(
        title: _title.text.trim(),
        body: _body.text.trim(),
        mentions: _mentions.toList()..sort(),
        recipients: _recipients.toList()..sort(),
      );
}

class _MessageEditDialog extends ConsumerStatefulWidget {
  const _MessageEditDialog({
    required this.message,
    required this.members,
    required this.requestKey,
    required this.scopeKey,
    required this.providerContainer,
    required this.isCurrent,
    required this.onPreview,
  });

  final HermesEntity message;
  final List<String> members;
  final String requestKey;
  final String scopeKey;
  final ProviderContainer providerContainer;
  final bool Function() isCurrent;
  final Future<HermesEnvelope> Function(_MessageEditResult value) onPreview;

  @override
  ConsumerState<_MessageEditDialog> createState() => _MessageEditDialogState();
}

class _MessageEditDialogState extends ConsumerState<_MessageEditDialog> {
  final _form = GlobalKey<FormState>();
  late final _body = TextEditingController(
      text: (widget.message.data['body'] ?? '').toString());
  late final Set<String> _mentions =
      _stringList(widget.message.data['mentions']).toSet();
  HermesEnvelope? _preview;
  String _error = '';
  bool _previewing = false;
  int _editEpoch = 0;

  void _invalidatePreview() => setState(() {
        _preview = null;
        _editEpoch++;
      });

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scopeCurrent = _watchedScopeKey(ref) == widget.scopeKey;
    return AlertDialog(
      title: const Text('编辑消息'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _form,
          onChanged: _invalidatePreview,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_error.isNotEmpty)
                _Banner(icon: Icons.error_outline, text: _error),
              TextFormField(
                controller: _body,
                maxLength: 8000,
                minLines: 5,
                maxLines: 10,
                decoration: const InputDecoration(labelText: '消息'),
                validator: (value) =>
                    value == null || value.trim().isEmpty ? '必填' : null,
              ),
              _IdentityChips(
                  title: '提及',
                  members: widget.members,
                  selected: _mentions,
                  onChanged: _invalidatePreview),
              if (_preview != null) _Evidence(envelope: _preview!),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
        OutlinedButton(
            onPressed: scopeCurrent && !_previewing ? _previewAction : null,
            child: const Text('预览')),
        FilledButton(
            onPressed: _preview == null || !scopeCurrent || _previewing
                ? null
                : () => Navigator.pop(context, _value()),
            child: const Text('应用')),
      ],
    );
  }

  Future<void> _previewAction() async {
    if (_previewing || !_form.currentState!.validate()) return;
    final epoch = _editEpoch;
    setState(() {
      _previewing = true;
      _preview = null;
    });
    try {
      final result = await widget.onPreview(_value());
      if (!mounted ||
          epoch != _editEpoch ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() {
        _preview = result;
        _error = '';
      });
    } catch (error) {
      if (!mounted ||
          !widget.isCurrent() ||
          _containerScopeKey(widget.providerContainer) != widget.scopeKey) {
        return;
      }
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  _MessageEditResult _value() => _MessageEditResult(
        body: _body.text.trim(),
        mentions: _mentions.toList()..sort(),
      );
}

class _IdentityChips extends StatefulWidget {
  const _IdentityChips({
    required this.title,
    required this.members,
    required this.selected,
    required this.onChanged,
  });

  final String title;
  final List<String> members;
  final Set<String> selected;
  final VoidCallback onChanged;

  @override
  State<_IdentityChips> createState() => _IdentityChipsState();
}

class _IdentityChipsState extends State<_IdentityChips> {
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final member in widget.members)
                  FilterChip(
                    label: Text(member),
                    selected: widget.selected.contains(member),
                    onSelected: (selected) => setState(() {
                      selected
                          ? widget.selected.add(member)
                          : widget.selected.remove(member);
                      widget.onChanged();
                    }),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MobileDetail extends StatelessWidget {
  const _MobileDetail({
    required this.title,
    required this.onBack,
    required this.child,
  });

  final String title;
  final VoidCallback onBack;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            IconButton(
              tooltip: '返回',
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            Expanded(
              child: Text(title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium),
            ),
          ],
        ),
        Expanded(child: child),
      ],
    );
  }
}

class _Pane extends StatelessWidget {
  const _Pane({required this.title, required this.child, this.trailing});

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 8),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _SelectableTile extends StatelessWidget {
  const _SelectableTile({
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.secondaryContainer : scheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(8),
      child: ListTile(
        dense: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        leading: Icon(icon, size: 18),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
        selected: selected,
        onTap: onTap,
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, this.action});

  final IconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
          if (action != null) action!,
        ],
      ),
    );
  }
}

class _EmptyText extends StatelessWidget {
  const _EmptyText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(child: Text(text));
  }
}

class _Evidence extends StatelessWidget {
  const _Evidence({required this.envelope});

  final HermesEnvelope envelope;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: const Text('预览证据'),
      subtitle: Text('trace ${envelope.traceId ?? '-'}'),
      children: [
        SelectableText(
          const JsonEncoder.withIndent('  ').convert({
            'summary': envelope.summary,
            'audit': envelope.audit,
          }),
        ),
      ],
    );
  }
}

class _InboxView extends StatelessWidget {
  const _InboxView({
    required this.loading,
    required this.items,
    required this.canWrite,
    required this.mutating,
    required this.onOpen,
    required this.onMarkRead,
  });

  final bool loading;
  final List<HermesEntity> items;
  final bool canWrite;
  final bool mutating;
  final ValueChanged<HermesEntity> onOpen;
  final ValueChanged<HermesEntity> onMarkRead;

  @override
  Widget build(BuildContext context) {
    if (loading && items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (items.isEmpty) return const _EmptyText('暂无未读');
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final item = items[index];
        return ListTile(
          leading: const Icon(Icons.mark_email_unread_rounded),
          title: Text((item.data['body'] ?? '').toString(),
              maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text(
              '${item.data['author'] ?? ''} · cursor ${item.data['event_seq'] ?? 0}'),
          onTap: mutating ? null : () => onOpen(item),
          trailing: IconButton(
            tooltip: '标记已读',
            onPressed: canWrite && !mutating ? () => onMarkRead(item) : null,
            icon: const Icon(Icons.done_all_rounded),
          ),
        );
      },
    );
  }
}

class _ChannelFormResult {
  const _ChannelFormResult({
    required this.id,
    required this.title,
    required this.description,
    required this.members,
    required this.archived,
    this.expectedVersion,
  });

  final String id;
  final String title;
  final String description;
  final List<String> members;
  final bool archived;
  final int? expectedVersion;
}

class _ThreadFormResult {
  const _ThreadFormResult({
    required this.title,
    required this.body,
    required this.mentions,
    required this.recipients,
  });

  final String title;
  final String body;
  final List<String> mentions;
  final List<String> recipients;
}

class _MessageEditResult {
  const _MessageEditResult({required this.body, required this.mentions});

  final String body;
  final List<String> mentions;
}

List<HermesEntity> _entities(HermesEnvelope? envelope) {
  return envelope?.items
          .whereType<Map>()
          .map((item) => HermesEntity.fromJson(Map<String, dynamic>.from(item)))
          .toList() ??
      const [];
}

HermesEntity? _byId(List<HermesEntity> items, String id) {
  for (final item in items) {
    if (item.id == id) return item;
  }
  return null;
}

List<String> _stringList(Object? value) {
  if (value is! List) return const [];
  return value
      .map((item) => item.toString())
      .where((item) => item.isNotEmpty)
      .toList();
}

String _disabledReason(bool offline, List<String> permissions, String needed) {
  if (offline) return 'Hermes 未连接或未选择工作区';
  if (!permissions.contains(needed)) return '缺少 $needed 权限';
  return '';
}

String _watchedScopeKey(WidgetRef ref) {
  final settings = ref.watch(settingsProvider).asData?.value;
  final workspaceId = ref.watch(workspaceSelectionProvider);
  return _scopeKeyFor(settings, workspaceId);
}

String _containerScopeKey(ProviderContainer container) {
  final settings = container.read(settingsProvider).asData?.value;
  final workspaceId = container.read(workspaceSelectionProvider);
  return _scopeKeyFor(settings, workspaceId);
}

String _scopeKeyFor(ConnectionSettings? settings, String? workspaceId) {
  return '${settings?.baseUrl}|${settings?.token}|$workspaceId';
}

HermesEnvelope _mergePage(HermesEnvelope? previous, HermesEnvelope next) {
  final rows = <String, dynamic>{};
  for (final row in [...?previous?.items, ...next.items]) {
    if (row is Map && row['id'] is String) rows[row['id'] as String] = row;
  }
  return HermesEnvelope(
      ok: next.ok,
      scope: next.scope,
      summary: next.summary,
      items: rows.values.toList(),
      actions: next.actions,
      permissions: next.permissions,
      audit: next.audit,
      traceId: next.traceId,
      error: next.error);
}

String _newKey(String prefix) =>
    '$prefix-${DateTime.now().toUtc().microsecondsSinceEpoch}';
