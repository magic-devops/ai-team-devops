import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import {
  fetchDeliveryDeployments,
  fetchDeliveryDeployment,
  previewDeliveryDeployment,
  submitDeploymentCommand,
  deploymentPreviewInput,
  deploymentProblem,
  deploymentEnvironmentInput,
} from "./deliveryDeployment";
vi.mock("./http", () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());

describe("scoped real deployment API", () => {
  it("pins project headers, exact resource IDs and original CAS identity", async () => {
    await fetchDeliveryDeployments("P");
    await fetchDeliveryDeployment("P", "DEP &1");
    expect(vi.mocked(request).mock.calls[1]).toEqual([
      "/api/v1/delivery/deployments/DEP%20%261",
      {
        signal: undefined,
        headers: {
          "X-Project-Id": "P",
          "X-Project-Code": "P",
          "X-Business-Code": "",
        },
      },
    ]);
    await submitDeploymentCommand(
      "P",
      "deployment.observe",
      { id: "DEP-one", basis: "fixed", comment: "Read journal only" },
      { version: 7, key: "original-request" },
    );
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[2][1]?.body)),
    ).toEqual({
      action: "deployment.observe",
      payload: { id: "DEP-one", basis: "fixed", comment: "Read journal only" },
      expected_version: 7,
      idempotency_key: "original-request",
    });
    expect(() => fetchDeliveryDeployment("P", "")).toThrow();
    expect(() => fetchDeliveryDeployments(" ")).toThrow();
  });
  it("requires explicit candidate/environment or a single explicit rollback source", async () => {
    expect(
      deploymentPreviewInput({
        candidate_id: "REL-one",
        environment_id: "ENV-one",
        rollback_of: "",
        reason: " Approved change ",
      }),
    ).toEqual({
      candidate_id: "REL-one",
      environment_id: "ENV-one",
      rollback_of: "",
      reason: "Approved change",
    });
    for (const input of [
      {
        candidate_id: "",
        environment_id: "ENV-one",
        rollback_of: "",
        reason: "change",
      },
      {
        candidate_id: "REL-one",
        environment_id: "ENV-one",
        rollback_of: "DEP-one",
        reason: "change",
      },
      {
        candidate_id: "REL-one",
        environment_id: "ENV-one",
        rollback_of: "",
        reason: " ",
      },
    ])
      expect(() => deploymentPreviewInput(input)).toThrow();
    await previewDeliveryDeployment("P", {
      candidate_id: "",
      environment_id: "",
      rollback_of: "DEP-one",
      reason: "Restore stable baseline",
    });
    expect(
      JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body)),
    ).toEqual({
      candidate_id: "",
      environment_id: "",
      rollback_of: "DEP-one",
      reason: "Restore stable baseline",
    });
  });
  it("distinguishes unknown side effects from confirmed conflicts and input errors", () => {
    expect(deploymentProblem(new Error("network interrupted")).unknown).toBe(
      true,
    );
    expect(
      deploymentProblem(new Error("HTTP 502: upstream timeout")).unknown,
    ).toBe(true);
    expect(deploymentProblem(new Error("HTTP 409: changed")).conflict).toBe(
      true,
    );
    expect(
      deploymentProblem(new Error("HTTP 422: invalid input")).unknown,
    ).toBe(false);
  });
  it("keeps explicit argument boundaries and refuses invalid observation and traffic configuration", () => {
    const form = {
      id: "",
      name: "staging",
      active: true,
      workspace_id: "W",
      target_device_id: "",
      runner_argv:
        '["C:/Python/python.exe","-m","hermes_core.deployment_runner"]',
      apply_argv: '["deploy","a path with spaces","{artifact_path}"]',
      probe_argv: '["probe","{operation_id}"]',
      artifact_origins: '["https://ci.example"]',
      max_artifact_bytes: "1000",
      timeout_seconds: "20",
      observation_seconds: "2",
      min_samples: "2",
      traffic_steps: "[10,100]",
    };
    expect(deploymentEnvironmentInput(form).apply_argv).toEqual([
      "deploy",
      "a path with spaces",
      "{artifact_path}",
    ]);
    for (const patch of [
      { workspace_id: "" },
      { traffic_steps: "[100,10]" },
      { traffic_steps: "[10,50]" },
      { timeout_seconds: "3" },
      { min_samples: "NaN" },
      { apply_argv: '"deploy --all"' },
    ])
      expect(() => deploymentEnvironmentInput({ ...form, ...patch })).toThrow();
  });
});
