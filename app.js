async function loadHolidays() {
  const res = await fetch("./holidays-ie.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load holidays-ie.json");
  return res.json();
}

function pad2(n) { return String(n).padStart(2, "0"); }

function getTodayIsoInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-IE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const nextUtc = utc + days * 24 * 60 * 60 * 1000;
  const dt = new Date(nextUtc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function formatFriendly(isoDate, timeZone) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-IE", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(dt);
}

function findNextHoliday(holidays, fromIsoExclusive) {
  return holidays.find(h => h.date > fromIsoExclusive) || null;
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function setBadge(targetId, isHoliday) {
  const badge = document.getElementById(targetId);
  if (!badge) return;
  badge.className = "badge " + (isHoliday ? "yes" : "no");
  badge.textContent = isHoliday ? "YES" : "NO";
}

function renderUpcoming(holidays, fromIsoExclusive, timeZone) {
  const upcoming = holidays.filter(h => h.date > fromIsoExclusive).slice(0, 6);
  if (!upcoming.length) { setHtml("upcoming", "<li>No upcoming holidays found.</li>"); return; }
  const items = upcoming.map(h => {
    const when = formatFriendly(h.date, timeZone);
    return `<li><span class="date">${when}</span><span class="name">${h.name}</span></li>`;
  }).join("");
  setHtml("upcoming", items);
}

// ---- ICS helpers ----
function ymd(iso) { return iso.replaceAll("-", ""); }
function escapeIcsText(s) { return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => `\\${m}`); }
function utcStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildIcsForEvents(events, timeZone) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bank Holidays Ireland//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  for (const h of events) {
    const startIso = h.date;
    const endIso = addDaysIso(startIso, 1); // exclusive end for all-day
    const summary = escapeIcsText(h.name);
    const uid = `holiday-${ymd(startIso)}@bankholidaysireland`;
    const url = escapeIcsText(location.href);
    const desc = escapeIcsText(`Irish public holiday. Timezone: ${timeZone}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${utcStamp()}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      `DTSTART;VALUE=DATE:${ymd(startIso)}`,
      `DTEND;VALUE=DATE:${ymd(endIso)}`,
      `URL:${url}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadIcs(filename, icsText) {
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

async function main() {
  try {
    const data = await loadHolidays();
    const timeZone = data.timezone || "Europe/Dublin";
    const holidays = (data.holidays || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    const todayIso = getTodayIsoInTimeZone(timeZone);
    const tomorrowIso = addDaysIso(todayIso, 1);

    const todayHoliday = holidays.find(h => h.date === todayIso) || null;
    const tomorrowHoliday = holidays.find(h => h.date === tomorrowIso) || null;

    const isTodayHoliday = Boolean(todayHoliday);
    const isTomorrowHoliday = Boolean(tomorrowHoliday);

    setText("today", formatFriendly(todayIso, timeZone));
    setText("tomorrow", formatFriendly(tomorrowIso, timeZone));

    setBadge("badgeToday", isTodayHoliday);
    setBadge("badgeTomorrow", isTomorrowHoliday);

    setText("todayLine", isTodayHoliday ? "Today is a public holiday in Ireland." : "Today is not a public holiday in Ireland.");
    setText("tomorrowLine", isTomorrowHoliday ? "Tomorrow is a public holiday in Ireland." : "Tomorrow is not a public holiday in Ireland.");

    const nameToShow = todayHoliday ? todayHoliday.name : (tomorrowHoliday ? tomorrowHoliday.name : "—");
    setText("holidayName", nameToShow);

    // Keep next-row duplication handling
    const next = findNextHoliday(holidays, todayIso);
    const nextRow = document.getElementById('nextRow');
    if (tomorrowHoliday && next && next.date === tomorrowIso) {
      if (nextRow) nextRow.style.display = 'none';
    } else if (next) {
      if (nextRow) nextRow.style.display = '';
      setText("nextHoliday", `${next.name} — ${formatFriendly(next.date, timeZone)}`);
    } else {
      if (nextRow) nextRow.style.display = '';
      setText("nextHoliday", "No upcoming holidays found in the dataset.");
    }

    // All-at-once ICS link
    const linkAll = document.getElementById('addAllCal');
    const currentYear = todayIso.slice(0,4);
    const yearEvents = holidays.filter(h => h.date.slice(0,4) === currentYear);
    if (linkAll) {
      if (yearEvents.length) {
        linkAll.style.display = '';
        // show the target year in the link text
        try { linkAll.textContent = `Add all ${currentYear} bank holidays (.ics)`; } catch {}
        linkAll.onclick = (e) => {
          e.preventDefault();
          const ics = buildIcsForEvents(yearEvents, timeZone);
          const filename = `irish-bank-holidays-${currentYear}.ics`;
          downloadIcs(filename, ics);
        };
      } else {
        linkAll.style.display = 'none';
      }
    }

    renderUpcoming(holidays, todayIso, timeZone);
  } catch (err) {
    console.error(err);
    setText("todayLine", "Something went wrong loading the holiday list.");
    setText("tomorrowLine", "");
    setText("nextHoliday", "—");
    setText("holidayName", "—");
  }
}

document.addEventListener("DOMContentLoaded", main);


