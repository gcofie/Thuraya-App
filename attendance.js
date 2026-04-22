// ============================================================
//  THURAYA — 4c + 4d  Attendance Module  attendance.js
//  Add to index.html after app.js:
//    <script src="attendance.js"></script>
//
//  Firestore collections used:
//    Staff_Schedules/{techEmail}  — working hours per tech
//    Staff_Leave/{autoId}         — leave requests
//    Staff_Leave_Balances/{techEmail}/{year}/entitlement — paid days
//    Users                        — tech list (already loaded in app.js)
// ============================================================


// ── Sub-tab switcher ──────────────────────────────────────────
window.att_switchSub = function(subId) {
    document.querySelectorAll('.att-sub').forEach(el => el.style.display = 'none');
    const target = document.getElementById(subId);
    if (target) target.style.display = 'block';

    // Lazy-load data when tab is first opened
    if (subId === 'att_roster')   att_initRoster();
    if (subId === 'att_schedule') att_initSchedule();
    if (subId === 'att_leave')    att_initLeave();
    if (subId === 'att_balances') att_initBalances();
};

// Called when attendanceView module is switched to
window.att_onModuleOpen = function() {
    att_populateTechDropdowns();
    att_initRoster(); // default sub-tab
};

// Override switchModule to hook into attendance open
const _att_origSwitchModule = window.switchModule;
window.switchModule = function(moduleId) {
    _att_origSwitchModule(moduleId);
    if (moduleId === 'attendanceView') att_onModuleOpen();
};


// ── Populate all tech dropdowns ───────────────────────────────
function att_populateTechDropdowns() {
    // allTechs is populated by fetchAllTechs() in app.js
    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);

    const selectors = ['att_schedTech', 'att_leaveTech', 'att_leaveTechFilter'];
    selectors.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const isFilter = id === 'att_leaveTechFilter';
        const current = el.value;
        el.innerHTML = isFilter
            ? '<option value="all">All Staff</option>'
            : '<option value="">Select staff member…</option>';
        techs.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.email;
            opt.textContent = t.name || t.email;
            el.appendChild(opt);
        });
        if (current) el.value = current;
    });
}


