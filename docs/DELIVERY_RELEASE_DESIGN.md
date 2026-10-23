# 质量证据与固定发布候选

2026-10-23 源码补充：当前新增逐任务源码核对包、CI 精确树项核对和候选批准中的固定源码关联。最新合同和操作见 `DELIVERY_RELEASE_SOURCE_TRACE_DESIGN.md`、`DELIVERY_RELEASE_SOURCE_TRACE_GUIDE.md`。当前用户要求延后运行，新增能力尚未通过实际测试/类型/构建/浏览器验证。

## 目的与范围

继续用户已确认的全链路研发协作目标和紧凑协作工作台。当前阶段把真实任务/需求验收、CI 签名证明、代码提交、制品与发布评审连为一条可操作链路。项目、Requirement、Task 继续是既有实体，发布候选是跨需求的项目级不可变交付包。真实部署/灰度/回滚仍是下一独立执行边界；审批完成称“候选已批准”，不称“已部署”。

改造前源码证据：release.save 只收手工 URL/文字，stage_gates 只判断同修订存在记录，operations 被直接计 released。OpsCenter 手工 success 和 Settings 外部 queued 请求也不能证明部署。Multica 的 CI 完整快照、固定 SHA、空检查不通过值得复用；本阶段实现供应商无关的标准签名证据入口，可被 GitHub、自建 CI 等生产者使用。

## 架构选择

采用 DSSE + in-toto Statement v1 + Ed25519，项目配置明确可信公钥、唯一仓库和工作流身份。CI 保管私钥；Manager 仅接收签名信封并验证，不接受私钥、任意 URL 抓取或请求指定本地路径。此格式使用自定义 predicate `urn:sop:delivery:ci-evidence:v1`，不是 GitHub Sigstore 证书链；后续 GitHub 原生适配应独立验签后映射，不能把 GitHub bundle 当此信封直接接受。

备选：继续手工发布文字无法证明构建和提交；仅接 GitHub 检查 API 可形成权威状态快照但不足以跨 CI 固定制品签名。现有 Hermes 分发脚本已使用 Ed25519，Manager 使用同一成熟密码库，不手写密码算法。cryptography 明确列入 Manager 运行依赖并更新锁文件。

所有状态保存在现有 DeliveryWorkspace.data：release_policy、ci_evidence、release_candidates；Receipt/Event、项目锁、Workspace CAS、现有权限及归档规则不变，无新 schema。有效性读取是纯投影，永久失效在已有变更捕获事务中落盘。

## 领域与信任

1. release_policy：generation 从 1 单调递增；repository 是不含凭据/查询/片段的 HTTPS 仓库 URI，workflow 是明确身份字符串（1..200），keys 是 1..8 个不同的 Ed25519 raw public key Base64（每个 32 字节）。key_id 为公钥原始字节 SHA256。完全相同配置拒绝无意义保存；A→B→A 仍有不同 generation。不存在默认可信 key。
2. CI envelope：payloadType=`application/vnd.in-toto+json`；payload Base64 解码最多 65536 字节；signatures 1..8，每项 keyid/sig；标准与 URL-safe Base64 都接受。严格拒绝重复 JSON key、非有限数、未知协议字段、无效签名及不受信 key。用同一份已验签 payload 字节解析业务，DSSE PAE 按字节长度。
3. statement：_type=`https://in-toto.io/Statement/v1`，subject 恰一项 name（1..200）和 digest.sha256（小写64hex）；predicateType 固定。predicate：tenant_id、project_id、policy_generation、repository、workflow、commit_sha（小写40或64hex）、run_uri（安全 HTTPS）、run_number（正整数）、run_attempt（正整数）、scope_basis（64hex）、build_result=passed|failed、tests={total,failed,errors,skipped}（整数0..10000000，统计相容）、finished_at（有时区时间、不超过当前时间5分钟）。成功须构建 passed、tests.total>0、failed=errors=0、skipped<total。零测试、失败构建、缺项均不能通过。
4. 同一 generation/repository/workflow/commit 的 (run_number,run_attempt) 单调；相同信封重放返回原证据，不插入；同序不同内容拒绝，较旧输入拒绝。失败证明也保存供审计。新序号使引用旧证明的候选永久失效，包括随后再导入通过证明；重新准备新候选。
5. 已验证签名说明由配置的 CI key 声明这些事实，不等于外部厂商生产认证或证明测试覆盖充分。制品摘要固定 CI 实际文件内容，部署执行器后续必须对实际下载字节再次核对。artifact_url 是定位链接，不能替代摘要。

