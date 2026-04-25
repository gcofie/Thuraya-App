
// ============================================================
// THURAYA STAFF AVAILABILITY UPGRADE
// Version: availability-controls-v3-clean-ui-20260424
// Loaded AFTER app.js and attendance.js.
// Adds:
// 1) Calendar block prep minutes
// 2) Working-hours lunch period
// 3) Tech live lunch break toggle
// 4) Availability engine factoring prep + lunch + blocks
// ============================================================
console.log('✅ Availability controls loaded: availability-controls-v3-clean-ui-20260424');

(function(){
    const AV_VERSION = 'availability-controls-v3-clean-ui-20260424';

    function av_today() {
        if (typeof todayDateStr !== 'undefined' && todayDateStr) return todayDateStr;
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    }

    function av_timeToMins(t) {
        if (!t) return 0;
        const [h,m] = String(t).split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    }

    function av_minsToTime(mins) {
        const h = Math.floor(mins/60);
        const m = mins % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }

    function av_fmt12(t) {
        if (!t) return '—';
        const [h,m] = String(t).split(':').map(Number);
        return `${h%12||12}:${String(m||0).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    }

    function av_dayName(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    }

    function av_overlap(start, end, bStart, bEnd) {
        return start < bEnd && end > bStart;
    }

    function av_int(v, fallback=0) {
        const n = parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }

    function av_insertAfter(ref, node) {
        if (!ref || !node) return;
        ref.parentNode.insertBefore(node, ref.nextSibling);
    }

    function av_createBox(id, html) {
        let box = document.getElementById(id);
        if (!box) {
            box = document.createElement('div');
            box.id = id;
            box.innerHTML = html;
        }
        return box;
    }

    function av_injectCalendarPrepUI() {
        if (document.getElementById('att_blockPrepMinutes')) return;
        const reason = document.getElementById('att_blockReason')?.closest('.form-group');
        if (!reason) return;

        const wrap = document.createElement('div');
        wrap.className = 'form-group av-prep-field';
        wrap.innerHTML = `
            <label>Prep / Reset Minutes <span style="font-weight:400;color:#999;">(optional)</span></label>
            <input type="number" id="att_blockPrepMinutes" min="0" step="5" value="0" placeholder="e.g. 10">
            <p style="font-size:0.75rem;color:#777;margin:4px 0 0;">
                Adds buffer time after appointments affected by this block. Example: 10 minutes for cleaning/setup before the next client.
            </p>
        `;
        av_insertAfter(reason, wrap);
    }

    function av_injectWorkingLunchUI() {
        // Permanent-style clean UI: attach to the Working Hours form reliably.
        // Does not depend on fragile .grid-3 placement.
        let wrap = document.getElementById('att_schedLunchFields');
        const form = document.getElementById('att_schedForm');
        if (!form) return;

        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'att_schedLunchFields';
            wrap.className = 'module-box av-availability-defaults';
            wrap.style.cssText = `
                border-top:4px solid var(--accent);
                padding:18px;
                margin:0 0 20px;
                background:#fffaf0;
                border-radius:8px;
            `;
            wrap.innerHTML = `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
                    <div>
                        <h3 style="margin:0;color:var(--accent);border:none;padding:0;">Availability Defaults</h3>
                        <p style="font-size:0.82rem;color:#666;margin:4px 0 0;line-height:1.45;">
                            These values control technician availability and can be changed anytime without editing code.
                        </p>
                    </div>
                    <span style="font-size:0.72rem;font-weight:bold;color:var(--accent);background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);padding:5px 9px;border-radius:999px;">
                        Config-driven
                    </span>
                </div>

                <div class="grid-3" style="margin-bottom:0;align-items:start;">
                    <div class="form-group">
                        <label>Default Prep / Reset Minutes</label>
                        <input type="number" id="att_schedPrepMinutes" min="0" step="5" value="0" placeholder="e.g. 10">
                        <small style="color:#777;line-height:1.35;display:block;margin-top:4px;">
                            Added after each appointment before the next client can start.
                        </small>
                    </div>

                    <div class="form-group">
                        <label>Default Lunch Duration</label>
                        <input type="number" id="att_schedLunchDurationMinutes" min="5" step="5" value="60" placeholder="e.g. 45">
                        <small style="color:#777;line-height:1.35;display:block;margin-top:4px;">
                            Used when no fixed lunch window is selected and the tech starts lunch from My Attendance.
                        </small>
                    </div>

                    <div class="form-group">
                        <label>Lunch Rule</label>
                        <select id="att_schedLunchEnabled" onchange="av_toggleFixedLunchFields && av_toggleFixedLunchFields()">
                            <option value="false">Flexible lunch — use default duration</option>
                            <option value="true">Fixed lunch — block exact time</option>
                        </select>
                        <small style="color:#777;line-height:1.35;display:block;margin-top:4px;">
                            Fixed lunch blocks the same period every working day.
                        </small>
                    </div>

                    <div class="form-group av-fixed-lunch-field">
                        <label>Fixed Lunch Start</label>
                        <input type="time" id="att_schedLunchStart" value="13:00">
                    </div>

                    <div class="form-group av-fixed-lunch-field">
                        <label>Fixed Lunch End</label>
                        <input type="time" id="att_schedLunchEnd" value="14:00">
                    </div>

                    <div class="form-group" style="background:white;border:1px solid var(--border);border-radius:6px;padding:10px;">
                        <label style="margin-bottom:6px;">How this is applied</label>
                        <small style="color:#666;line-height:1.45;display:block;">
                            Availability = working hours minus appointments, prep time, calendar blocks, fixed lunch, and active live lunch.
                        </small>
                    </div>
                </div>
            `;

            // Insert at the top of the Working Hours form so it is immediately visible.
            form.insertBefore(wrap, form.firstChild);
        }

        if (typeof window.av_toggleFixedLunchFields === 'function') window.av_toggleFixedLunchFields();
    }

    window.av_toggleFixedLunchFields = function() {
        const enabled = document.getElementById('att_schedLunchEnabled')?.value === 'true';
        document.querySelectorAll('.av-fixed-lunch-field').forEach(el => {
            el.style.display = enabled ? 'block' : 'none';
        });
    };

    function av_lunchDurationMinutes(sched) {
        return Math.max(5, av_int(sched?.lunchDurationMinutes, 60));
    }

    function av_fixedLunchEnabled(sched) {
        return sched && (sched.lunchEnabled === true || sched.lunchEnabled === 'true');
    }

    function av_lunchExpectedEndFromStart(startStr, sched) {
        const start = av_timeToMins(startStr || '');
        if (!start) return '';
        return av_minsToTime(Math.min(20*60, start + av_lunchDurationMinutes(sched || {})));
    }

    function av_injectMyLunchUI() {
        if (document.getElementById('myattLunchBox')) return;
        const scheduleBox = document.getElementById('myatt_scheduleDisplay');
        if (!scheduleBox) return;

        const box = document.createElement('div');
        box.id = 'myattLunchBox';
        box.className = 'module-box';
        box.style.cssText = 'border-top:4px solid var(--success);margin-top:16px;';
        box.innerHTML = `
            <h3 style="color:var(--success);border-bottom-color:var(--success);">Lunch Break</h3>
            <p style="font-size:0.85rem;color:#666;margin-bottom:12px;">
                Turn this on when you start lunch. While lunch is active, your availability is blocked.
            </p>
            <div id="myattLunchStatus" style="padding:10px;border:1px solid var(--border);border-radius:6px;background:#f9fafb;margin-bottom:12px;">
                Loading lunch status…
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn" id="btnStartLunch" style="background:var(--accent);width:auto;padding:9px 16px;" onclick="av_startLunchBreak()">Start Lunch Break</button>
                <button class="btn btn-secondary" id="btnEndLunch" style="width:auto;padding:9px 16px;" onclick="av_endLunchBreak()">End Lunch Break</button>
            </div>
        `;
        av_insertAfter(scheduleBox, box);
        av_refreshMyLunchStatus();
    }

    async function av_getSchedule(email) {
        if (!email) return {};
        try {
            const d = await db.collection('Staff_Schedules').doc(email).get();
            return d.exists ? (d.data() || {}) : {};
        } catch(e) { return {}; }
    }

    async function av_getAttendance(email, dateStr) {
        if (!email || !dateStr) return {};
        try {
            const d = await db.collection('Attendance').doc(`${email}_${dateStr}`).get();
            return d.exists ? (d.data() || {}) : {};
        } catch(e) { return {}; }
    }

    async function av_getAvailabilityContext(dateStr) {
        const [apptSnap, blockSnap, schedSnap, attendanceSnap] = await Promise.all([
            db.collection('Appointments').where('dateString', '==', dateStr).get(),
            db.collection('Calendar_Blocks').get(),
            db.collection('Staff_Schedules').get(),
            db.collection('Attendance').where('date', '==', dateStr).get()
        ]);

        const appointments = [];
        apptSnap.forEach(doc => {
            const a = doc.data() || {};
            if (!['Scheduled','Arrived','In Progress','Ready for Payment'].includes(a.status)) return;
            if (!a.assignedTechEmail || !a.timeString) return;
            appointments.push({ id: doc.id, ...a });
        });

        const blocks = [];
        blockSnap.forEach(doc => blocks.push({ id: doc.id, ...(doc.data() || {}) }));

        const schedules = {};
        schedSnap.forEach(doc => schedules[doc.id] = doc.data() || {});

        const attendance = {};
        attendanceSnap.forEach(doc => {
            const a = doc.data() || {};
            if (a.email) attendance[a.email] = a;
        });

        return { appointments, blocks, schedules, attendance };
    }

    function av_blockAppliesToDate(block, dateStr) {
        if (!block || !dateStr) return false;
        if (block.type === 'full_day' || block.type === 'time_range' || block.type === 'tech_specific') {
            return block.dateString === dateStr || block.date === dateStr;
        }
        if (block.type === 'date_range') {
            return (block.rangeStart || '') <= dateStr && (block.rangeEnd || '') >= dateStr;
        }
        return false;
    }

    function av_blockAppliesToTech(block, email) {
        if (!block) return false;
        return !block.techEmail || block.techEmail === email;
    }

    function av_extraPrepForTech(email, dateStr, ctx) {
        const sched = ctx.schedules[email] || {};
        let prep = av_int(sched.prepMinutes, 0);
        (ctx.blocks || []).forEach(b => {
            if (!av_blockAppliesToDate(b, dateStr)) return;
            if (!av_blockAppliesToTech(b, email)) return;
            prep = Math.max(prep, av_int(b.prepMinutes, 0));
        });
        return prep;
    }

    function av_getTechHardBlocks(email, dateStr, ctx) {
        const out = [];
        const sched = ctx.schedules[email] || {};
        const att = ctx.attendance[email] || {};
        const day = av_dayName(dateStr);

        // Staff working hours. Defaults preserve current app behavior.
        const workingDays = Array.isArray(sched.workingDays) && sched.workingDays.length ? sched.workingDays : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const workStart = sched.startTime || '08:00';
        const workEnd = sched.endTime || '20:00';

        if (!workingDays.includes(day)) {
            out.push({ start: 0, end: 24*60, reason: 'Not a working day' });
            return out;
        }

        const ws = av_timeToMins(workStart);
        const we = av_timeToMins(workEnd);
        if (ws > 0) out.push({ start: 0, end: ws, reason: 'Before working hours' });
        if (we < 24*60) out.push({ start: we, end: 24*60, reason: 'After working hours' });

        // Fixed lunch period from working hours.
        // If fixed lunch is disabled, do NOT block a guessed lunch window.
        // The default lunch duration is used only when the tech starts lunch from My Attendance.
        if (av_fixedLunchEnabled(sched)) {
            const ls = av_timeToMins(sched.lunchStart || '13:00');
            const le = av_timeToMins(sched.lunchEnd || '14:00');
            if (le > ls) out.push({ start: ls, end: le, reason: 'Fixed lunch period' });
        }

        // Live lunch break from tech My Attendance.
        // If no fixed lunch is set, expected end = lunchStart + default lunch duration.
        if (att.lunchBreakActive === true) {
            const now = new Date();
            const isToday = dateStr === av_today();
            let ls = av_timeToMins(att.lunchStartString || (isToday ? av_minsToTime(now.getHours()*60 + now.getMinutes()) : (sched.lunchStart || '13:00')));
            let le = av_timeToMins(att.lunchExpectedEndString || '');
            if (!le || le <= ls) {
                if (av_fixedLunchEnabled(sched)) {
                    le = av_timeToMins(sched.lunchEnd || '') || Math.min(20*60, ls + av_lunchDurationMinutes(sched));
                } else {
                    le = Math.min(20*60, ls + av_lunchDurationMinutes(sched));
                }
            }
            out.push({ start: ls, end: le, reason: 'Active lunch break' });
        }

        // Calendar blocks.
        (ctx.blocks || []).forEach(b => {
            if (!av_blockAppliesToDate(b, dateStr)) return;
            if (!av_blockAppliesToTech(b, email)) return;

            if (b.type === 'full_day' || b.type === 'date_range' || b.type === 'tech_specific') {
                out.push({ start: 0, end: 24*60, reason: b.reason || 'Calendar block' });
            } else if (b.type === 'time_range') {
                const bs = av_timeToMins(b.startTime || b.start || b.blockStart);
                const be = av_timeToMins(b.endTime || b.end || b.blockEnd);
                if (be > bs) out.push({ start: bs, end: be, reason: b.reason || 'Calendar block' });
            }
        });

        return out;
    }

    function av_isTechFree(email, start, end, dateStr, ctx) {
        const hardBlocks = av_getTechHardBlocks(email, dateStr, ctx);
        if (hardBlocks.some(b => av_overlap(start, end, b.start, b.end))) return false;

        const prep = av_extraPrepForTech(email, dateStr, ctx);
        const jobs = ctx.appointments.filter(a => a.assignedTechEmail === email);
        for (const a of jobs) {
            const aStart = av_timeToMins(a.timeString);
            const aEnd = aStart + av_int(a.bookedDuration, 0) + prep;
            if (av_overlap(start, end, aStart, aEnd)) return false;
        }
        return true;
    }

    async function av_populateBlockTechDropdown() {
        const select = document.getElementById('att_blockTech');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">All technicians</option>';
        const techs = Array.isArray(allTechs) ? allTechs : [];
        techs.forEach(t => {
            select.innerHTML += `<option value="${t.email}">${t.name || t.email}</option>`;
        });
        if (current) select.value = current;
    }

    async function av_populateScheduleTechDropdowns() {
        const ids = ['att_schedTech','att_leaveTech','att_leaveTechFilter'];
        const techs = Array.isArray(allTechs) ? allTechs : [];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const current = el.value;
            const first = id === 'att_leaveTechFilter' ? '<option value="all">All Staff</option>' : '<option value="">Select staff member…</option>';
            el.innerHTML = first + techs.map(t => `<option value="${t.email}">${t.name || t.email}</option>`).join('');
            if (current) el.value = current;
        });
        await av_populateBlockTechDropdown();
    }

    // Override calendar block type UI to preserve existing behavior and new prep field.
    window.att_onBlockTypeChange = function() {
        const type = document.getElementById('att_blockType')?.value || '';
        const single = document.getElementById('att_blockSingleDateField');
        const range = document.getElementById('att_blockDateRangeFields');
        const time = document.getElementById('att_blockTimeFields');
        const tech = document.getElementById('att_blockTechField');
        const label = document.getElementById('att_blockTechLabel');

        if (single) single.style.display = ['full_day','time_range','tech_specific'].includes(type) ? 'block' : 'none';
        if (range) range.style.display = type === 'date_range' ? 'grid' : 'none';
        if (time) time.style.display = type === 'time_range' ? 'grid' : 'none';
        if (tech) tech.style.display = ['time_range','tech_specific','date_range'].includes(type) ? 'block' : 'none';
        if (label) label.textContent = type === 'date_range' || type === 'time_range' ? '(leave blank to apply to all)' : '';
        av_injectCleanUiStyles();
        av_injectCalendarPrepUI();
        av_populateBlockTechDropdown();
    };

    window.att_saveBlock = async function() {
        const type = document.getElementById('att_blockType')?.value || '';
        const msg = document.getElementById('att_blockMsg');
        const prepMinutes = av_int(document.getElementById('att_blockPrepMinutes')?.value, 0);
        const payload = {
            type,
            reason: document.getElementById('att_blockReason')?.value?.trim() || '',
            techEmail: document.getElementById('att_blockTech')?.value || '',
            prepMinutes,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!type) { alert('Select a block type.'); return; }

        if (type === 'date_range') {
            payload.rangeStart = document.getElementById('att_blockRangeStart')?.value || '';
            payload.rangeEnd = document.getElementById('att_blockRangeEnd')?.value || '';
            if (!payload.rangeStart || !payload.rangeEnd) { alert('Select start and end date.'); return; }
            if (payload.rangeEnd < payload.rangeStart) { alert('End date cannot be before start date.'); return; }
        } else {
            payload.dateString = document.getElementById('att_blockDate')?.value || '';
            if (!payload.dateString) { alert('Select a date.'); return; }
        }

        if (type === 'time_range') {
            payload.startTime = document.getElementById('att_blockStart')?.value || '';
            payload.endTime = document.getElementById('att_blockEnd')?.value || '';
            if (!payload.startTime || !payload.endTime) { alert('Enter start and end time.'); return; }
            if (payload.endTime <= payload.startTime) { alert('End time must be after start time.'); return; }
        }

        try {
            await db.collection('Calendar_Blocks').add({
                ...payload,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: currentUserEmail || ''
            });
            if (msg) { msg.textContent = 'Block saved.'; msg.style.color = 'var(--success)'; }
            ['att_blockType','att_blockDate','att_blockRangeStart','att_blockRangeEnd','att_blockStart','att_blockEnd','att_blockReason','att_blockPrepMinutes'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = id === 'att_blockPrepMinutes' ? '0' : '';
            });
            const tech = document.getElementById('att_blockTech'); if (tech) tech.value = '';
            window.att_onBlockTypeChange();
            if (typeof att_loadBlocks === 'function') att_loadBlocks();
            if (typeof generateTimeSlots === 'function') generateTimeSlots();
        } catch(e) {
            if (msg) { msg.textContent = e.message; msg.style.color = 'var(--error)'; }
            else alert('Error saving block: ' + e.message);
        }
    };

    window.att_saveSchedule = async function() {
        const email = document.getElementById('att_schedTech')?.value || '';
        if (!email) { alert('Select a staff member.'); return; }

        const workingDays = Array.from(document.querySelectorAll('.att-day-cb:checked')).map(cb => cb.value);
        if (!workingDays.length) { alert('Select at least one working day.'); return; }

        const startTime = document.getElementById('att_schedStart')?.value || '08:00';
        const endTime = document.getElementById('att_schedEnd')?.value || '20:00';
        if (endTime <= startTime) { alert('End time must be after start time.'); return; }

        const lunchEnabled = document.getElementById('att_schedLunchEnabled')?.value === 'true';
        const lunchStart = document.getElementById('att_schedLunchStart')?.value || '';
        const lunchEnd = document.getElementById('att_schedLunchEnd')?.value || '';
        const lunchDurationMinutes = Math.max(5, av_int(document.getElementById('att_schedLunchDurationMinutes')?.value, 60));
        if (lunchEnabled && (!lunchStart || !lunchEnd || lunchEnd <= lunchStart)) {
            alert('Please enter a valid fixed lunch start and end time.');
            return;
        }

        const payload = {
            workingDays,
            startTime,
            endTime,
            effectiveFrom: document.getElementById('att_schedEffective')?.value || av_today(),
            lunchEnabled,
            lunchStart: lunchEnabled ? lunchStart : '',
            lunchEnd: lunchEnabled ? lunchEnd : '',
            lunchDurationMinutes,
            prepMinutes: av_int(document.getElementById('att_schedPrepMinutes')?.value, 0),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUserEmail || ''
        };

        try {
            await db.collection('Staff_Schedules').doc(email).set(payload, { merge: true });
            alert('Working hours saved, including lunch/prep availability controls.');
            if (typeof att_loadSchedule === 'function') att_loadSchedule();
            if (typeof generateTimeSlots === 'function') generateTimeSlots();
        } catch(e) { alert('Error saving schedule: ' + e.message); }
    };

    const _origAttLoadSchedule = window.att_loadSchedule;
    window.att_loadSchedule = async function() {
        if (typeof _origAttLoadSchedule === 'function') {
            try { await _origAttLoadSchedule(); } catch(e) { console.warn(e); }
        }
        av_injectWorkingLunchUI();
        const email = document.getElementById('att_schedTech')?.value || '';
        const form = document.getElementById('att_schedForm');
        if (form && email) form.style.display = 'block';
        if (!email) return;

        const sched = await av_getSchedule(email);
        if (document.getElementById('att_schedStart')) document.getElementById('att_schedStart').value = sched.startTime || '08:00';
        if (document.getElementById('att_schedEnd')) document.getElementById('att_schedEnd').value = sched.endTime || '20:00';
        if (document.getElementById('att_schedEffective')) document.getElementById('att_schedEffective').value = sched.effectiveFrom || av_today();

        document.querySelectorAll('.att-day-cb').forEach(cb => {
            cb.checked = Array.isArray(sched.workingDays) ? sched.workingDays.includes(cb.value) : ['Mon','Tue','Wed','Thu','Fri','Sat'].includes(cb.value);
        });

        const le = document.getElementById('att_schedLunchEnabled');
        if (le) le.value = av_fixedLunchEnabled(sched) ? 'true' : 'false';
        if (document.getElementById('att_schedLunchStart')) document.getElementById('att_schedLunchStart').value = sched.lunchStart || '13:00';
        if (document.getElementById('att_schedLunchEnd')) document.getElementById('att_schedLunchEnd').value = sched.lunchEnd || '14:00';
        if (document.getElementById('att_schedLunchDurationMinutes')) document.getElementById('att_schedLunchDurationMinutes').value = av_lunchDurationMinutes(sched);
        if (document.getElementById('att_schedPrepMinutes')) document.getElementById('att_schedPrepMinutes').value = av_int(sched.prepMinutes, 0);
        if (typeof window.av_toggleFixedLunchFields === 'function') window.av_toggleFixedLunchFields();

        const badge = document.getElementById('att_schedCurrentBadge');
        const txt = document.getElementById('att_schedCurrentText');
        if (badge && txt) {
            const lunch = av_fixedLunchEnabled(sched) ? ` · Fixed lunch ${sched.lunchStart || '13:00'}–${sched.lunchEnd || '14:00'}` : ` · Default lunch ${av_lunchDurationMinutes(sched)} mins`;
            const prep = av_int(sched.prepMinutes, 0) ? ` · Prep ${av_int(sched.prepMinutes)} mins` : ' · Prep 0 mins';
            txt.textContent = `${sched.startTime || '08:00'}–${sched.endTime || '20:00'} · ${(sched.workingDays || []).join(', ') || 'No days set'}${lunch}${prep}`;
            badge.style.display = 'block';
        }
    };

    window.av_startLunchBreak = async function() {
        if (!currentUserEmail) { alert('No signed-in user.'); return; }
        const now = new Date();
        const nowStr = av_minsToTime(now.getHours()*60 + now.getMinutes());
        try {
            await db.collection('Attendance').doc(`${currentUserEmail}_${av_today()}`).set({
                email: currentUserEmail,
                name: currentUserName || currentUserEmail,
                roleString: Array.isArray(currentRoles) ? currentRoles.join(',') : '',
                date: av_today(),
                lunchBreakActive: true,
                lunchStartString: nowStr,
                lunchExpectedEndString: av_lunchExpectedEndFromStart(nowStr, await av_getSchedule(currentUserEmail)),
                lunchStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            av_refreshMyLunchStatus();
            if (typeof generateTimeSlots === 'function') generateTimeSlots();
        } catch(e) { alert('Could not start lunch: ' + e.message); }
    };

    window.av_endLunchBreak = async function() {
        if (!currentUserEmail) { alert('No signed-in user.'); return; }
        const now = new Date();
        const nowStr = av_minsToTime(now.getHours()*60 + now.getMinutes());
        try {
            await db.collection('Attendance').doc(`${currentUserEmail}_${av_today()}`).set({
                lunchBreakActive: false,
                lunchEndString: nowStr,
                lunchEndedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            av_refreshMyLunchStatus();
            if (typeof generateTimeSlots === 'function') generateTimeSlots();
        } catch(e) { alert('Could not end lunch: ' + e.message); }
    };

    async function av_refreshMyLunchStatus() {
        const box = document.getElementById('myattLunchStatus');
        if (!box || !currentUserEmail) return;
        const att = await av_getAttendance(currentUserEmail, av_today());
        const sched = await av_getSchedule(currentUserEmail);
        const planned = av_fixedLunchEnabled(sched)
            ? `Fixed lunch: ${av_fmt12(sched.lunchStart || '13:00')} – ${av_fmt12(sched.lunchEnd || '14:00')}`
            : `Flexible lunch: ${av_lunchDurationMinutes(sched)} mins default duration`;
        const expectedEnd = att.lunchExpectedEndString || av_lunchExpectedEndFromStart(att.lunchStartString, sched);

        if (att.lunchBreakActive === true) {
            box.innerHTML = `<strong style="color:var(--error);">Lunch break active</strong><br><span style="font-size:0.82rem;color:#666;">Started: ${av_fmt12(att.lunchStartString)} · Expected end: ${av_fmt12(expectedEnd)} · ${planned}</span>`;
            const s = document.getElementById('btnStartLunch'); if (s) s.disabled = true;
            const e = document.getElementById('btnEndLunch'); if (e) e.disabled = false;
        } else {
            box.innerHTML = `<strong style="color:var(--success);">Available / not on lunch</strong><br><span style="font-size:0.82rem;color:#666;">${planned}${att.lunchEndString ? ' · Last ended: ' + av_fmt12(att.lunchEndString) : ''}</span>`;
            const s = document.getElementById('btnStartLunch'); if (s) s.disabled = false;
            const e = document.getElementById('btnEndLunch'); if (e) e.disabled = true;
        }
    }
    window.av_refreshMyLunchStatus = av_refreshMyLunchStatus;

    // Override staff booking availability generation.
    window.generateTimeSlots = async function() {
        const date = document.getElementById('sched_date')?.value || '';
        const duration = av_int(document.getElementById('sched_totalDuration')?.innerText, 0);
        const techEmail = document.getElementById('sched_techSelect')?.value || '';
        const groupSize = av_int(document.getElementById('sched_groupSize')?.value, 1);
        const slotsContainer = document.getElementById('sched_timeSlots');
        const hiddenTime = document.getElementById('sched_time');

        if (!slotsContainer) return;
        if (hiddenTime) hiddenTime.value = '';

        if (date && date < av_today()) {
            slotsContainer.innerHTML = '<p style="color:var(--error);font-weight:bold;margin:0;">You cannot book appointments in the past.</p>';
            return;
        }

        if (!date || !techEmail || duration === 0) {
            slotsContainer.innerHTML = '<p style="color:#999;font-size:0.85rem;margin:0;font-style:italic;">⚠️ Please select at least one Service, a Date, and a Technician to generate available times.</p>';
            return;
        }

        slotsContainer.innerHTML = '<p style="color:#666;font-size:0.85rem;margin:0;">Calculating availability with prep, lunch, and blocks...</p>';

        try {
            const ctx = await av_getAvailabilityContext(date);
            const openTime = 8 * 60;
            const closeTime = 20 * 60;
            const interval = 30;
            const now = new Date();
            const currentMins = now.getHours()*60 + now.getMinutes();
            const isToday = date === av_today();

            const allTechList = Array.isArray(allTechs) ? allTechs : [];
            const selectedTech = allTechList.find(t => t.email === techEmail) || { email: techEmail };
            const otherTechs = allTechList.filter(t => t.email !== techEmail);
            let html = '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
            let slotsFound = false;

            for (let t = openTime; t + duration <= closeTime; t += interval) {
                if (isToday && t < currentMins + 30) continue;
                const end = t + duration;

                const selectedFree = av_isTechFree(selectedTech.email, t, end, date, ctx);
                if (!selectedFree) continue;

                if (groupSize > 1) {
                    const additionalFree = otherTechs.filter(tech => av_isTechFree(tech.email, t, end, date, ctx));
                    if (additionalFree.length < groupSize - 1) continue;
                }

                slotsFound = true;
                const time24 = av_minsToTime(t);
                html += `<button type="button" class="time-slot-btn" data-time="${time24}" onclick="selectTimeSlot('${time24}', this)">${av_fmt12(time24)}</button>`;
            }

            html += '</div>';

            if (!slotsFound) {
                slotsContainer.innerHTML = groupSize > 1
                    ? `<p style="color:var(--error);font-weight:bold;margin:0;">No slots available where ${groupSize} technicians are free simultaneously after prep/lunch/block rules. Try another time/date or split the group.</p>`
                    : '<p style="color:var(--error);font-weight:bold;margin:0;">No time slots available after prep/lunch/block rules.</p>';
            } else {
                slotsContainer.innerHTML = html;
            }
        } catch(e) {
            console.error('Availability controls error:', e);
            slotsContainer.innerHTML = `<p style="color:var(--error);font-weight:bold;margin:0;">Availability error: ${e.message}</p>`;
        }
    };

    // Better FOH roster: show lunch as busy.
    function startFohRosterListener() {
        const rosterDiv = document.getElementById('fohRosterList');
        if (!rosterDiv) return;
        try {
            if (typeof fohRosterListener === 'function') {
                try { fohRosterListener(); } catch(e) {}
            }
            fohRosterListener = db.collection('Attendance').where('date', '==', av_today()).onSnapshot(async (attendanceSnap) => {
                const [activeJobsSnap, scheduledSnap] = await Promise.all([
                    db.collection('Active_Jobs').where('status', 'in', ['Waiting','In Progress']).get(),
                    db.collection('Appointments').where('dateString', '==', av_today()).where('status', '==', 'Scheduled').get()
                ]);

                const busyTechEmails = new Set();
                activeJobsSnap.forEach(job => { const email = job.data().assignedTechEmail; if (email) busyTechEmails.add(email); });

                const now = new Date();
                const currentMins = now.getHours()*60 + now.getMinutes();
                scheduledSnap.forEach(doc => {
                    const appt = doc.data();
                    const aStart = av_timeToMins(appt.timeString);
                    const aEnd = aStart + av_int(appt.bookedDuration, 0);
                    if (currentMins >= aStart && currentMins < aEnd && appt.assignedTechEmail) busyTechEmails.add(appt.assignedTechEmail);
                });

                let html = '';
                attendanceSnap.forEach(doc => {
                    const tech = doc.data();
                    if (tech.clockOut || !(tech.roleString && (tech.roleString.toLowerCase().includes('tech') || tech.roleString.toLowerCase().includes('test tech')))) return;

                    const onLunch = tech.lunchBreakActive === true;
                    const isBusy = busyTechEmails.has(tech.email) || onLunch;
                    const statusDot = isBusy ? 'status-busy' : 'status-available';
                    const statusText = onLunch
                        ? '<span style="color:var(--accent);font-size:0.8rem;font-weight:bold;">LUNCH</span>'
                        : (isBusy ? '<span style="color:var(--error);font-size:0.8rem;font-weight:bold;">BUSY</span>' : '<span style="color:var(--success);font-size:0.8rem;font-weight:bold;">AVAILABLE</span>');

                    html += `<div class="roster-item"><div><strong>${tech.name}</strong>${onLunch ? `<br><small>Started lunch: ${av_fmt12(tech.lunchStartString)}</small>` : ''}</div><div style="display:flex;align-items:center;"><span class="status-dot ${statusDot}"></span> ${statusText}</div></div>`;
                });

                if (!html) html = '<p style="color:#999;font-style:italic;">No Technicians currently on the floor.</p>';
                rosterDiv.innerHTML = html;
            });
        } catch(e) { console.error(e); }
    }
    window.startFohRosterListener = startFohRosterListener;


    function av_injectCleanUiStyles() {
        if (document.getElementById('avCleanUiStyles')) return;
        const st = document.createElement('style');
        st.id = 'avCleanUiStyles';
        st.textContent = `
            .av-availability-defaults .grid-3 {
                display:grid;
                grid-template-columns:repeat(3,minmax(0,1fr));
                gap:14px;
            }
            .av-availability-defaults input,
            .av-availability-defaults select {
                width:100%;
            }
            @media (max-width:900px) {
                .av-availability-defaults .grid-3 {
                    grid-template-columns:1fr;
                }
            }
        `;
        document.head.appendChild(st);
    }

    function av_boot() {
        av_injectCalendarPrepUI();
        av_injectWorkingLunchUI();
        if (typeof window.av_toggleFixedLunchFields === 'function') window.av_toggleFixedLunchFields();
        av_injectMyLunchUI();
        av_populateScheduleTechDropdowns();
        if (document.getElementById('att_schedEffective') && !document.getElementById('att_schedEffective').value) {
            document.getElementById('att_schedEffective').value = av_today();
        }
        setTimeout(av_populateScheduleTechDropdowns, 1200);
        setTimeout(av_refreshMyLunchStatus, 1200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', av_boot);
    } else {
        av_boot();
    }

    // Re-inject when user changes tabs/modules because some sections are hidden at first.
    document.addEventListener('click', () => setTimeout(av_boot, 250));
})();
