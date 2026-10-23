import { describe, expect, it } from "vitest";
import { fetchPage, isPublicAddress, previewImage } from "./store-image.js";

const PAGE = "https://shop.example/stores/gent";

describe("previewImage", () => {
  it("reads an absolute og:image, entities decoded", () => {
    const html = `<head><meta property="og:image" content="https://cdn.example/a.png?w=1&amp;h=2"></head>`;
    expect(previewImage(html, PAGE)).toBe("https://cdn.example/a.png?w=1&h=2");
  });

  it("resolves a relative og:image against the page URL, attributes in any order", () => {
    expect(previewImage(`<META content='/img/og.jpg' property='OG:IMAGE' />`, PAGE)).toBe("https://shop.example/img/og.jpg");
    expect(previewImage(`<meta property="og:image" content="og.jpg">`, PAGE)).toBe("https://shop.example/stores/og.jpg");
  });

  it("prefers og:image and falls back to twitter:image", () => {
    const both = `<meta name="twitter:image" content="https://t.example/t.png"><meta property="og:image" content="https://o.example/o.png">`;
    expect(previewImage(both, PAGE)).toBe("https://o.example/o.png");
    expect(previewImage(`<meta name="twitter:image" content="https://t.example/t.png">`, PAGE)).toBe("https://t.example/t.png");
  });

  it("is null without a tag, or with an empty one", () => {
    expect(previewImage(`<html><head><title>Shop</title><meta name="description" content="x"></head></html>`, PAGE)).toBeNull();
    expect(previewImage(`<meta property="og:image" content="  ">`, PAGE)).toBeNull();
  });

  it.each(["http://cdn.example/a.png", "data:image/png;base64,AAAA", "javascript:alert(1)"])("rejects the image %s", (src) => {
    expect(previewImage(`<meta property="og:image" content="${src}">`, PAGE)).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "not an ip"])(
    "refuses %s",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );

  it.each(["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:1.1.1.1"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("fetchPage", () => {
  // Each is refused before any connection: no server listens, so a connection would fail differently.
  it.each(["https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data/", "https://localhost/"])(
    "never fetches %s",
    async (url) => {
      await expect(fetchPage(url)).rejects.toThrow(/non-public|not a public/);
    },
  );

  it("refuses http", async () => {
    await expect(fetchPage("http://shop.example/")).rejects.toThrow(/not https/);
  });
});
