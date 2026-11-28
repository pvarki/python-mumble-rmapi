export const UNITS = "/Units/";
export const MISSIONS = "/Missions/";

// '/Units/10/101' -> '10 › 101', '/Missions/X' -> 'X', anything else -> its segments joined
export function pathLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1 && (parts[0] === "Units" || parts[0] === "Missions")) {
    parts.shift();
  }
  return parts.join(" › ");
}
