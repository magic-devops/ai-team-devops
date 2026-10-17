import { describe, expect, it } from "vitest";
import {
  installExecutionExitGuard,
  sameExecutionLocation,
} from "./executionExitGuard";
describe("execution exit protection", () => {
  it("allows exact log selection while refusing another execution or page", () => {
    expect(
      sameExecutionLocation(
        "http://local/#/dev-flow?execution_id=E&execution_node=n&execution_attempt=1",
        "http://local/#/dev-flow?execution_id=E&execution_node=other&execution_attempt=2&execution_stream=stderr",
      ),
    ).toBe(true);
    expect(
      sameExecutionLocation(
        "http://local/#/dev-flow?execution_id=E",
        "http://local/#/dev-flow?execution_id=other",
      ),
    ).toBe(false);
    expect(
      sameExecutionLocation(
        "http://local/#/dev-flow?execution_id=E",
        "http://local/#/projects",
      ),
    ).toBe(false);
  });
  it("blocks late route events while unresolved, then releases them when the session changes", () => {
    const target = new EventTarget();
    const location = { href: "http://local/#/dev-flow?execution_id=E" };
    const document = new EventTarget();
    const window = Object.assign(target, {
      location,
      document,
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, href: string) => {
          location.href = href;
        },
      },
    }) as unknown as Window;
    let pending = true,
      notices = 0;
    const dispose = installExecutionExitGuard(
      window,
      () => pending,
      () => {
        notices++;
      },
    );
    location.href = "http://local/#/other";
    target.dispatchEvent(new Event("hashchange"));
    expect(location.href).toBe("http://local/#/dev-flow?execution_id=E");
    expect(notices).toBe(1);
    const unload = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(unload, "returnValue", { writable: true, value: "" });
    target.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    pending = false;
    location.href = "http://local/#/projects";
    target.dispatchEvent(new Event("hashchange"));
    expect(location.href).toBe("http://local/#/projects");
    dispose();
  });
});
