// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
// Log time zones: a log written in another zone (a server in UTC, say) is converted to this
// computer's time when logs are combined, so their lines interleave correctly.
// Lines with an explicit offset (Z, +02:00) always use it once a zone is configured.
import { parseTimestampFromText } from "./logProcessing.mjs";

const OFFSET_RE = /\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(Z|[+-]\d{2}:?\d{2})\b/;
const formatters = new Map();

export function isValidTimeZone(zone) {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone:zone }); return true; } catch { return false; }
}

function formatter(zone) {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat("en-US", { timeZone:zone, hourCycle:"h23",
      year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit" }));
  }
  return formatters.get(zone);
}

/** Offset of `zone` from UTC at `instant`, in ms (UTC+2 → 7 200 000). */
export function zoneOffsetMs(zone, instant) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** A wall-clock time read as local (what parseTimestampFromText returns) → the real instant in `zone`. */
export function wallClockInZone(localMs, zone) {
  if (localMs == null || !isValidTimeZone(zone)) return localMs;
  const d = new Date(localMs);
  const wallUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  let instant = wallUtc - zoneOffsetMs(zone, wallUtc);
  instant = wallUtc - zoneOffsetMs(zone, instant); // second pass: DST edges
  return instant;
}

function explicitOffsetMs(raw) {
  const match = String(raw || "").match(OFFSET_RE);
  if (!match) return null;
  if (match[1] === "Z") return 0;
  const sign = match[1][0] === "-" ? -1 : 1;
  const digits = match[1].slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
}

/**
 * Instant of a log line. Without a zone: the historic behaviour (wall clock as local time).
 * With a zone: an explicit offset in the line wins, otherwise the wall clock is read in that zone.
 */
export function lineInstant(raw, zone = "") {
  const local = parseTimestampFromText(raw);
  if (local == null || !zone) return local;
  const offset = explicitOffsetMs(raw);
  if (offset != null) {
    const d = new Date(local);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) - offset;
  }
  return wallClockInZone(local, zone);
}

/** Zones to suggest in the picker (UTC first, then this computer's list). */
export function timeZoneList() {
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = []; }
  return ["UTC", ...zones.filter(zone => zone !== "UTC")];
}
