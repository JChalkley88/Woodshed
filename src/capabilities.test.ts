import { describe, expect, it } from "vitest";
import { capabilityNotice, type Capabilities } from "./capabilities.ts";

const full: Capabilities = {
  webAudio: true,
  wasm: true,
  webgpu: true,
  threads: true,
};

describe("capabilityNotice", () => {
  it("is silent on the full path", () => {
    expect(capabilityNotice(full)).toBeNull();
  });

  it("blocks without web audio or wasm", () => {
    expect(capabilityNotice({ ...full, webAudio: false })?.level).toBe(
      "blocked",
    );
    expect(capabilityNotice({ ...full, wasm: false })?.level).toBe("blocked");
  });

  it("degrades to the processor message without WebGPU", () => {
    const notice = capabilityNotice({ ...full, webgpu: false });
    expect(notice?.level).toBe("degraded");
    expect(notice?.message).toMatch(/PROCESSOR/);
  });

  it("degrades to the isolation message without threads", () => {
    const notice = capabilityNotice({ ...full, threads: false });
    expect(notice?.level).toBe("degraded");
    expect(notice?.message).toMatch(/SINGLE-THREADED/);
  });

  it("combines the slow message when both acceleration paths are absent", () => {
    const notice = capabilityNotice({
      ...full,
      webgpu: false,
      threads: false,
    });
    expect(notice?.level).toBe("degraded");
    expect(notice?.message).toMatch(/SLOW/);
  });
});