// ============================================================
//  DAILY ROSTER
// ============================================================
function att_initRoster() {
    const dateEl = document.getElementById('att_rosterDate');
    if (dateEl && !dateEl.value) {
        // Default to today
        const now = new Date();
        dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
    att_loadRoster();
}

window.att_loadRoster = async function() {
    const dateStr = document.getElementById('att_rosterDate')?.value;
    const listEl  = document.getElementById('att_rosterList');
    if (!dateStr || !listEl) return;

    const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayAbbr = days[new Date(dateStr + 'T12:00:00').getDay()];

    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading…</p>';

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No staff found.</p>';
        return;
    }

    try {
        const techEmails = techs.map(t => t.email);

        // Fetch schedules + leave in parallel
        // Leave: single where only — filter dates client-side to avoid composite index
        const chunks = att_chunk(techEmails, 30);
        const [schedDocs, leaveDocs] = await Promise.all([
            Promise.all(chunks.map(c =>
                db.collection('Staff_Schedules')
                    .where(firebase.firestore.FieldPath.documentId(), 'in', c)
                    .get()
            )),
            db.collection('Staff_Leave')
                .where('status', '==', 'Approved')
                .get()
        ]);

        // Build schedule map
        const schedMap = {};
        schedDocs.forEach(snap => snap.forEach(d => { schedMap[d.id] = d.data(); }));

        // Build leave set — filter to records covering dateStr client-side
        const onLeave = {};
        leaveDocs.forEach(d => {
            const l = d.data();
            if (l.startDate <= dateStr && l.endDate >= dateStr && l.techEmail) {
                onLeave[l.techEmail] = l.type || 'Leave';
            }
        });

        // Render
        let html = '<table style="width:100%; border-collapse:collapse;">';
        html += `<thead><tr style="background:#f1f1f1;">
            <th style="padding:10px; text-align:left; font-size:0.85rem; color:var(--primary);">Staff Member</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Status</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Working Hours</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Note</th>
        </tr></thead><tbody>`;

        techs.forEach(t => {
            const sched    = schedMap[t.email] || { workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], startTime:'08:00', endTime:'20:00' };
            const worksDay = (sched.workingDays || []).includes(dayAbbr);
            const leaveType = onLeave[t.email];

            let statusHtml, hours, note = '';
            if (leaveType) {
                statusHtml = `<span class="att-badge att-badge--leave">${leaveType}</span>`;
                hours = '—';
                note  = 'On approved leave';
            } else if (!worksDay) {
                statusHtml = `<span class="att-badge att-badge--off">Day Off</span>`;
                hours = '—';
                note  = `Not scheduled on ${dayAbbr}`;
            } else {
                statusHtml = `<span class="att-badge att-badge--working">Scheduled</span>`;
                hours = `${att_fmt12(sched.startTime)} – ${att_fmt12(sched.endTime)}`;
            }

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:12px 10px; font-weight:600; color:var(--primary);">${t.name || t.email}</td>
                <td style="padding:12px 10px; text-align:center;">${statusHtml}</td>
                <td style="padding:12px 10px; text-align:center; color:#555; font-size:0.88rem;">${hours}</td>
                <td style="padding:12px 10px; text-align:center; color:#999; font-size:0.82rem; font-style:italic;">${note}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error loading roster: ${e.message}</p>`;
    }
};


// ============================================================
//  WORKING HOURS  (4c)
// ============================================================
function att_initSchedule() {
    att_populateTechDropdowns();
    const effEl = document.getElementById('att_schedEffective');
    if (effEl && !effEl.value) {
        const now = new Date();
        effEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
}

window.att_loadSchedule = async function() {
    const email = document.getElementById('att_schedTech')?.value;
    if (!email) return;

    const formEl    = document.getElementById('att_schedForm');
    const badgeEl   = document.getElementById('att_schedCurrentBadge');
    const badgeTxt  = document.getElementById('att_schedCurrentText');
    const histBox   = document.getElementById('att_schedHistoryBox');
    const histEl    = document.getElementById('att_schedHistory');

    if (formEl)  formEl.style.display  = 'block';
    if (badgeEl) badgeEl.style.display = 'none';

    try {
        const doc = await db.collection('Staff_Schedules').doc(email).get();
        if (doc.exists) {
            const s = doc.data();
            // Populate form
            const startEl = document.getElementById('att_schedStart');
            const endEl   = document.getElementById('att_schedEnd');
            if (startEl) startEl.value = s.startTime || '08:00';
            if (endEl)   endEl.value   = s.endTime   || '20:00';

            // Tick working days
            document.querySelectorAll('.att-day-cb').forEach(cb => {
                cb.checked = (s.workingDays || []).includes(cb.value);
            });

            // Show current summary badge
            const days = (s.workingDays || []).join(', ');
            if (badgeEl && badgeTxt) {
                badgeTxt.textContent = `${days} · ${att_fmt12(s.startTime)} – ${att_fmt12(s.endTime)}`;
                badgeEl.style.display = 'block';
            }
        } else {
            // Defaults
            document.querySelectorAll('.att-day-cb').forEach(cb => {
                cb.checked = ['Mon','Tue','Wed','Thu','Fri','Sat'].includes(cb.value);
            });
            const startEl = document.getElementById('att_schedStart');
            const endEl   = document.getElementById('att_schedEnd');
            if (startEl) startEl.value = '08:00';
            if (endEl)   endEl.value   = '20:00';
        }

        // Load history (Staff_Schedule_History sub-collection)
        const histSnap = await db.collection('Staff_Schedules').doc(email)
            .collection('history')
            .orderBy('savedAt', 'desc')
            .limit(10)
            .get();

        if (!histSnap.empty && histBox && histEl) {
            histBox.style.display = 'block';
            histEl.innerHTML = histSnap.docs.map(d => {
                const h = d.data();
                const days = (h.workingDays || []).join(', ');
                let savedAt = '';
                try { savedAt = h.savedAt?.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); } catch(e) {}
                return `<div style="padding:8px 0; border-bottom:1px solid #eee; font-size:0.85rem; color:#555;">
                    <strong style="color:var(--primary);">${days}</strong> · ${att_fmt12(h.startTime)} – ${att_fmt12(h.endTime)}
                    <span style="float:right; color:#999;">${savedAt}</span>
                </div>`;
            }).join('');
        } else if (histBox) {
            histBox.style.display = 'none';
        }

    } catch (e) {
        console.error('att_loadSchedule:', e);
    }
};

window.att_saveSchedule = async function() {
    const email   = document.getElementById('att_schedTech')?.value;
    const start   = document.getElementById('att_schedStart')?.value;
    const end     = document.getElementById('att_schedEnd')?.value;
    const effDate = document.getElementById('att_schedEffective')?.value;
    const days    = [...document.querySelectorAll('.att-day-cb:checked')].map(c => c.value);
    const btn     = document.getElementById('btnSaveSchedule');

    if (!email) { alert('Please select a staff member.'); return; }
    if (!days.length) { alert('Please select at least one working day.'); return; }
    if (!start || !end) { alert('Please set start and end times.'); return; }
    if (start >= end) { alert('End time must be after start time.'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const batch = db.batch();
        const ref   = db.collection('Staff_Schedules').doc(email);

        const data = {
            workingDays:   days,
            startTime:     start,
            endTime:       end,
            effectiveFrom: effDate || att_todayStr(),
            updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
        };

        // Save to main doc
        batch.set(ref, data, { merge: true });

        // Save snapshot to history sub-collection
        const histRef = ref.collection('history').doc();
        batch.set(histRef, { ...data, savedAt: firebase.firestore.FieldValue.serverTimestamp() });

        await batch.commit();

        btn.textContent = '✓ Saved';
        btn.style.background = 'var(--success)';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save Working Hours'; btn.style.background = ''; }, 2000);

        // Refresh display
        att_loadSchedule();

    } catch (e) {
        alert('Error saving schedule: ' + e.message);
        btn.disabled = false; btn.textContent = 'Save Working Hours';
    }
};


// ============================================================
//  LEAVE MANAGEMENT  (4d)
// ============================================================
function att_initLeave() {
    att_populateTechDropdowns();
    att_loadLeaveRequests();
}

window.att_submitLeave = async function() {
    const email     = document.getElementById('att_leaveTech')?.value;
    const type      = document.getElementById('att_leaveType')?.value;
    const startDate = document.getElementById('att_leaveStart')?.value;
    const endDate   = document.getElementById('att_leaveEnd')?.value;
    const note      = document.getElementById('att_leaveNote')?.value?.trim() || '';
    const msgEl     = document.getElementById('att_leaveMsg');
    const btn       = document.getElementById('btnSubmitLeave');

    if (!email)     { att_leaveMsg('Select a staff member.', false); return; }
    if (!type)      { att_leaveMsg('Select a leave type.', false); return; }
    if (!startDate) { att_leaveMsg('Select a start date.', false); return; }
    if (!endDate)   { att_leaveMsg('Select an end date.', false); return; }
    if (endDate < startDate) { att_leaveMsg('End date cannot be before start date.', false); return; }

    btn.disabled = true; btn.textContent = 'Submitting…';

    try {
        const tech = (typeof allTechs !== 'undefined' ? allTechs : []).find(t => t.email === email);

        await db.collection('Staff_Leave').add({
            techEmail:   email,
            techName:    tech?.name || email,
            type,
            startDate,
            endDate,
            note,
            status:      'Approved', // Manager-submitted = auto-approved
            approvedBy:  typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
        });

        att_leaveMsg('✓ Leave request submitted and approved.', true);

        // Reset form
        ['att_leaveTech','att_leaveType','att_leaveStart','att_leaveEnd'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const noteEl = document.getElementById('att_leaveNote');
        if (noteEl) noteEl.value = '';

        att_loadLeaveRequests();

    } catch (e) {
        att_leaveMsg('Error: ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = 'Submit Leave Request';
    }
};

function att_leaveMsg(msg, ok) {
    const el = document.getElementById('att_leaveMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? 'var(--success)' : 'var(--error)';
}

window.att_loadLeaveRequests = async function() {
    const listEl      = document.getElementById('att_leaveList');
    const filterStatus= document.getElementById('att_leaveFilter')?.value || 'all';
    const filterTech  = document.getElementById('att_leaveTechFilter')?.value || 'all';
    if (!listEl) return;

    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading…</p>';

    try {
        let query = db.collection('Staff_Leave').orderBy('startDate', 'desc').limit(100);
        const snap = await query.get();

        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));

        // Client-side filter
        if (filterStatus !== 'all') docs = docs.filter(d => d.status === filterStatus);
        if (filterTech !== 'all')   docs = docs.filter(d => d.techEmail === filterTech);

        if (!docs.length) {
            listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No leave requests found.</p>';
            return;
        }

        const statusColors = { Approved: 'var(--success)', Pending: 'var(--accent)', Rejected: 'var(--error)' };

        listEl.innerHTML = docs.map(d => {
            const days    = att_daysBetween(d.startDate, d.endDate);
            const color   = statusColors[d.status] || '#999';
            const actions = d.status === 'Pending' ? `
                <button onclick="att_updateLeaveStatus('${d.id}','Approved')"
                    style="background:var(--success); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold;">Approve</button>
                <button onclick="att_updateLeaveStatus('${d.id}','Rejected')"
                    style="background:var(--error); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold; margin-left:6px;">Reject</button>` : '';

            const deleteBtn = `<button onclick="att_deleteLeave('${d.id}')"
                style="background:transparent; border:1px solid #ccc; color:#999; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.78rem; margin-left:6px;">Delete</button>`;

            return `<div style="border:1px solid var(--border); border-radius:6px; padding:14px 16px; margin-bottom:10px; background:white;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
                    <div>
                        <strong style="color:var(--primary); font-size:0.95rem;">${d.techName || d.techEmail}</strong>
                        <span style="margin-left:8px; background:${color}22; color:${color}; border:1px solid ${color}44; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:10px; text-transform:uppercase;">${d.status}</span>
                        <span style="margin-left:6px; background:#f1f1f1; color:#555; font-size:0.72rem; padding:2px 8px; border-radius:10px;">${d.type}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#666; text-align:right;">
                        ${att_fmtDate(d.startDate)} – ${att_fmtDate(d.endDate)}
                        <span style="margin-left:6px; font-weight:700; color:var(--primary);">(${days} day${days !== 1 ? 's' : ''})</span>
                    </div>
                </div>
                ${d.note ? `<p style="margin-top:6px; font-size:0.82rem; color:#666; font-style:italic;">${d.note}</p>` : ''}
                <div style="margin-top:10px; display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                    ${actions}${deleteBtn}
                    ${d.approvedBy ? `<span style="margin-left:auto; font-size:0.75rem; color:#999;">Approved by ${d.approvedBy}</span>` : ''}
                </div>
            </div>`;
        }).join('');

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error: ${e.message}</p>`;
    }
};

window.att_updateLeaveStatus = async function(id, status) {
    try {
        await db.collection('Staff_Leave').doc(id).update({
            status,
            approvedBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
        });
        att_loadLeaveRequests();
    } catch (e) { alert('Error updating status: ' + e.message); }
};

window.att_deleteLeave = async function(id) {
    if (!confirm('Delete this leave request?')) return;
    try {
        await db.collection('Staff_Leave').doc(id).delete();
        att_loadLeaveRequests();
    } catch (e) { alert('Error deleting: ' + e.message); }
};


// ============================================================
//  LEAVE BALANCES  (4d)
// ============================================================
function att_initBalances() {
    // Populate year selector
    const yearEl = document.getElementById('att_balYear');
    if (yearEl && !yearEl.options.length) {
        const thisYear = new Date().getFullYear();
        for (let y = thisYear; y >= thisYear - 3; y--) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            yearEl.appendChild(opt);
        }
    }
    att_loadBalances();
    att_loadEntitlements();
}