## 当前质量与范围

GET quality 只检查明确范围的完整证明及 scope_basis；目录使用独立的 quality/catalogue SQL 分页。requirement_ids/task_ids 各至多200、非空、无重复；task_ids 只接受独立任务，需求范围自然包含全部关联任务，不能遗漏失败任务。非法/跨项目/缺失 ID 明确拒绝。空范围422；必要证明闭包最多500个任务和64层依赖，超额413，不截断验收。详见 `DELIVERY_BOUNDED_READS_DESIGN.md`。

需求质量复用 VerificationContext.requirement_accepted；独立任务复用 verified。展示登记状态、有效状态、任务自身条件、真实验收来源、有效/失效原因及未解决 P0/P1 问题，不从 raw completed 推算通过。范围 basis 固定需求修订/定义、完整任务身份/定义/验收依据/状态/负责人语义以及高优问题。姓名改动不失效，范围、任务定义、身份可用性、验收及问题变化需要重新核对；已有永久作废机制继续防止 A→B→A 复活。

CI 的 scope_basis 必须与明确范围当前质量一致；质量快照本身不能代替 CI。CI import 可以保存失败结果，但不能保存其他项目/旧 policy/scope 的证明为当前有效。CI Producer 从本 GET 获取 basis，固定 checkout 的真实完整 commit 后执行构建/测试并计算制品文件 sha256，再签名。

## 命令与读取

沿用通用 DeliveryCommand、expected_version、idempotency_key：

- release.policy.save（configure）：repository/workflow/public_keys；保存新 generation，旧候选永久失效。
- release.ci.import（write）：envelope 原始 JSON 字符串（最多 131072 字符）+ source_packet + requirement_ids/task_ids；保留信封原文后严格解析，拒绝对象双形态和重复 JSON key；重建并核对当前验收包与签名 source_trace，保存不可变原始信封、源码包、声明、验签身份、输入散列及当前质量快照。
- release.candidate.create（write）：version（1..80）、environment（1..80）、requirement_ids/task_ids、ci_evidence_id、artifact_url、release_notes（1..10000）、rollback_plan（1..10000）、preview_basis。所有字段与服务端预览完全一致；同项目 version+environment 不复用，失效/拒绝版本仍保留，需新版本。
- release.candidate.review（approve）：id、decision=approve|reject、comment（1..4000）、review_basis（64hex）。只评审 pending、当前有效且完整候选；拒绝允许说明。记录真实 User/时间/固定 basis，审批不执行部署。
- release.candidate.revoke（approve）：id、comment、review_basis；pending/approved 可撤回，终态不再改写。

GET `/delivery/quality/catalogue`（轻量目录）、GET `/delivery/quality`（完整明确范围）、GET `/delivery/releases`（policy/权限/总数小上下文）、GET `/delivery/release-pages?kind=candidate|evidence|legacy`（三类独立分页）、GET `/delivery/releases/{id}` 与 `/delivery/release-evidence/{id}`（稳定ID原件及当前证明）；POST `/delivery/release-preview`（纯预览）。检查权限后才预览，无业务写入/目录创建/计费；正常请求审计仍记录POST预览。读取保留 archived 历史；所有新写入继承 archived409，planning/paused 可编制和评审、不能因此派发。普通GET不修查询索引，代次变化要求重新读取首页。

预览固定 scope、完整语义输入、所选 CI、policy generation、当前质量、权限；basis 不含 as_of 或外层 workspace version。提交同时校验预览 basis 和 CAS。评审 basis 包括当前候选完整内容、有效性及审查历史，避免两人覆盖。保存失败保留草稿；409 显式读取、核对后重预览；未知结果重试原 key。

