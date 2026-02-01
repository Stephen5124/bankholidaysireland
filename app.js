async function loadHolidays() {
  const res = await fetch("./holidays-ie.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load holidays-ie.json");
  return res.json();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getTodayIsoInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

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
  // Create a UTC date at midnight, then format it in Europe/Dublin
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-IE", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(dt);
}

function findNextHoliday(holidays, fromIsoExclusive) {
  return holidays.find(h => h.date > fromIsoExclusive) || null;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setBadge(targetId, isHoliday) {
  const badge = document.getElementById(targetId);
  if (!badge) return;

  badge.className = "badge " + (isHoliday ? "yes" : "no");
  badge.textContent = isHoliday ? "YES" : "NO";
}

function renderUpcoming(holidays, fromIsoExclusive, timeZone) {
  const upcoming = holidays.filter(h => h.date > fromIsoExclusive).slice(0, 6);

  if (!upcoming.length) {
    setHtml("upcoming", "<li>No upcoming holidays found.</li>");
    return;
  }

  const items = upcoming
    .map(h => {
      const when = formatFriendly(h.date, timeZone);
      return `<li><span class="date">${when}</span><span class="name">${h.name}</span></li>`;
    })
    .join("");

  setHtml("upcoming", items);
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

    setText(
      "todayLine",
      isTodayHoliday
        ? "Today is a public holiday in Ireland."
        : "Today is not a public holiday in Ireland."
    );

    setText(
      "tomorrowLine",
      isTomorrowHoliday
        ? "Tomorrow is a public holiday in Ireland."
        : "Tomorrow is not a public holiday in Ireland."
    );

    const nameToShow = todayHoliday
      ? todayHoliday.name
      : (tomorrowHoliday ? tomorrowHoliday.name : "—");
    setText("holidayName", nameToShow);

    // Next bank holiday: show only if it isn't duplicating the Holiday above
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
