import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const copilotSource = readFileSync(resolve(root, "subapps/ai-rd-center/src/pages/Copilot.tsx"), "utf8");
const hubSource = readFileSync(resolve(root, "subapps/ai-rd-center/src/pages/ai/CopilotHub.tsx"), "utf8");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");

describe("Copilot workbench UX contract", () => {
  it("routes AI chat, command center, and tool plan into distinct focused modes", () => {
    expect(navigationSource).toContain('initialMode: "chat"');
    expect(navigationSource).toContain('initialMode: "commands"');
    expect(navigationSource).toContain('initialMode: "tool-plan"');
    expect(copilotSource).toContain('type CopilotMode = "chat" | "commands" | "tool-plan"');
    expect(copilotSource).toContain("MODE_WORKFLOWS");
    expect(copilotSource).toContain("MODE_SURFACE_CLASS");
    expect(copilotSource).toContain("copilotChatSurface");
    expect(copilotSource).toContain("copilotCommandSurface");
    expect(copilotSource).toContain("copilotToolPlanSurface");
    expect(copilotSource).toContain("copilotModeIdentity");
    expect(copilotSource).toContain('mode === "commands"');
    expect(copilotSource).toContain('mode === "tool-plan"');
    expect(copilotSource).toContain('mode === "chat"');
  });

  it("uses mature components for command catalog and tool-plan tasking", () => {
    expect(copilotSource).toContain("Segmented");
    expect(copilotSource).toContain("Input.Search");
    expect(copilotSource).toContain("Input.TextArea");
    expect(copilotSource).toContain("Steps");
    expect(copilotSource).toContain("Switch");
    expect(copilotSource).toContain("Table");
    expect(copilotSource).toContain("copilotPlanTasks");
    expect(copilotSource).toContain("copilotExecuteCommand");
    expect(copilotSource).toContain("commandResult");
    expect(copilotSource).toContain("commandStats");
    expect(copilotSource).toContain("CommandTypeFilter");
    expect(copilotSource).toContain("COMMAND_TYPE_FILTERS");
    expect(copilotSource).toContain("filteredCommandRows");
    expect(copilotSource).toContain("copilotCommandTypeFilter");
    expect(copilotSource).toContain("copilotCommandPlaybook");
    expect(copilotSource).toContain("命令执行路径");
    expect(copilotSource).toContain("PLAN_TEMPLATES");
    expect(copilotSource).toContain("copilotPlanTemplates");
    expect(copilotSource).toContain("SearchCheck");
    expect(copilotSource).toContain("commandCenterIdentity");
    expect(copilotSource).toContain("计划不是聊天记录");
    expect(copilotSource).toContain("会话用于持续思考");
    expect(copilotSource).toContain("MODE_FOCUS");
    expect(copilotSource).toContain("MODE_BOUNDARY");
    expect(copilotSource).toContain("copilotModeBoundary");
    expect(copilotSource).toContain("MODE_SURFACE_TONE");
    expect(copilotSource).toContain("selectedCommandId");
    expect(copilotSource).toContain("selectedCommand");
    expect(copilotSource).toContain("copilotCommandMobileCards");
    expect(copilotSource).toContain("copilotChatEvidence");
    expect(copilotSource).toContain("copilotPlanPipeline");
    expect(copilotSource).toContain("计划产出");
    expect(copilotSource).toContain("命令操作台");
    expect(copilotSource).toContain("FileSearch");
    expect(copilotSource).toContain("ShieldCheck");
    expect(copilotSource).toContain("Workflow");
  });

  it("keeps the AI command hub as a distinct cockpit entry", () => {
    expect(hubSource).toContain("DOMAIN_DESC");
    expect(hubSource).toContain("DOMAIN_USAGE");
    expect(hubSource).toContain("DOMAIN_OUTCOME");
    expect(hubSource).toContain("decisionLanes");
    expect(hubSource).toContain("recommendations");
    expect(hubSource).toContain("copilotHubNextActions");
    expect(hubSource).toContain("推荐下一步");
    expect(hubSource).toContain("copilotHubDecisionLane");
    expect(hubSource).toContain("copilotHubRoleBoard");
    expect(hubSource).toContain("cockpitTiles");
    expect(hubSource).toContain("CONTROL_BOARD_LANES");
    expect(hubSource).toContain("href: \"#/copilot/chat\"");
    expect(hubSource).toContain("指挥台只做态势和分流");
    expect(hubSource).toContain("AI 指挥台");
    expect(hubSource).toContain("AI 会话");
    expect(hubSource).toContain("命令中心");
    expect(hubSource).toContain("工具计划");
    expect(hubSource).toContain("copilotCommands");
    expect(hubSource).toContain("hubCommands");
    expect(hubSource).toContain("AI 指挥台");
  });
});
