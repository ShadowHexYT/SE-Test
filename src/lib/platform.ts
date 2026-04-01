import type { Platform, PlatformMeta } from "../types";

export function getPlatformMeta(platform: Platform): PlatformMeta {
  switch (platform) {
    case "windows":
      return {
        id: "windows",
        nativeLabel: "Windows 11 tuned",
        statusLabel: "Acrylic-tuned",
      };
    case "linux":
      return {
        id: "linux",
        nativeLabel: "Desktop tuned",
        statusLabel: "Adaptive shell",
      };
    case "macos":
    default:
      return {
        id: "macos",
        nativeLabel: "macOS tuned",
        statusLabel: "Layered glass",
      };
  }
}
