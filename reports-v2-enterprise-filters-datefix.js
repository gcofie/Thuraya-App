
// ============================================================
// THURAYA REPORTS V2 — CLEAN REWRITE
// Version: reports-v2-rewrite-20260425
// Separate module. Does not modify booking/billing/attendance logic.
// Uses simple date-range queries to avoid Firestore composite indexes.
// ============================================================
console.log("✅ Reports V2 loaded: reports-v2-enterprise-filters-datefix-20260425");

(function () {
    const RPT = {
        activeTab: "upcoming",
        rows: [],
        techsLoaded: false
    };

    function todayStr() {
        if (typeof todayDateStr !== "undefined" && todayDateStr) return todayDateStr;
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    function addDays(dateStr, days) {
        const d = new Date(dateStr + "T12:00:00");
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    function monthStart(dateStr) {
        const d = new Date(dateStr + "T12:00:00");
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
    }

    function monthEnd(dateStr) {
        const d = new Date(dateStr + "T12:00:00");
        return new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
    }

    function num(v) {
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }

    function money(v) {
        return num(v).toFixed(2);
    }

    function safe(v) {
        return String(v ?? "").replace(/[&<>"']/g, s => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[s]));
    }

    function isGroup(row) {
        return row?.isGroupBooking === true || !!row?.groupId;
    }

    function isLead(row) {
        return row?.isLeadBooker === true ||
               row?.groupRole === "lead" ||
               row?.payableBy === "lead_booker" ||
               row?.payableBy === "lead_booker_final_bill";
    }

    function revenue(row) {
        return num(
            row.groupCheckoutAmount ||
            row.amountDue ||
            row.totalGHC ||
            row.grandTotal ||
            row.bookedPrice ||
            0
        );
    }

    function billingMode(row) {
        return row.billingMode || row.groupCheckoutType || row.billingScenario || "";
    }

    function revenueKey(row) {
        const mode = billingMode(row);
        const gid = row.groupId || "";
        const sg = row.subGroupIndex || 1;

        if (!isGroup(row)) return `solo:${row._source}:${row.id}`;

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) {
            return `group:${gid}:lead-final`;
        }

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            return `group:${gid}:subgroup:${sg}`;
        }

        return `group:${gid}:member:${row.id}`;
    }

    function shouldCountRevenue(row, seen) {
        if (!isGroup(row)) return true;

        const mode = billingMode(row);
        const key = revenueKey(row);

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) {
            if (seen.has(key)) return false;
            if (!(isLead(row) || row.groupCheckoutAmount || row.groupCheckoutType)) return false;
            seen.add(key);
            return true;
        }

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }

        return true;
    }

    function computedRevenue(rows) {
        const seen = new Set();
        return rows.reduce((sum, r) => shouldCountRevenue(r, seen) ? sum + revenue(r) : sum, 0);
    }

    function avgSpend(rows) {
        const count = rows.length || 1;
        return computedRevenue(rows) / count;
    }

    function statusCounts(rows) {
        const out = {};
        rows.forEach(r => {
            const s = r.status || "Unknown";
            out[s] = (out[s] || 0) + 1;
        });
        return out;
    }

    function normalizeDateValue(v) {
        if (!v) return "";

        // Firestore Timestamp support
        if (typeof v.toDate === "function") {
            const d = v.toDate();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }

        const raw = String(v).trim();
        if (!raw) return "";

        // Already ISO yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

        // Browser date input / display format mm/dd/yyyy
        const md = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (md) return `${md[3]}-${String(md[1]).padStart(2,"0")}-${String(md[2]).padStart(2,"0")}`;

        // Last safe attempt
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }

        return raw;
    }

    function rowDateString(d) {
        return normalizeDateValue(
            d.dateString ||
            d.date ||
            d.bookingDate ||
            d.appointmentDate ||
            d.selectedDate ||
            d.serviceDate ||
            d.createdDate ||
            ""
        );
    }

    async function fetchDateRange(collection, start, end) {
        const startIso = normalizeDateValue(start);
        const endIso = normalizeDateValue(end);

        // First try the efficient query used by Reports V2.
        // If a collection has dateString, this avoids index issues and stays fast.
        try {
            const snap = await db.collection(collection)
                .where("dateString", ">=", startIso)
                .where("dateString", "<=", endIso)
                .get();

            const rows = [];
            snap.forEach(doc => {
                const d = doc.data() || {};
                const ds = rowDateString(d);
                rows.push({ id: doc.id, _source: collection, ...d, dateString: ds || d.dateString || "" });
            });

            if (rows.length) return rows;
        } catch(e) {
            console.warn(`Reports V2 dateString query failed for ${collection}; using safe fallback`, e);
        }

        // Safe fallback: read collection and filter locally.
        // This fixes cases where Upcoming Schedule stores the date under a different field.
        const snap = await db.collection(collection).get();
        const rows = [];

        snap.forEach(doc => {
            const d = doc.data() || {};
            const ds = rowDateString(d);
            if (ds && ds >= startIso && ds <= endIso) {
                rows.push({ id: doc.id, _source: collection, ...d, dateString: ds });
            }
        });

        return rows;
    }

    function filterRows(rows) {
        const tech = document.getElementById("rptv2_tech")?.value || "all";
        const status = document.getElementById("rptv2_status")?.value || "all";
        const group = document.getElementById("rptv2_group")?.value || "all";

        return rows.filter(r => {
            if (tech !== "all" && r.assignedTechEmail !== tech) return false;
            if (status !== "all" && String(r.status || "").trim().toLowerCase() !== String(status).trim().toLowerCase()) return false;
            if (group === "groups" && !isGroup(r)) return false;
            if (group === "solo" && isGroup(r)) return false;
            return true;
        });
    }

    function currentRange() {
        const start = document.getElementById("rptv2_start")?.value || todayStr();
        const end = document.getElementById("rptv2_end")?.value || start;
        return { start, end };
    }

    function setRange(type) {
        const today = todayStr();
        const start = document.getElementById("rptv2_start");
        const end = document.getElementById("rptv2_end");
        if (!start || !end) return;

        if (type === "today") {
            start.value = today;
            end.value = today;
        } else if (type === "week") {
            start.value = today;
            end.value = addDays(today, 6);
        } else if (type === "month") {
            start.value = monthStart(today);
            end.value = monthEnd(today);
        }
    }

    function setRangeUI(type) {
        setRange(type);
        document.querySelectorAll(".rptv2-range-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.range === type);
        });
    }

    function setDefaultFiltersForTab() {
        const status = document.getElementById("rptv2_status");
        const group = document.getElementById("rptv2_group");

        if (status) {
            // Upcoming is the only tab where Scheduled makes sense by default.
            // All other report tabs use Active_Jobs or Attendance, so Scheduled often returns no rows.
            status.value = RPT.activeTab === "upcoming" ? "Scheduled" : "all";
        }

        if (group) group.value = "all";
    }

    async function ensureTechOptions() {
        const sel = document.getElementById("rptv2_tech");
        if (!sel) return;

        const current = sel.value || "all";
        let techs = Array.isArray(window.allTechs || allTechs) ? (window.allTechs || allTechs) : [];

        if (!techs.length) {
            try {
                const snap = await db.collection("Users").get();
                techs = [];
                snap.forEach(doc => {
                    const d = doc.data() || {};
                    const roles = (Array.isArray(d.roles) ? d.roles : [d.role || ""]).map(r => String(r).toLowerCase());
                    if (roles.some(r => r.includes("tech"))) {
                        techs.push({ email: doc.id, name: d.name || doc.id });
                    }
                });
            } catch(e) {
                console.warn("Could not load techs for reports", e);
            }
        }

        sel.innerHTML = `<option value="all">All Technicians</option>` +
            techs.map(t => `<option value="${safe(t.email)}">${safe(t.name || t.email)}</option>`).join("");

        sel.value = current;
    }


    function injectReportStyles() {
        if (document.getElementById("rptv2MenuStyles")) return;
        const st = document.createElement("style");
        st.id = "rptv2MenuStyles";
        st.textContent = `
            .rptv2-menu-grid {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 14px;
                margin: 20px 0;
            }

            .rptv2-menu-card {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                width: 100%;
                text-align: left;
                background: #fff;
                border: 1px solid var(--border);
                border-radius: 10px;
                padding: 16px;
                cursor: pointer;
                transition: all 0.18s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                color: var(--primary);
            }

            .rptv2-menu-card:hover {
                transform: translateY(-1px);
                border-color: var(--accent);
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
            }

            .rptv2-menu-card.active {
                background: var(--primary);
                border-color: var(--primary);
                color: #fff;
                box-shadow: 0 8px 22px rgba(47, 59, 79, 0.22);
            }

            .rptv2-menu-icon {
                width: 42px;
                height: 42px;
                border-radius: 12px;
                background: rgba(201,168,76,0.12);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.35rem;
                flex-shrink: 0;
            }

            .rptv2-menu-card.active .rptv2-menu-icon {
                background: rgba(255,255,255,0.16);
            }

            .rptv2-menu-copy {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .rptv2-menu-copy strong {
                font-size: 0.95rem;
                letter-spacing: 0.02em;
            }

            .rptv2-menu-copy span {
                font-size: 0.78rem;
                color: #666;
                line-height: 1.35;
            }

            .rptv2-menu-card.active .rptv2-menu-copy span {
                color: rgba(255,255,255,0.82);
            }


            .rptv2-action-bar {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-start;
                margin-top: 18px;
                padding-top: 14px;
                border-top: 1px solid var(--border);
            }

            .rptv2-action-btn {
                width: auto;
                min-width: 150px;
                border-radius: 8px;
                padding: 11px 18px;
                font-size: 0.82rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                cursor: pointer;
                transition: all 0.18s ease;
            }

            .rptv2-action-btn.primary {
                background: var(--primary);
                color: #fff;
                border: 1px solid var(--primary);
                box-shadow: 0 5px 14px rgba(47,59,79,0.16);
            }

            .rptv2-action-btn.primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 8px 20px rgba(47,59,79,0.22);
            }

            .rptv2-action-btn.secondary {
                background: #fff;
                color: var(--primary);
                border: 1px solid var(--border);
            }

            .rptv2-action-btn.secondary:hover {
                border-color: var(--accent);
                color: var(--accent);
                background: #fffaf0;
            }



            .rptv2-range-group {
                display: inline-flex;
                width: 100%;
                min-height: 42px;
                border: 1px solid var(--border);
                border-radius: 10px;
                overflow: hidden;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,0.03);
            }

            .rptv2-range-btn {
                flex: 1;
                border: 0;
                border-right: 1px solid var(--border);
                background: #fff;
                color: var(--primary);
                font-size: 0.78rem;
                font-weight: 900;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                cursor: pointer;
                transition: all 0.16s ease;
            }

            .rptv2-range-btn:last-child {
                border-right: 0;
            }

            .rptv2-range-btn:hover {
                background: #f8f9fb;
            }

            .rptv2-range-btn.active {
                background: var(--primary);
                color: #fff;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
            }

            @media (max-width: 620px) {
                .rptv2-action-bar {
                    flex-direction: column;
                    align-items: stretch;
                }

                .rptv2-action-btn {
                    width: 100%;
                }
            }


            @media (max-width: 980px) {
                .rptv2-menu-grid {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }

            @media (max-width: 620px) {
                .rptv2-menu-grid {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(st);
    }

    function renderShell() {
        const reportsView = document.getElementById("reportsView");
        if (!reportsView) return;

        reportsView.innerHTML = `
            <div class="module-box" style="max-width:1200px;margin:24px auto;">
                <div class="rptv2-menu-grid">
                    ${tabButton("upcoming", "📅", "Upcoming Bookings", "Scheduled appointments and group bookings")}
                    ${tabButton("daily", "📋", "Daily Operations", "Closed jobs, pending jobs, revenue and status")}
                    ${tabButton("monthly", "📈", "Weekly / Monthly Revenue", "Revenue, group billing and trend review")}
                    ${tabButton("tech", "👷", "Tech Performance", "Jobs, minutes and revenue by technician")}
                    ${tabButton("client", "👥", "Client Intelligence", "Client visits, spend and repeat activity")}
                    ${tabButton("attendance", "🌿", "Leave & Attendance", "Attendance and lunch break records")}
                </div>

                <div class="module-box" style="background:#fafafa;border:1px solid var(--border);">
                    <div class="grid-3">
                        <div class="form-group">
                            <label>Start Date</label>
                            <input type="date" id="rptv2_start">
                        </div>
                        <div class="form-group">
                            <label>End Date</label>
                            <input type="date" id="rptv2_end">
                        </div>
                        <div class="form-group">
                            <label>Technician</label>
                            <select id="rptv2_tech"><option value="all">All Technicians</option></select>
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select id="rptv2_status">
                                <option value="all" selected>All Statuses</option>
                                <option value="Scheduled">Scheduled</option>
                                <option value="Arrived">Arrived</option>
                                <option value="Waiting">Waiting</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Ready for Payment">Ready for Payment</option>
                                <option value="Closed">Closed</option>
                                <option value="Cancelled">Cancelled</option>
                                <option value="No Show">No Show</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Booking Type</label>
                            <select id="rptv2_group">
                                <option value="all">All</option>
                                <option value="groups">Groups Only</option>
                                <option value="solo">Solo Only</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Quick Range</label>
                            <div class="rptv2-range-group">
                                <button type="button" class="rptv2-range-btn" data-range="today" onclick="rptv2_setRangeUI('today')">Today</button>
                                <button type="button" class="rptv2-range-btn" data-range="week" onclick="rptv2_setRangeUI('week')">Week</button>
                                <button type="button" class="rptv2-range-btn" data-range="month" onclick="rptv2_setRangeUI('month')">Month</button>
                            </div>
                        </div>
                    </div>

                    <div class="rptv2-action-bar">
                        <button class="rptv2-action-btn primary" onclick="rptv2_load()">Load Report</button>
                        <button class="rptv2-action-btn secondary" onclick="rptv2_exportCsv()">⬇ Export CSV</button>
                        <button class="rptv2-action-btn secondary" onclick="window.print()">🖨 Print</button>
                    </div>
                </div>

                <div id="rptv2_output" style="margin-top:18px;"></div>
            </div>
        `;

        const defaultRange = RPT.activeTab === "monthly" ? "month" : RPT.activeTab === "daily" ? "today" : "week";
        setRangeUI(defaultRange);
        setDefaultFiltersForTab();
        ensureTechOptions();
        markActiveTab();
    }

    function tabButton(key, icon, title, desc) {
        return `
            <button type="button" class="rptv2-menu-card" data-tab="${key}" onclick="rptv2_switch('${key}')">
                <div class="rptv2-menu-icon">${icon}</div>
                <div class="rptv2-menu-copy">
                    <strong>${safe(title)}</strong>
                    <span>${safe(desc)}</span>
                </div>
            </button>
        `;
    }

    function markActiveTab() {
        document.querySelectorAll(".rptv2-menu-card").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tab === RPT.activeTab);
        });
    }

    function kpiCard(label, value, color = "var(--primary)") {
        return `
            <div class="module-box" style="padding:14px;border-left:4px solid ${color};">
                <div style="font-size:0.78rem;color:#666;text-transform:uppercase;font-weight:bold;">${safe(label)}</div>
                <div style="font-size:1.45rem;font-weight:bold;color:${color};">${safe(value)}</div>
            </div>
        `;
    }

    function renderKpis(rows) {
        const groups = rows.filter(isGroup).length;
        const revenueTotal = computedRevenue(rows);
        const closed = rows.filter(r => r.status === "Closed").length;
        const avg = avgSpend(rows);

        return `
            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0;">
                ${kpiCard("Records", rows.length)}
                ${kpiCard("Revenue", `${money(revenueTotal)} GHC`, "var(--success)")}
                ${kpiCard("Group Records", groups, "var(--accent)")}
                ${kpiCard("Closed Jobs", closed, "var(--manager)")}
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px;">
                ${kpiCard("Average Spend", `${money(avg)} GHC`)}
                ${kpiCard("Solo Records", rows.length - groups)}
                ${kpiCard("Cancelled", rows.filter(r => r.status === "Cancelled").length, "var(--error)")}
                ${kpiCard("No Shows", rows.filter(r => r.status === "No Show").length, "var(--error)")}
            </div>
        `;
    }

    function renderTable(rows) {
        if (!rows.length) {
            return `<div class="module-box" style="border-left:4px solid var(--accent);">
                <h3 style="margin-top:0;color:var(--accent);">No records found</h3>
                <p style="color:#666;margin-bottom:0;">
                    Try changing Status to <strong>All Statuses</strong>, checking another date range, or confirming that today's bookings have been checked in/closed.
                </p>
            </div>`;
        }

        return `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            ${["Date","Time","Client","Phone","Tech","Status","Service","Amount","Group ID","Size","Subgroup","Billing","Lead"].map(h =>
                                `<th style="padding:8px;border:1px solid #ddd;text-align:left;">${h}</th>`
                            ).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.dateString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.timeString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.clientName || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.clientPhone || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.assignedTechName || r.assignedTechEmail || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.status || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.bookedService || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(revenue(r))}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.groupId || "-")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.groupSize || "-")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.subGroupIndex || "-")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(billingMode(r) || "-")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${isLead(r) ? "Yes" : ""}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderStatusBreakdown(rows) {
        const counts = statusCounts(rows);
        const parts = Object.keys(counts).sort().map(k => `
            <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;">
                <span>${safe(k)}</span><strong>${counts[k]}</strong>
            </div>
        `).join("");

        return `
            <div class="module-box" style="margin-top:16px;">
                <h3>Status Breakdown</h3>
                ${parts || "<p>No statuses.</p>"}
            </div>
        `;
    }

    function renderTechPerformance(rows) {
        const byTech = {};
        rows.forEach(r => {
            const key = r.assignedTechEmail || "Unassigned";
            if (!byTech[key]) byTech[key] = { name: r.assignedTechName || key, rows: [] };
            byTech[key].rows.push(r);
        });

        const techRows = Object.values(byTech).map(t => {
            const rev = computedRevenue(t.rows);
            const mins = t.rows.reduce((s,r) => s + num(r.bookedDuration || 0), 0);
            return { ...t, revenue: rev, jobs: t.rows.length, mins };
        }).sort((a,b) => b.revenue - a.revenue);

        return `
            ${renderKpis(rows)}
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Technician</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Jobs</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Service Minutes</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Revenue</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Revenue / Job</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${techRows.map(t => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(t.name)}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${t.jobs}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${t.mins}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.revenue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.revenue / Math.max(1,t.jobs))} GHC</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderClientIntelligence(rows) {
        const byClient = {};
        rows.forEach(r => {
            const key = r.clientPhone || r.clientName || r.id;
            if (!byClient[key]) byClient[key] = { name: r.clientName || "Unknown", phone: r.clientPhone || "", rows: [] };
            byClient[key].rows.push(r);
        });

        const clients = Object.values(byClient).map(c => ({
            ...c,
            visits: c.rows.length,
            revenue: computedRevenue(c.rows),
            lastVisit: c.rows.map(r => r.dateString || "").sort().pop() || ""
        })).sort((a,b) => b.revenue - a.revenue);

        return `
            ${renderKpis(rows)}
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Client</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Phone</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Visits</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Revenue</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Last Visit</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${clients.map(c => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.name)}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.phone)}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${c.visits}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(c.revenue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.lastVisit)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    async function loadAttendanceReport(start, end) {
        const snap = await db.collection("Attendance")
            .where("date", ">=", start)
            .where("date", "<=", end)
            .get();

        const rows = [];
        snap.forEach(doc => rows.push({ id: doc.id, _source: "Attendance", ...doc.data() }));
        return rows;
    }

    function renderAttendance(rows) {
        if (!rows.length) return `<p style="color:#999;font-style:italic;">No attendance records found.</p>`;

        return `
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0;">
                ${kpiCard("Attendance Records", rows.length)}
                ${kpiCard("Lunch Breaks", rows.filter(r => r.lunchStartString).length, "var(--accent)")}
                ${kpiCard("Active Lunch", rows.filter(r => r.lunchBreakActive === true).length, "var(--error)")}
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Date</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Name</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Email</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Lunch Start</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Lunch End</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.date || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.name || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.email || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.lunchStartString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.lunchEndString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${r.lunchBreakActive ? "Lunch active" : "Available / ended"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    async function load() {
        const out = document.getElementById("rptv2_output");
        if (!out) return;

        const { start, end } = currentRange();
        if (end < start) {
            out.innerHTML = `<p style="color:var(--error);">End date cannot be before start date.</p>`;
            return;
        }

        out.innerHTML = `<p style="color:#666;">Loading ${safe(RPT.activeTab)} report...</p>`;

        try {
            let rows = [];
            let html = "";

            if (RPT.activeTab === "upcoming") {
                rows = filterRows(await fetchDateRange("Appointments", start, end));
                rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
                html = renderKpis(rows) + renderTable(rows) + renderStatusBreakdown(rows);
            } else if (RPT.activeTab === "daily" || RPT.activeTab === "monthly") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));

                // If no operational jobs exist yet, fall back to Appointments so the report does not look broken.
                // This is useful early in the day before check-in/checkout creates Active_Jobs.
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }

                rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
                html = renderKpis(rows) + renderTable(rows) + renderStatusBreakdown(rows);
            } else if (RPT.activeTab === "tech") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }
                html = renderTechPerformance(rows);
            } else if (RPT.activeTab === "client") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }
                html = renderClientIntelligence(rows);
            } else if (RPT.activeTab === "attendance") {
                rows = await loadAttendanceReport(start, end);
                html = renderAttendance(rows);
            }

            RPT.rows = rows;
            out.innerHTML = html;
        } catch(e) {
            console.error("Reports V2 error:", e);
            out.innerHTML = `
                <div class="module-box" style="border-left:4px solid var(--error);">
                    <h3 style="color:var(--error);">Report Error</h3>
                    <p>${safe(e.message)}</p>
                    <p style="color:#666;font-size:0.85rem;">
                        Reports V2 uses simple date-range queries. If this still fails, check collection security rules or missing date fields.
                    </p>
                </div>
            `;
        }
    }

    function csvEscape(v) {
        const s = String(v ?? "");
        return `"${s.replace(/"/g, '""')}"`;
    }

    function exportCsv() {
        const rows = RPT.rows || [];
        if (!rows.length) {
            alert("Load a report first.");
            return;
        }

        const headers = [
            "Source","Date","Time","Client","Phone","Technician","Status","Service","Revenue",
            "Group ID","Group Size","Subgroup","Billing Mode","Payable By","Lead Booker"
        ];

        const lines = [headers.map(csvEscape).join(",")];

        rows.forEach(r => {
            lines.push([
                r._source || "",
                r.dateString || r.date || "",
                r.timeString || "",
                r.clientName || r.name || "",
                r.clientPhone || "",
                r.assignedTechName || r.assignedTechEmail || r.email || "",
                r.status || (r.lunchBreakActive ? "Lunch active" : ""),
                r.bookedService || "",
                money(revenue(r)),
                r.groupId || "",
                r.groupSize || "",
                r.subGroupIndex || "",
                billingMode(r),
                r.payableBy || "",
                isLead(r) ? "Yes" : ""
            ].map(csvEscape).join(","));
        });

        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `thuraya-reports-v2-${RPT.activeTab}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function switchTab(key) {
        RPT.activeTab = key;
        markActiveTab();
        if (key === "daily") setRangeUI("today");
        if (key === "monthly") setRangeUI("month");
        if (key === "upcoming") setRangeUI("week");
        if (key === "tech" || key === "client" || key === "attendance") setRangeUI("today");
        setDefaultFiltersForTab();
        document.getElementById("rptv2_output").innerHTML = "";
    }

    function init() {
        injectReportStyles();
        renderShell();
    }

    window.rptv2_setRange = setRange;
    window.rptv2_setRangeUI = setRangeUI;
    window.rptv2_load = load;
    window.rptv2_exportCsv = exportCsv;
    window.rptv2_switch = switchTab;

    // Replace old Reports initializer.
    window.rpt_init = init;

    // If user is already on reports when this loads.
    document.addEventListener("click", function(e) {
        const target = e.target;
        if (!target) return;
        const txt = (target.textContent || "").toLowerCase();
        if (txt.includes("reports")) {
            setTimeout(() => {
                const rv = document.getElementById("reportsView");
                if (rv && rv.style.display !== "none") init();
            }, 250);
        }
    });
})();
