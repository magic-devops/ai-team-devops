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
    expect(copilotSource).toContain("copilotModeIdentity");
    expect(copilotSource).toContain('mode === "commands"');
    expect(copilotSource).toContain('mode === "tool-plan"');
    expect(copilotSource).toContain('mode === "chat"');
  });

  it("uses mature components for command catalog and tool-plan tasking", () => {
    expect(copilotSource).toContain("Segmented");
    expect(copilotSource).toContain("Input.Search");
    expect(copilotSource).toContain("Input.TextArea");
    expect(copilotSource).toContain("Table");
    expect(copilotSource).toContain("copilotPlanTasks");
    expect(copilotSource).toContain("copilotExecuteCommand");
    expect(copilotSource).toContain("commandResult");
    expect(copilotSource).toContain("commandStats");
    expect(copilotSource).toContain("SearchCheck");
    expect(copilotSource).toContain("计划不是聊天记录");
    expect(copilotSource).toContain("会话用于持续思考");
  });

  it("keeps the AI command hub as a distinct cockpit entry", () => {
    expect(hubSource).toContain("DOMAIN_DESC");
    expect(hubSource).toContain("DOMAIN_USAGE");
    expect(hubSource).toContain("cockpitTiles");
    expect(hubSource).toContain("copilotCommands");
    expect(hubSource).toContain("hubCommands");
    expect(hubSource).toContain("AI 指挥台");
  });
});