window.att_loadBalances = async function() {
    const year   = document.getElementById('att_balYear')?.value || new Date().getFullYear();
    const listEl = document.getElementById('att_balancesList');
    if (!listEl) return;

    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading…</p>';

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) { listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No staff found.</p>'; return; }

    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    try {
        // Single where clause only — filter year client-side to avoid composite index
        const snap = await db.collection('Staff_Leave')
            .where('status', '==', 'Approved')
            .get();

        let docs = [];
        snap.forEach(d => docs.push(d.data()));
        // Filter to selected year client-side
        docs = docs.filter(d => d.startDate >= yearStart && d.startDate <= yearEnd);

        // Tally days per tech per type
        const tally = {};
        docs.forEach(l => {
            if (!tally[l.techEmail]) tally[l.techEmail] = {};
            const days = att_daysBetween(l.startDate, l.endDate);
            tally[l.techEmail][l.type] = (tally[l.techEmail][l.type] || 0) + days;
        });

        // Fetch entitlements
        const entSnap = await db.collection('Staff_Leave_Balances').get();
        const entitlements = {};
        entSnap.forEach(d => {
            const data = d.data();
            entitlements[d.id] = data[year] || data.annualLeave || 14; // default 14 days
        });

        const leaveTypes = ['Annual Leave', 'Day Off', 'Wellness Day', 'Sick Leave', 'Leave Without Pay', 'Public Holiday'];

        let html = `<table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
            <thead><tr style="background:#f1f1f1;">
                <th style="padding:10px; text-align:left; color:var(--primary);">Staff Member</th>
                ${leaveTypes.map(t => `<th style="padding:10px; text-align:center; color:var(--primary);">${t}</th>`).join('')}
                <th style="padding:10px; text-align:center; color:var(--primary);">Annual Entitlement</th>
                <th style="padding:10px; text-align:center; color:var(--primary);">Balance Remaining</th>
            </tr></thead><tbody>`;

        techs.forEach(t => {
            const usage    = tally[t.email] || {};
            const entitled = entitlements[t.email] || 14;
            const annualUsed = usage['Annual Leave'] || 0;
            const remaining  = entitled - annualUsed;
            const remColor   = remaining < 0 ? 'var(--error)' : remaining <= 3 ? 'var(--accent)' : 'var(--success)';

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px; font-weight:600; color:var(--primary);">${t.name || t.email}</td>
                ${leaveTypes.map(lt => `<td style="padding:10px; text-align:center; color:#555;">${usage[lt] || 0}</td>`).join('')}
                <td style="padding:10px; text-align:center; font-weight:700; color:var(--primary);">${entitled}</td>
                <td style="padding:10px; text-align:center; font-weight:700; color:${remColor};">${remaining}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error: ${e.message}</p>`;
    }
};

async function att_loadEntitlements() {
    const listEl = document.getElementById('att_entitlementsList');
    if (!listEl) return;

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) return;

    const year = new Date().getFullYear();

    try {
        const snap = await db.collection('Staff_Leave_Balances').get();
        const existing = {};
        snap.forEach(d => { existing[d.id] = d.data(); });

        listEl.innerHTML = `<div class="grid-3">` + techs.map(t => {
            const data    = existing[t.email] || {};
            const current = data[year] || data.annualLeave || 14;
            return `<div style="background:#f9f9f9; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
                <p style="font-weight:700; color:var(--primary); margin-bottom:8px; font-size:0.88rem;">${t.name || t.email}</p>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" id="ent_${t.email.replace('@','_').replace('.','_')}"
                        value="${current}" min="0" max="365"
                        style="width:70px; padding:6px; border:1px solid var(--border); border-radius:4px; font-size:0.9rem; text-align:center;">
                    <span style="font-size:0.8rem; color:#666;">days / year</span>
                    <button onclick="att_saveEntitlement('${t.email}')"
                        style="background:var(--manager); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.78rem; font-weight:bold; margin-left:auto;">Save</button>
                </div>
            </div>`;
        }).join('') + `</div>`;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error);">Error: ${e.message}</p>`;
    }
}

window.att_saveEntitlement = async function(email) {
    const safeId = email.replace('@','_').replace('.','_');
    const val    = parseInt(document.getElementById(`ent_${safeId}`)?.value || 14);
    const year   = new Date().getFullYear();
    try {
        await db.collection('Staff_Leave_Balances').doc(email).set(
            { [year]: val, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );
        // Brief visual confirmation
        const btn = document.querySelector(`button[onclick="att_saveEntitlement('${email}')"]`);
        if (btn) { btn.textContent = '✓'; btn.style.background = 'var(--success)'; setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1500); }
    } catch (e) { alert('Error: ' + e.message); }
};


// ============================================================
//  UTILITIES
// ============================================================
function att_todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function att_fmt12(timeStr) {
    if (!timeStr) return '—';
    const [h, m] = timeStr.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function att_fmtDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch(e) { return dateStr; }
}

function att_daysBetween(start, end) {
    try {
        const ms = new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00');
        return Math.max(1, Math.round(ms / 86400000) + 1);
    } catch(e) { return 1; }
}

function att_chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

console.log('Thuraya Attendance Module 4c+4d loaded.');
