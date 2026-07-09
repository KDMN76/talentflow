import { describe, it, expect } from "vitest";
import {
  normalizeHost,
  getAppHosts,
  isAppHost,
  buildRewritePath,
} from "@/lib/customDomain";

describe("normalizeHost", () => {
  it("lowercases and strips path, query, fragment, port and trailing dot", () => {
    expect(normalizeHost("WerkenBij.Klant.NL:443/jobs?x=1#a")).toBe(
      "werkenbij.klant.nl"
    );
    expect(normalizeHost("werkenbij.klant.nl.")).toBe("werkenbij.klant.nl");
    expect(normalizeHost("  Talentflow.KDMN.nl  ")).toBe("talentflow.kdmn.nl");
  });

  it("returns empty string for missing input", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost(null)).toBe("");
    expect(normalizeHost(undefined)).toBe("");
  });
});

describe("getAppHosts", () => {
  it("always includes loopback hosts", () => {
    const hosts = getAppHosts({});
    expect(hosts.has("localhost")).toBe(true);
    expect(hosts.has("127.0.0.1")).toBe(true);
  });

  it("derives the app host from NEXT_PUBLIC_API_URL", () => {
    const hosts = getAppHosts({
      NEXT_PUBLIC_API_URL: "https://talentflow.kdmn.nl/api",
    });
    expect(hosts.has("talentflow.kdmn.nl")).toBe(true);
  });

  it("adds explicit NEXT_PUBLIC_APP_HOSTS (comma-separated, normalized)", () => {
    const hosts = getAppHosts({
      NEXT_PUBLIC_APP_HOSTS: "App.Example.com, second.example.com",
    });
    expect(hosts.has("app.example.com")).toBe(true);
    expect(hosts.has("second.example.com")).toBe(true);
  });

  it("tolerates an unparseable API URL without throwing", () => {
    expect(() => getAppHosts({ NEXT_PUBLIC_API_URL: "not a url" })).not.toThrow();
  });
});

describe("isAppHost", () => {
  const appHosts = getAppHosts({
    NEXT_PUBLIC_API_URL: "https://talentflow.kdmn.nl/api",
  });

  it("classifies app hosts as app hosts", () => {
    expect(isAppHost("talentflow.kdmn.nl", appHosts)).toBe(true);
    expect(isAppHost("localhost", appHosts)).toBe(true);
    expect(isAppHost("TALENTFLOW.KDMN.NL:3000", appHosts)).toBe(true);
  });

  it("classifies a tenant custom domain as NOT an app host", () => {
    expect(isAppHost("werkenbij.klant.nl", appHosts)).toBe(false);
  });

  it("treats an empty host as an app host (safe: no rewrite)", () => {
    expect(isAppHost("", appHosts)).toBe(true);
  });
});

describe("buildRewritePath", () => {
  it("maps root to /careers/<slug>", () => {
    expect(buildRewritePath("klant", "/")).toBe("/careers/klant");
    expect(buildRewritePath("klant", "")).toBe("/careers/klant");
  });

  it("prefixes subpaths so /jobs and /privacy keep working", () => {
    expect(buildRewritePath("klant", "/jobs")).toBe("/careers/klant/jobs");
    expect(buildRewritePath("klant", "/privacy")).toBe("/careers/klant/privacy");
  });
});
