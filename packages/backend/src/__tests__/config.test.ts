import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// isPrivateAddress is exported (persona-login task 1.1) so it can be tested
// directly. loadConfig(env) is exported (configurable-oidc-role-map, D1a/R6)
// so the role-map wiring can be tested by calling it with an explicit env
// instead of re-importing the module.
process.env["DATABASE_URL"] ??= "postgres://test";
process.env["REDIS_URL"] ??= "redis://test";
process.env["SESSION_SECRET"] ??= "test-secret";
process.env["OIDC_ISSUER"] ??= "https://idp.example.com";
process.env["OIDC_CLIENT_ID"] ??= "client-id";
process.env["OIDC_CLIENT_SECRET"] ??= "client-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";
// The module-level real import below uses a public issuer, so it needs a
// role map to boot (configurable-oidc-role-map, S2).
process.env["OIDC_ROLE_MAP"] ??= '{"Eng-Managers":"engineering_manager"}';

const { isPrivateAddress, loadConfig, config } = await import("../config.js");

describe("isPrivateAddress", () => {
  it.each([
    ["http://localhost:8080", true],
    ["http://127.0.0.1:3000", true],
    ["http://0.0.0.0:443", true],
    ["http://10.0.0.1/path", true],
    ["http://10.255.255.255", true],
    ["http://172.16.0.1", true],
    ["http://172.31.255.255", true],
    ["http://192.168.1.1", true],
    ["http://192.168.0.100", true],
    ["http://8.8.8.8", false],
    ["http://172.15.0.1", false],
    ["http://172.32.0.1", false],
    ["http://192.167.1.1", false],
    ["https://accounts.google.com", false],
    ["https://login.microsoftonline.com", false],
    ["not-a-url", false],
  ])("isPrivateAddress(%s) should be %s", (input, expected) => {
    expect(isPrivateAddress(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// configurable-oidc-role-map task 1.6: OIDC_ROLE_MAP wiring in loadConfig.
// ---------------------------------------------------------------------------
describe("loadConfig: OIDC_ROLE_MAP", () => {
  const BASE = {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "x".repeat(40),
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
  };
  const PROD_ENV = {
    ...BASE,
    NODE_ENV: "production",
    APP_ORIGIN: "https://dipstick.example.com",
    OIDC_ISSUER: "https://idp.example.com",
  };

  let exitSpy: MockInstance<typeof process.exit>;
  let errorSpy: MockInstance<typeof console.error>;
  let infoSpy: MockInstance<typeof console.info>;
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectFatal(env: NodeJS.ProcessEnv, text: string): void {
    expect(() => loadConfig(env)).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("FATAL: OIDC_ROLE_MAP");
    expect(printed).toContain(text);
  }

  it("production without OIDC_ROLE_MAP exits with the role-map error and prints no summary", () => {
    expectFatal(PROD_ENV, "required in production");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("non-production with a public issuer and no map exits with the issuer error", () => {
    expectFatal({ ...BASE, NODE_ENV: "staging", OIDC_ISSUER: "https://idp.example.com" }, "OIDC_ISSUER is not a local address");
  });

  it("non-production with an unclassifiable issuer and no map exits with the issuer error", () => {
    expectFatal({ ...BASE, NODE_ENV: "development", OIDC_ISSUER: "not a url" }, "OIDC_ISSUER is not a local address");
  });

  it("non-production with the local stub issuer and no map uses the default map", () => {
    const cfg = loadConfig({ ...BASE, NODE_ENV: "development", OIDC_ISSUER: "http://localhost:4011" });
    expect(cfg.roleMapSource).toBe("default");
    expect(cfg.roleMap.get("facilitator")).toBe("facilitator");
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]![0])).toMatch(/^OIDC_ROLE_MAP: source=default /);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("production with a valid map boots, warns for missing targets and prints the summary", () => {
    const cfg = loadConfig({ ...PROD_ENV, OIDC_ROLE_MAP: '{"Eng-Managers":"engineering_manager"}' });
    expect(cfg.roleMapSource).toBe("configured");
    expect(cfg.roleMap.get("Eng-Managers")).toBe("engineering_manager");
    expect(warnSpy).toHaveBeenCalledTimes(2);
    for (const call of warnSpy.mock.calls) expect(String(call[0])).toMatch(/^OIDC_ROLE_MAP: /);
    expect(String(infoSpy.mock.calls[0]![0])).toBe(
      "OIDC_ROLE_MAP: source=configured engineering_manager=1 facilitator=0 application_admin=0 senior_engineer=0",
    );
  });

  it("the returned config carries no raw OIDC_ROLE_MAP string", () => {
    const raw = '{"Eng-Managers":"engineering_manager","Retro-Facilitators":"facilitator"}';
    const cfg = loadConfig({ ...PROD_ENV, OIDC_ROLE_MAP: raw });
    expect(Object.prototype.hasOwnProperty.call(cfg, "OIDC_ROLE_MAP")).toBe(false);
    for (const value of Object.values(cfg)) expect(value).not.toBe(raw);
  });

  it("the exported config is computed once at module load (map changes need a restart)", async () => {
    const again = await import("../config.js");
    expect(again.config).toBe(config);
    expect(config.roleMapSource).toBe("configured");
  });
});