## 有效性与既有阶段

候选不可修改，只能评审/撤回；派生状态 pending/approved/rejected/revoked/stale。失效原因单独保留，immutable snapshot 和审批历史不覆盖。候选当前有效须 scope_basis、policy generation、所选最新 CI、真实审批身份的资格等仍有效；任何捕获到的失效落盘后永久保持。

旧 release.save 命令、DTO 和 UI 入口移除。flow.releases 既有内容只作为“历史人工登记”，无自动迁移、默认摘要、补造签名或兼容写别名。stage.advance 的 release 阶段不能仅靠人工记录进入 operations；返回明确的真实部署验证缺失门禁。新候选批准仍在 release 等待部署。summary/progress 的 released 只统计真实部署验证；本阶段没有已接入部署回执，因此不能制造已验证发布数。原 operations 记录可读，标明登记状态，不作新成功证明。

全局身份撤销/成员变更捕获须将候选审批永久失效；恢复身份不能恢复旧批准。复用现有 identity capture 的受限写入路径，扩展只允许候选失效字段，不能借它更改候选正文、签名或批准。普通作用域、SQL、归档保护不得放宽。

## 四个界面

1. 质量清单：现有交付工作台增加质量视图；紧凑行/窄屏卡片，筛选需求/独立任务及有效/未验证/阻塞；指标点击过滤，精确进入任务/问题，查看不切项目。范围选择显式，零范围不自动首选。
2. 证据检查：同一质量/发布面板的抽屉或区块，展示可信 CI、原生执行、人审、手工登记来源；长摘要折行/复制；签名未配、解析失败、失败检查、旧范围与历史记录分别表达。信任配置仅 configure 可编辑，输入公钥而非私钥。
3. 发布编制与预览：选择明确范围与证据、填写版本/环境/链接/说明/回退；服务端预览显示固定 commit/制品摘要/质量快照/阻塞项。改输入即清除确认；固定版本，冲突明确重读；成功才关闭，网络未知复用 key。
4. 发布详情与交接：固定版本、目标环境、状态、范围、CI、评审历史；可批准/拒绝/撤回，部署区明确“尚未交接实际部署”。URL保存 view=quality|releases、release_id 与必要筛选；未知非空 ID 不回退首项，退场保留原身份，项目切换隔离数据。中文/英文/日文、390px、键盘及明暗主题沿用现有组件。

## CI Producer 与验证

提供本地/CI 用的签名发布脚本：私钥只由本地文件读取，不打印/上传；固定实际 Git HEAD、要求干净受控源码；在仓库内明确工作目录执行 JSON argv 格式的构建/测试命令，无 shell；在开始时要求产物路径不存在防止签旧文件；构建后核验真实产物，测试解析实际 JUnit XML，零用例/失败不签为通过；结束再次核验 HEAD 和受控源码未变化。失败可输出失败证明（有实际制品时）；工具返回非零。CLI/SDK可读取质量/发布、提交通用导入文件，供 CI 自动化接入。

定向测试先RED后GREEN：实际Ed25519签名/篡改/错误key/重复JSON/UTF8 PAE/过期policy/跨租户/序号重放/失败覆盖；完整scope/CAS/并发/权限/归档/读纯净；scope与身份A→B→A；旧手工记录拒绝放行且历史可读；实际子进程build/test/artifact签名闭环；UI真实控件固定预览、未知ID、三语窄屏。root统一实际服务/浏览器、完整Manager/Web、客户端、类型构建、一次独立增量审查与阶段全部commit。

临时目录 `.cache/delivery-release/`；交付证据 `.sop-runtime/delivery-evidence/delivery-release/`。清理前库存/散列保留重要源码与证据，不能遍历链接目标；不push。本阶段不宣称厂商账户、Sigstore、生产CI或部署完成。

标准依据：[DSSE协议](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md)、[in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)、[GitHub原生证明的离线信任边界](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)。
