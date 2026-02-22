function useEntireBudgetExtend(breaks, remaining, dayMap, bounds) {
  if (remaining <= 0 || !breaks.length) return { breaks, extraUsed: 0 };
  const map = new Map(dayMap.map(d => [d.iso, d]));
  const isBookable = (iso) => {
    const d = map.get(iso);
    return d && d.leaveCost === 1;
  };
  const cmp = (a, b) => a.startIso.localeCompare(b.startIso);
  breaks.sort(cmp);
  let extraUsed = 0;

  function tryExtendAt(i, dir) {
    const b = breaks[i];
    const nextIso = dir > 0 ? addDaysIso(b.endIso, 1) : addDaysIso(b.startIso, -1);
    if (dir > 0 && i < breaks.length - 1 && nextIso >= breaks[i+1].startIso) return false;
    if (dir < 0 && i > 0 && nextIso <= breaks[i-1].endIso) return false;
    if (bounds) {
      if (nextIso < bounds[0] || nextIso > bounds[1]) return false;
    }
    const d = map.get(nextIso);
    if (!d || d.leaveCost !== 1) return false;
    if (dir > 0) b.endIso = nextIso; else b.startIso = nextIso;
    b.totalDaysOff += 1;
    b.leaveNeeded += 1;
    b.leaveDates.push(nextIso);
    breaks.sort(cmp);
    return true;
  }

  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < breaks.length && remaining > 0; i++) {
      if (tryExtendAt(i, +1)) { remaining--; extraUsed++; progressed = true; continue; }
      if (remaining > 0 && tryExtendAt(i, -1)) { remaining--; extraUsed++; progressed = true; continue; }
    }
    if (!progressed) break;
  }

  for (const b of breaks) {
    b.efficiency = b.totalDaysOff / Math.max(1, b.leaveNeeded);
  }

  return { breaks, extraUsed };
}
/* Time Off Planner JS (v1) */
async function loadHolidays() {
  const res = await fetch('./holidays-ie.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load holidays-ie.json');
  return res.json();
}

