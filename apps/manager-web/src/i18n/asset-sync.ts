export const assetSyncTranslations = {
  "zh-CN": {
    title: "高级资产同步",
    intro:
      "将规则、规范或模板作为独立操作提交。先核对原版本和原文件，再审阅完整请求。",
    prepare: "准备依据",
    review: "审阅原件",
    delivery: "送达与处理",
    project: "当前项目",
    module: "资产模块",
    path: "模块内相对路径（模板须以 templates/ 开头）",
    target: "目标文件：",
    content: "要保存的完整内容（允许空文件）",
    contentLimit:
      "UTF-8 正文最多 60 KiB。包含路径与转义内容的完整事件仍受服务端 64 KiB 限制。",
    basis: "原始依据",
    basisHint:
      "版本请使用 Manager 当前项目交付详情中的 version。SHA-256 必须来自目标原文件的实际字节，包含换行差异；不要填写新内容的指纹。分页拉取中未出现文件，不能证明文件不存在。",
    version: "原 expected_version",
    versionPlaceholder: "输入已核实的非负整数版本",
    fileBasis: "原文件状态",
    existing: "文件存在，填写原 SHA-256",
    absent: "已核实目标文件不存在",
    sha: "原文件 SHA-256（64 位小写）",
    absentHint:
      "仅在已核实目标确实不存在时使用；请求将明确携带 expected_sha256: null。",
    frozenHint:
      "下方固定原件包含模块、路径、完整内容、原版本、原指纹与操作标识。送达结果未知时只能重放此原件。",
    original: "完整固定请求",
    edit: "返回修改",
    confirm: "确认并提交原件",
    sending: "正在送达",
    unknown: "送达结果未知",
    unknownHint:
      "原件已保留且锁定。请重放同一请求获取确认；不可另建操作或修改依据。此状态下会阻止离开。",
    stored: "已存储",
    storedHint:
      "Manager 已接收原件，业务处理尚未确认完成。重新读取原件回执不会创建新操作。",
    processed: "已处理",
    processedHint: "Manager 已确认文件资产处理完成。",
    failed: "处理失败",
    failedHint: "原件已接收，业务处理失败。请查看回执原因。",
    rejected: "请求被明确拒绝",
    rejectedHint:
      "草稿与原件已保留。重新核实版本和原文件后，显式准备新的依据。",
    replay: "重放同一原件",
    refreshOriginal: "重新读取原件回执",
    openReceipt: "查看处理回执",
    newBasis: "准备新的依据",
    receipt: "回执",
    actualTarget: "实际保存目标",
    event: "原事件",
    digest: "事件摘要",
    deliveryState: "送达",
    processingState: "处理",
    processingPending: "待处理",
    unconfigured: "尚未配置处理",
    error: "需要处理",
    identityRequired:
      "请先登录并选择项目；需要当前用户和会话信息以安全保存原件。",
    invalidPath:
      "请填写模块内安全相对路径（md/json/yaml/yml/toml）；模板必须以 templates/ 开头，不使用项目根目录前缀。",
    invalidVersion: "请明确填写已核实的非负整数版本。",
    invalidSha: "请填写原文件的 64 位小写 SHA-256，或明确选择已核实不存在。",
    invalidContent:
      "内容必须是文本，UTF-8 大小不超过 60 KiB；完整事件仍以服务端 64 KiB 限制为准。",
    invalidKey: "操作标识无效，请重新审阅。",
    storageInvalid:
      "保留的原件无法验证，已停止提交。请保留浏览器会话并检查原始会话存储，不要另建操作。",
    storageUnavailable:
      "会话存储无法保存原件，当前页面仍保留草稿。请恢复存储后重试；送达或回执可能尚未持久保存。",
    ackMismatch: "返回内容与原事件不匹配，原件保持锁定，请用原请求重新确认。",
  },
  "en-US": {
    title: "Advanced asset sync",
    intro:
      "Submit a rule, specification or template as a separate operation. Verify the original bases, then review the complete request.",
    prepare: "Prepare bases",
    review: "Review original",
    delivery: "Delivery and processing",
    project: "Current project",
    module: "Asset module",
    path: "Relative module path (templates require templates/)",
    target: "Target file:",
    content: "Complete new content (empty files allowed)",
    contentLimit:
      "UTF-8 content: up to 60 KiB. The full event, including paths and escaped text, is still limited to 64 KiB by the server.",
    basis: "Original bases",
    basisHint:
      "Use version from the current Manager project delivery detail. SHA-256 must describe the original target file bytes, including line endings, rather than the new content. Absence from a partial pull does not prove the file is absent.",
    version: "Original expected_version",
    versionPlaceholder: "Enter a verified nonnegative integer",
    fileBasis: "Original file state",
    existing: "File exists; enter its original SHA-256",
    absent: "Verified that the target file is absent",
    sha: "Original file SHA-256 (64 lowercase characters)",
    absentHint:
      "Use only after verifying absence. The request explicitly includes expected_sha256: null.",
    frozenHint:
      "The fixed original contains the module, path, full content, original version, original hash and operation key. An unknown delivery can only replay this original.",
    original: "Complete fixed request",
    edit: "Back to editing",
    confirm: "Confirm and submit original",
    sending: "Sending",
    unknown: "Delivery outcome unknown",
    unknownHint:
      "The original is retained and locked. Replay it for confirmation. Do not create a replacement or change its bases. Navigation is blocked while unresolved.",
    stored: "Stored",
    storedHint:
      "Manager received the original; business processing has not been confirmed complete. Reading the original receipt again does not create another operation.",
    processed: "Processed",
    processedHint: "Manager confirmed that the file asset was processed.",
    failed: "Processing failed",
    failedHint:
      "The original was received but processing failed. Inspect its receipt for the reason.",
    rejected: "Request explicitly refused",
    rejectedHint:
      "The draft and original are retained. Verify the version and original target file before explicitly preparing new bases.",
    replay: "Replay same original",
    refreshOriginal: "Read original receipt again",
    openReceipt: "View processing receipt",
    newBasis: "Prepare new bases",
    receipt: "Receipt",
    actualTarget: "Saved target",
    event: "Original event",
    digest: "Event digest",
    deliveryState: "Delivery",
    processingState: "Processing",
    processingPending: "Pending",
    unconfigured: "Processing not configured",
    error: "Action needed",
    identityRequired:
      "Sign in and select a project. Current user and session identity are required to retain the original safely.",
    invalidPath:
      "Enter a safe module-relative md/json/yaml/yml/toml path. Templates require templates/; omit project-root prefixes.",
    invalidVersion: "Explicitly enter a verified nonnegative integer version.",
    invalidSha:
      "Enter the original file's 64-character lowercase SHA-256, or explicitly select verified absence.",
    invalidContent:
      "Content must be text, up to 60 KiB of UTF-8. The server's 64 KiB full-event limit still applies.",
    invalidKey: "Invalid operation key. Review the draft again.",
    storageInvalid:
      "The retained original cannot be verified. Submission is blocked. Preserve this browser session and inspect its original session storage before creating another operation.",
    storageUnavailable:
      "Session storage could not retain the original. The draft remains on this page. Restore storage and retry; delivery or receipt state may not yet be saved.",
    ackMismatch:
      "The response does not match the original event. Keep the original locked and confirm using the same request.",
  },
  "ja-JP": {
    title: "高度なアセット同期",
    intro:
      "ルール・仕様・テンプレートを個別の操作として送信します。元の根拠を確認してから、リクエスト全体を確認してください。",
    prepare: "根拠の準備",
    review: "原本を確認",
    delivery: "送達と処理",
    project: "現在のプロジェクト",
    module: "アセットモジュール",
    path: "モジュール内の相対パス（テンプレートは templates/ で開始）",
    target: "対象ファイル：",
    content: "保存する全文（空ファイル可）",
    contentLimit:
      "UTF-8 本文は最大 60 KiB です。パスやエスケープを含むイベント全体にはサーバーの 64 KiB 制限が適用されます。",
    basis: "元の根拠",
    basisHint:
      "version は Manager の現在のプロジェクト配信詳細で確認してください。SHA-256 は改行を含む元ファイルの実際のバイト列から取得します。新しい内容の値ではありません。部分取得に含まれないだけでは、不存在を証明できません。",
    version: "元の expected_version",
    versionPlaceholder: "確認済みの非負整数を入力",
    fileBasis: "元ファイルの状態",
    existing: "存在する：元の SHA-256 を入力",
    absent: "対象ファイルの不存在を確認済み",
    sha: "元ファイルの SHA-256（小文字64桁）",
    absentHint:
      "不存在を確認した場合に限り選択してください。expected_sha256: null を明示します。",
    frozenHint:
      "モジュール・パス・全文・元のバージョン・元のハッシュ・操作キーを固定した原本です。送達結果が不明な場合は、この原本だけを再送します。",
    original: "固定された完全なリクエスト",
    edit: "編集に戻る",
    confirm: "確認して原本を送信",
    sending: "送信中",
    unknown: "送達結果が不明",
    unknownHint:
      "原本を保持してロックしています。同じ原本を再送して確認してください。別の操作や根拠の変更はできません。未解決の間は画面移動を防止します。",
    stored: "保存済み",
    storedHint:
      "Manager が原本を受信しました。業務処理の完了は未確認です。原本の受付結果を再取得しても別の操作は作成されません。",
    processed: "処理済み",
    processedHint: "Manager がファイルアセットの処理完了を確認しました。",
    failed: "処理失敗",
    failedHint:
      "原本は受信済みですが、処理に失敗しました。受付結果で理由を確認してください。",
    rejected: "リクエストを明確に拒否",
    rejectedHint:
      "下書きと原本を保持しています。バージョンと元ファイルを確認し、新しい根拠を明示的に準備してください。",
    replay: "同じ原本を再送",
    refreshOriginal: "原本の受付結果を再取得",
    openReceipt: "処理の受付結果を表示",
    newBasis: "新しい根拠を準備",
    receipt: "受付結果",
    actualTarget: "実際の保存先",
    event: "元イベント",
    digest: "イベントダイジェスト",
    deliveryState: "送達",
    processingState: "処理",
    processingPending: "処理待ち",
    unconfigured: "処理が未設定",
    error: "対応が必要",
    identityRequired:
      "ログインしてプロジェクトを選択してください。原本の安全な保持には現在のユーザーとセッション情報が必要です。",
    invalidPath:
      "md/json/yaml/yml/toml のモジュール内相対パスを入力してください。テンプレートは templates/ で開始し、プロジェクトルートの接頭辞は省略してください。",
    invalidVersion: "確認済みの非負整数バージョンを明示的に入力してください。",
    invalidSha:
      "元ファイルの小文字64桁 SHA-256 を入力するか、確認済みの不存在を選択してください。",
    invalidContent:
      "UTF-8 で 60 KiB 以下のテキストにしてください。イベント全体にはサーバーの 64 KiB 制限が適用されます。",
    invalidKey: "操作キーが無効です。再度確認してください。",
    storageInvalid:
      "原本を検証できないため送信を停止しました。ブラウザーセッションを保持し、新規操作を作成する前に元のセッションストレージを確認してください。",
    storageUnavailable:
      "原本をセッションに保存できません。下書きは画面に保持しています。保存領域を復旧して再試行してください。送達や受付結果が未保存の場合があります。",
    ackMismatch:
      "応答が元イベントと一致しません。原本をロックしたまま、同じリクエストで確認してください。",
  },
} as const;