function pad2(n){return String(n).padStart(2,'0');}
function getTodayIsoInTimeZone(timeZone){
  const parts = new Intl.DateTimeFormat('en-IE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const y = parts.find(p=>p.type==='year').value;
  const m = parts.find(p=>p.type==='month').value;
  const d = parts.find(p=>p.type==='day').value;
  return `${y}-${m}-${d}`;
}
function addDaysIso(iso, days){
  const [y,m,d] = iso.split('-').map(Number);
  const t = Date.UTC(y,m-1,d) + days*86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}
function formatFriendly(iso, tz){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  return new Intl.DateTimeFormat('en-IE',{timeZone:tz,weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(dt);
}
function weekdayShort(iso, tz){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  return new Intl.DateTimeFormat('en-IE',{timeZone:tz,weekday:'short'}).format(dt);
}
function isWeekend(iso, tz){
  const wd = weekdayShort(iso,tz);
  return wd.startsWith('Sat') || wd.startsWith('Sun');
}

function buildDayMap(startIso, days, tz, holidayMap){
  const out = [];
  for (let i=0;i<days;i++){
    const iso = addDaysIso(startIso,i);
    const weekend = isWeekend(iso,tz);
    const holiday = holidayMap.get(iso) || null;
    const isBH = Boolean(holiday);
    out.push({
      iso,
      isWeekend: weekend,
      isBankHoliday: isBH,
      leaveCost: (weekend||isBH)?0:1,
      label: holiday
    });
  }
  return out;
}

function generateCandidates(dayMap, maxLeave, minLen=3, maxLen=16){
  const cands = [];
  const n = dayMap.length;
  for(let i=0;i<n;i++){
    for(let len=minLen; len<=maxLen && i+len<=n; len++){
      const win = dayMap.slice(i,i+len);
      const leaveNeeded = win.reduce((s,d)=>s + (d.leaveCost),0);
      if (leaveNeeded<1 || leaveNeeded>maxLeave) continue;
      const hasWkndOrHol = win.some(d=>d.isWeekend||d.isBankHoliday);
      if (!hasWkndOrHol) continue;
      const startIso = win[0].iso;
      const endIso = win[win.length-1].iso;
      const totalDaysOff = len;
      const includedHolidays = [...new Set(win.filter(d=>d.isBankHoliday && d.label).map(d=>d.label))];
      const leaveDates = win.filter(d=>d.leaveCost===1).map(d=>d.iso);
      const efficiency = totalDaysOff / leaveNeeded;
      cands.push({startIso,endIso,leaveNeeded,totalDaysOff,efficiency,includedHolidays,leaveDates});
    }
  }
  return cands;
}

function overlaps(a,b){ return !(a.endIso < b.startIso || b.endIso < a.startIso); }

function choosePlan(cands, leaveBudget, mode){
  const picked=[]; let remaining=leaveBudget;
  function tryPick(sorted, maxBreaks){
    for(const c of sorted){
      if (c.leaveNeeded>remaining) continue;
      if (picked.some(p=>overlaps(p,c))) continue;
      picked.push(c); remaining -= c.leaveNeeded;
      if (picked.length>=maxBreaks) break;
    }
  }

  if (mode==='more'){
    const s1 = cands.filter(c=>c.leaveNeeded<=2 && c.totalDaysOff>=4)
      .sort((a,b)=> b.efficiency-a.efficiency || b.totalDaysOff-a.totalDaysOff || a.leaveNeeded-b.leaveNeeded || a.startIso.localeCompare(b.startIso));
    tryPick(s1,6);
    if (picked.length<6 && remaining>0){
      const s2 = cands.filter(c=>c.leaveNeeded<=3)
        .sort((a,b)=> b.efficiency-a.efficiency || b.totalDaysOff-a.totalDaysOff || a.leaveNeeded-b.leaveNeeded || a.startIso.localeCompare(b.startIso));
      tryPick(s2,6);
    }
  } else if (mode==='balanced'){
    const s = cands.filter(c=>c.leaveNeeded>=2 && c.leaveNeeded<=5 && c.totalDaysOff>=6)
      .sort((a,b)=> b.totalDaysOff-a.totalDaysOff || b.efficiency-a.efficiency || a.startIso.localeCompare(b.startIso));
    tryPick(s,4);
  } else { // fewer (longer)
    const s = cands.slice().sort((a,b)=> b.totalDaysOff-a.totalDaysOff || a.leaveNeeded-b.leaveNeeded || a.startIso.localeCompare(b.startIso));
    tryPick(s,1);
    if (remaining>0) tryPick(s,2);
  }

  // Fallback: always produce something if empty
  if (!picked.length){
    const s = cands.slice().sort((a,b)=> b.efficiency-a.efficiency || b.totalDaysOff-a.totalDaysOff);
    tryPick(s,1);
  }

  return {breaks:picked, leaveUsed: leaveBudget-remaining};
}

function formatLeaveDates(dates, tz){
  return dates.map(iso=>{
    const [y,m,d]=iso.split('-');
    const dt = new Date(Date.UTC(+y,+m-1,+d));
    const wd = new Intl.DateTimeFormat('en-IE',{timeZone:tz,weekday:'short'}).format(dt);
    const md = new Intl.DateTimeFormat('en-IE',{timeZone:tz,month:'short',day:'numeric',year:'numeric'}).format(dt);
    return `${wd} ${md}`;
  });
}

async function main(){
  const data = await loadHolidays();
  const tz = data.timezone || 'Europe/Dublin';
  const holidays = (data.holidays||[]).slice();
  const holidayMap = new Map(holidays.map(h=>[h.date,h.name]));

  const today = getTodayIsoInTimeZone(tz);
  const horizonDays = 365; // next 12 months
  const dayMap = buildDayMap(today, horizonDays, tz, holidayMap);

  const form = document.getElementById('plannerForm');
  const btn = document.getElementById('calcBtn');
  const brush = makeYearBrush({ root: 'yearBrush', sel: 'brushSel', a: 'brushStart', b: 'brushEnd' }, today, horizonDays, tz);
  const useAllEl = document.getElementById('useAll');
  function run(){
    const leave = Math.max(1, Math.min(40, parseInt(document.getElementById('leaveDays').value||'10',10)));
    const mode = (new FormData(form).get('pref')) || 'balanced';
    let cands = generateCandidates(dayMap, leave);
    if (brush) {
      const r = brush.getRange();
      const startBound = r[0], endBound = r[1];
      cands = cands.filter(w => w.startIso >= startBound && w.endIso <= endBound);
    }
    let plan = choosePlan(cands, leave, mode )
    if (useAllEl && useAllEl.checked) {
      const remaining = Math.max(0, leave - plan.leaveUsed);
      const r = brush ? brush.getRange() : null; const ext = useEntireBudgetExtend(plan.breaks, remaining, dayMap, r);
      plan = { breaks: ext.breaks, leaveUsed: plan.leaveUsed + ext.extraUsed };
    }
    renderCalendar(today, tz, holidayMap, plan.breaks);
    const summary = document.getElementById('summary');
    const totalOff = plan.breaks.reduce((s,b)=>s+b.totalDaysOff,0);
        const allDays = plan.breaks.reduce((s,b)=> s + b.totalDaysOff, 0);
    // Workdays off = weekdays inside breaks (includes weekday bank holidays and leave days)
    const map = new Map(dayMap.map(d => [d.iso, d]));
    function isWeekday(iso){ const d = map.get(iso); return d && !d.isWeekend; }
    let workdaysOff = 0;
    for (const b of plan.breaks){
      let cur = b.startIso; const end = b.endIso;
      while (cur <= end){ if (isWeekday(cur)) workdaysOff++; cur = addDaysIso(cur,1); }
    }
    summary.innerHTML = `
      <div>Using <strong>${leave}</strong> leave days, book every day marked <strong>Leave</strong>.
      We shaded full break ranges and dotted bank holidays. Mon–Fri are workdays.</div>
      <div class="legend"><span><span class="sw leave"></span>Leave day</span><span><span class="sw break"></span>In break</span><span class="dot">Bank holiday</span></div>
      <div>Totals — Leave used: ${plan.leaveUsed} / ${leave} • Days off (all days): ${allDays} • Workdays off: ${workdaysOff} • Breaks: ${plan.breaks.length}</div>`;
  }
  btn.addEventListener('click', run);
}

document.addEventListener('DOMContentLoaded', main);

function monthName(y,m,tz){
  const dt = new Date(Date.UTC(y, m-1, 1));
  return new Intl.DateTimeFormat('en-IE',{timeZone:tz, month:'long', year:'numeric'}).format(dt);
}
function daysInMonth(y,m){ return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function weekdayIndexMonStart(y,m,d){ const dow = new Date(Date.UTC(y,m-1,d)).getUTCDay(); return (dow+6)%7; }
function addMonthsIso(iso, months){
  const [y,m] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m-1+months, 1));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-01`;
}
function renderCalendar(todayIso, tz, holidayMap, breaks){
  const cal = document.getElementById('calendar');
  const legend = document.getElementById('calLegend');
  if (!cal) return;
  cal.innerHTML = '';
  if (legend) legend.innerHTML = '<span><span class="sw break"></span>In break</span><span><span class="sw leave"></span>Leave day</span><span class="dot">Bank holiday</span>';

  const inBreak = new Map();
  const isLeave = new Set();
  for (const b of breaks){
    let cur = b.startIso; const end = b.endIso;
    while (cur <= end){ inBreak.set(cur, true); cur = addDaysIso(cur,1); }
    for (const d of b.leaveDates) isLeave.add(d);
  }

  const startMonthIso = todayIso.slice(0,7) + '-01';
  for (let i=0;i<12;i++){
    const firstIso = addMonthsIso(startMonthIso, i);
    const [y,m] = firstIso.split('-').map(Number);
    const dim = daysInMonth(y,m);
    const offset = weekdayIndexMonStart(y,m,1);

    const monthDiv = document.createElement('div');
    monthDiv.className = 'month';
    monthDiv.innerHTML = `<div class="month-header">${monthName(y,m,tz)}</div>` +
      `<div class="weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div>${d}</div>`).join('')}</div>` +
      `<div class="month-grid"></div>`;

    const grid = monthDiv.querySelector('.month-grid');
    for (let b=0;b<offset;b++){ const ph = document.createElement('div'); grid.appendChild(ph); }

    for (let d=1; d<=dim; d++){
      const iso = `${y}-${pad2(m)}-${pad2(d)}`;
      const day = document.createElement('div');
      day.className = 'day';
      const weekend = weekdayIndexMonStart(y,m,d) >=5;
      const isPast = iso < todayIso;
      if (weekend) day.classList.add('weekend');
      if (holidayMap.has(iso)) day.classList.add('holiday');
      if (isPast) {
        day.classList.add('past');
      } else {
        if (inBreak.has(iso)) day.classList.add('break');
        if (isLeave.has(iso)) day.classList.add('leave');
      }
      if (iso === todayIso) day.classList.add('today');
      const label = holidayMap.get(iso);
      day.title = [
        label? `Bank holiday: ${label}`: '',
        isLeave.has(iso)? 'Leave day': (inBreak.has(iso)? 'In break' : ''),
        weekend? 'Weekend': ''
      ].filter(Boolean).join(' • ');
      day.innerHTML = `<span class="num">${d}</span>`;
      grid.appendChild(day);
    }

    cal.appendChild(monthDiv);
  }
}











// --- Year Timeline Brush ---
function makeYearBrush(elIds, todayIso, horizonDays, tz) {
  const el = document.getElementById(elIds.root);
  if (!el) return null;
  const sel = document.getElementById(elIds.sel);
  const a = document.getElementById(elIds.a);
  const b = document.getElementById(elIds.b);
  const label = document.getElementById('brushLabel');

  const minIso = todayIso;
  const maxIso = addDaysIso(todayIso, horizonDays - 1);
  let startIso = minIso;
  let endIso = maxIso;

  function isoToPct(iso) {
    const [y,m,d] = iso.split('-').map(Number);
    const startMs = Date.UTC(...minIso.split('-').map((n,i)=> i===1?Number(n)-1:Number(n)),0,0,0);
    const curMs = Date.UTC(y, m-1, d);
    const maxMs = Date.UTC(...maxIso.split('-').map((n,i)=> i===1?Number(n)-1:Number(n)),0,0,0);
    return 8 + Math.max(0, Math.min(100, ((curMs - startMs) / (maxMs - startMs)) * 84));
  }
  function pctToIso(pct) {
    const startMs = Date.UTC(...minIso.split('-').map((n,i)=> i===1?Number(n)-1:Number(n)),0,0,0);
    const maxMs = Date.UTC(...maxIso.split('-').map((n,i)=> i===1?Number(n)-1:Number(n)),0,0,0);
    const t = startMs + ((pct - 8) / 84) * (maxMs - startMs);
    const dt = new Date(Math.max(startMs, Math.min(maxMs, t)));
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
  }
  function clampOrder() {
    if (startIso > endIso) { const t = startIso; startIso = endIso; endIso = t; }
  }
  function updateUI() {
    const left = isoToPct(startIso);
    const right = isoToPct(endIso);
    sel.style.left = left + '%';
    sel.style.right = (100 - right) + '%';
    a.style.left = `calc(${left}% - 11px)`;
    b.style.left = `calc(${right}% - 11px)`;
    if (label) label.textContent = `${formatFriendly(startIso, tz)} → ${formatFriendly(endIso, tz)}`;
  }

  function startDrag(handle, evt) {
    evt.preventDefault();
    const rect = el.getBoundingClientRect();
    function move(e) {
      const x = (e.touches? e.touches[0].clientX : e.clientX) - rect.left;
      const pct = 100 * Math.max(0, Math.min(1, x / rect.width));
      const iso = pctToIso(pct);
      if (handle === 'a') startIso = iso; else endIso = iso;
      clampOrder();
      updateUI();
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
  }

  a.addEventListener('mousedown', (e)=> startDrag('a', e));
  b.addEventListener('mousedown', (e)=> startDrag('b', e));
  a.addEventListener('touchstart', (e)=> startDrag('a', e), { passive: true });
  b.addEventListener('touchstart', (e)=> startDrag('b', e), { passive: true });

  updateUI();

  return {
    getRange() { return [startIso, endIso]; },
    setRange(s,e){ startIso=s; endIso=e; clampOrder(); updateUI(); }
  };
}






