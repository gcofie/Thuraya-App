// ============================================================
// THURAYA COMMISSIONS — PHASE 1 RULE SETUP
// Version: commissions-phase1-rules-20260425
// Adds a Commissions tab and Commission_Rules CRUD.
// Does NOT change booking, billing, checkout, or reports logic.
// ============================================================
console.log("✅ Commissions Phase 1 loaded: rules setup");

(function () {
    let editingRuleId = null;
    let unsubscribeRules = null;

    function safe(v) {
        return String(v ?? "").replace(/[&<>"']/g, s => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[s]));
    }

    function num(v) {
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }

    function roleText(roleKey, customName) {
        if (roleKey === "tech") return "Technician";
        if (roleKey === "foh") return "Front of House";
        if (roleKey === "manager") return "Manager";
        return customName || "Custom Role";
    }

    function injectCommissionStyles() {
        if (document.getElementById("comPhase1Styles")) return;

        const st = document.createElement("style");
        st.id = "comPhase1Styles";
        st.textContent = `
            .com-shell {
                max-width: 1200px;
                margin: 24px auto;
            }

            .com-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
                flex-wrap: wrap;
                margin-bottom: 16px;
            }

            .com-title-block h2 {
                margin: 0;
                color: var(--primary);
                letter-spacing: 0.02em;
            }

            .com-title-block p {
                margin: 6px 0 0;
                color: #666;
                font-size: 0.9rem;
            }

            .com-pill {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                border: 1px solid var(--border);
                background: #fff;
                color: var(--primary);
                border-radius: 999px;
                padding: 8px 12px;
                font-size: 0.78rem;
                font-weight: 800;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }

            .com-grid {
                display: grid;
                grid-template-columns: 390px minmax(0, 1fr);
                gap: 16px;
                align-items: start;
            }

            .com-card {
                background: #fff;
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 18px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.04);
            }

            .com-card h3 {
                margin-top: 0;
                color: var(--primary);
                border-bottom: 1px solid var(--border);
                padding-bottom: 10px;
            }

            .com-form-row {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
            }

            .com-actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid var(--border);
            }

            .com-btn {
                width: auto;
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 10px 14px;
                font-size: 0.78rem;
                font-weight: 900;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                cursor: pointer;
                background: #fff;
                color: var(--primary);
                transition: all 0.16s ease;
            }

            .com-btn:hover {
                transform: translateY(-1px);
                border-color: var(--accent);
                box-shadow: 0 5px 14px rgba(0,0,0,0.08);
            }

            .com-btn.primary {
                background: var(--primary);
                border-color: var(--primary);
                color: #fff;
            }

            .com-btn.danger {
                color: var(--error);
                border-color: rgba(180, 60, 60, 0.35);
            }

            .com-btn.muted {
                background: #f8f9fb;
            }

            .com-table-wrap {
                overflow-x: auto;
            }

            .com-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.84rem;
                background: #fff;
            }

            .com-table th {
                background: #f3f4f6;
                color: var(--primary);
                text-align: left;
                padding: 10px;
                border: 1px solid #ddd;
                white-space: nowrap;
                font-size: 0.76rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .com-table td {
                padding: 10px;
                border: 1px solid #eee;
                vertical-align: top;
            }

            .com-badge {
                display: inline-flex;
                align-items: center;
                border-radius: 999px;
                padding: 4px 9px;
                font-size: 0.72rem;
                font-weight: 800;
                background: #f3f4f6;
                color: var(--primary);
                white-space: nowrap;
            }

            .com-badge.active {
                background: rgba(30, 130, 76, 0.12);
                color: var(--success);
            }

            .com-badge.inactive {
                background: rgba(180, 60, 60, 0.10);
                color: var(--error);
            }

            .com-inline-actions {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            }

            .com-small-btn {
                border: 1px solid var(--border);
                background: #fff;
                border-radius: 7px;
                padding: 6px 9px;
                cursor: pointer;
                font-size: 0.74rem;
                font-weight: 800;
                color: var(--primary);
            }

            .com-small-btn:hover {
                border-color: var(--accent);
            }

            .com-note {
                color: #666;
                font-size: 0.82rem;
                line-height: 1.45;
                background: #fafafa;
                border: 1px solid var(--border);
                border-left: 4px solid var(--accent);
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 14px;
            }

            @media (max-width: 960px) {
                .com-grid {
                    grid-template-columns: 1fr;
                }
            }

            @media (max-width: 620px) {
                .com-form-row {
                    grid-template-columns: 1fr;
                }

                .com-actions {
                    flex-direction: column;
                }

                .com-btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(st);
    }

    function ensureCommissionShell() {
        injectCommissionStyles();

        const topNav = document.getElementById("topNavMenu");
        if (topNav && !document.getElementById("tabCommissions")) {
            const tab = document.createElement("div");
            tab.className = "nav-tab";
            tab.id = "tabCommissions";
            tab.style.display = "none";
            tab.innerHTML = `
                <input type="radio" name="main_nav" id="nav_commissions" value="commissionsView" onchange="switchModule(this.value)">
                <label for="nav_commissions">💰 Commissions</label>
            `;

            const reportsTab = document.getElementById("tabReports");
            if (reportsTab && reportsTab.parentNode) {
                reportsTab.parentNode.insertBefore(tab, reportsTab);
            } else {
                topNav.appendChild(tab);
            }
        }

        const dashboard = document.getElementById("appDashboard");
        if (dashboard && !document.getElementById("commissionsView")) {
            const view = document.createElement("div");
            view.id = "commissionsView";
            view.className = "app-module";
            view.style.display = "none";
            dashboard.appendChild(view);
        }
    }

    async function updateCommissionsTabVisibility(user) {
        ensureCommissionShell();

        const tab = document.getElementById("tabCommissions");
        if (!tab) return;

        if (!user || !db) {
            tab.style.display = "none";
            return;
        }

        try {
            const doc = await db.collection("Users").doc(user.email.toLowerCase()).get();
            const d = doc.exists ? (doc.data() || {}) : {};
            const roles = (Array.isArray(d.roles) ? d.roles : [d.role || ""])
                .map(r => String(r).toLowerCase());

            const canManage =
                roles.some(r => r.includes("admin")) ||
                roles.some(r => r.includes("manager"));

            tab.style.display = canManage ? "flex" : "none";
        } catch (e) {
            console.warn("Could not evaluate commission tab access", e);
            tab.style.display = "none";
        }
    }

    function renderShell() {
        const root = document.getElementById("commissionsView");
        if (!root) return;

        root.innerHTML = `
            <div class="com-shell">
                <div class="com-header">
                    <div class="com-title-block">
                        <h2>💰 Commission Rules</h2>
                        <p>Phase 1 setup: define editable commission rules for technicians, FOH, managers, and future roles.</p>
                    </div>
                    <div class="com-pill">Phase 1 · Rules Only</div>
                </div>

                <div class="com-note">
                    This page only manages <strong>Commission_Rules</strong>. It does not calculate or post commissions yet.
                    Phase 2 will read closed jobs and apply the active rules safely.
                </div>

                <div class="com-grid">
                    <div class="com-card">
                        <h3 id="comFormTitle">Add Commission Rule</h3>

                        <input type="hidden" id="com_ruleId">

                        <div class="form-group">
                            <label>Role</label>
                            <select id="com_roleKey" onchange="com_onRoleChange()">
                                <option value="tech">Technician</option>
                                <option value="foh">Front of House</option>
                                <option value="manager">Manager</option>
                                <option value="custom">Custom / Future Role</option>
                            </select>
                        </div>

                        <div class="form-group" id="com_customRoleBox" style="display:none;">
                            <label>Custom Role Name</label>
                            <input type="text" id="com_customRoleName" placeholder="e.g. Senior Tech, Supervisor, Retail Lead">
                        </div>

                        <div class="com-form-row">
                            <div class="form-group">
                                <label>Commission Type</label>
                                <select id="com_commissionType" onchange="com_onTypeChange()">
                                    <option value="percentage">Percentage</option>
                                    <option value="fixed">Fixed Amount</option>
                                    <option value="hybrid">Percentage + Fixed</option>
                                    <option value="tiered">Tiered / Future</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Applies To</label>
                                <select id="com_appliesTo">
                                    <option value="serviceRevenue">Service Revenue</option>
                                    <option value="totalBill">Total Bill</option>
                                    <option value="upsells">Upsells / Add-ons</option>
                                    <option value="closedJobs">Closed Jobs Count</option>
                                </select>
                            </div>
                        </div>

                        <div class="com-form-row">
                            <div class="form-group">
                                <label>Percentage (%)</label>
                                <input type="number" id="com_percentage" min="0" step="0.01" placeholder="e.g. 10">
                            </div>

                            <div class="form-group">
                                <label>Fixed Amount (GHC)</label>
                                <input type="number" id="com_fixedAmount" min="0" step="0.01" placeholder="e.g. 5">
                            </div>
                        </div>

                        <div class="com-form-row">
                            <div class="form-group">
                                <label>Minimum Revenue (optional)</label>
                                <input type="number" id="com_minRevenue" min="0" step="0.01" placeholder="0">
                            </div>

                            <div class="form-group">
                                <label>Priority</label>
                                <input type="number" id="com_priority" min="1" step="1" value="1">
                            </div>
                        </div>

                        <div class="form-group" id="com_tierBox" style="display:none;">
                            <label>Tier Notes / Future Tier JSON</label>
                            <textarea id="com_tierNotes" rows="3" placeholder="Example: 0-1000 = 5%, 1001-3000 = 8%, 3000+ = 10%"></textarea>
                        </div>

                        <div class="form-group">
                            <label>Notes</label>
                            <textarea id="com_notes" rows="3" placeholder="Internal note for this commission rule"></textarea>
                        </div>

                        <label style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--primary);margin-top:8px;">
                            <input type="checkbox" id="com_active" checked style="width:18px;height:18px;accent-color:var(--primary);">
                            Active rule
                        </label>

                        <div class="com-actions">
                            <button class="com-btn primary" onclick="com_saveRule()">Save Rule</button>
                            <button class="com-btn muted" onclick="com_resetForm()">Clear</button>
                            <button class="com-btn" onclick="com_seedStarterRules()">Create Starter Rules</button>
                        </div>
                    </div>

                    <div class="com-card">
                        <h3>Commission Rules Library</h3>
                        <div id="com_rulesList">
                            <p style="color:#777;">Loading commission rules...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        attachRulesListener();
        onRoleChange();
        onTypeChange();
    }

    function onRoleChange() {
        const role = document.getElementById("com_roleKey")?.value || "tech";
        const box = document.getElementById("com_customRoleBox");
        if (box) box.style.display = role === "custom" ? "block" : "none";
    }

    function onTypeChange() {
        const type = document.getElementById("com_commissionType")?.value || "percentage";
        const tierBox = document.getElementById("com_tierBox");
        const pct = document.getElementById("com_percentage");
        const fixed = document.getElementById("com_fixedAmount");

        if (tierBox) tierBox.style.display = type === "tiered" ? "block" : "none";

        if (pct) pct.disabled = type === "fixed";
        if (fixed) fixed.disabled = type === "percentage" || type === "tiered";
    }

    function resetForm() {
        editingRuleId = null;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        set("com_ruleId", "");
        set("com_roleKey", "tech");
        set("com_customRoleName", "");
        set("com_commissionType", "percentage");
        set("com_appliesTo", "serviceRevenue");
        set("com_percentage", "");
        set("com_fixedAmount", "");
        set("com_minRevenue", "");
        set("com_priority", "1");
        set("com_tierNotes", "");
        set("com_notes", "");

        const active = document.getElementById("com_active");
        if (active) active.checked = true;

        const title = document.getElementById("comFormTitle");
        if (title) title.textContent = "Add Commission Rule";

        onRoleChange();
        onTypeChange();
    }

    async function saveRule() {
        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Please sign in again.");
            return;
        }

        const roleKey = document.getElementById("com_roleKey")?.value || "tech";
        const customRoleName = (document.getElementById("com_customRoleName")?.value || "").trim();
        const commissionType = document.getElementById("com_commissionType")?.value || "percentage";
        const appliesTo = document.getElementById("com_appliesTo")?.value || "serviceRevenue";

        if (roleKey === "custom" && !customRoleName) {
            alert("Please enter the custom role name.");
            return;
        }

        const percentage = num(document.getElementById("com_percentage")?.value);
        const fixedAmount = num(document.getElementById("com_fixedAmount")?.value);

        if ((commissionType === "percentage" || commissionType === "hybrid") && percentage <= 0) {
            alert("Please enter a percentage greater than 0.");
            return;
        }

        if ((commissionType === "fixed" || commissionType === "hybrid") && fixedAmount <= 0) {
            alert("Please enter a fixed amount greater than 0.");
            return;
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        const payload = {
            roleKey,
            roleName: roleText(roleKey, customRoleName),
            customRoleName,
            commissionType,
            appliesTo,
            percentage,
            fixedAmount,
            minRevenue: num(document.getElementById("com_minRevenue")?.value),
            priority: Number(document.getElementById("com_priority")?.value || 1),
            tierNotes: document.getElementById("com_tierNotes")?.value || "",
            notes: document.getElementById("com_notes")?.value || "",
            active: document.getElementById("com_active")?.checked === true,
            updatedAt: now,
            updatedBy: user.email || ""
        };

        try {
            if (editingRuleId) {
                await db.collection("Commission_Rules").doc(editingRuleId).set(payload, { merge: true });
                alert("Commission rule updated.");
            } else {
                payload.createdAt = now;
                payload.createdBy = user.email || "";
                await db.collection("Commission_Rules").add(payload);
                alert("Commission rule created.");
            }
            resetForm();
        } catch (e) {
            console.error("Commission rule save failed", e);
            alert("Could not save commission rule: " + e.message);
        }
    }

    async function editRule(id) {
        try {
            const doc = await db.collection("Commission_Rules").doc(id).get();
            if (!doc.exists) {
                alert("Rule not found.");
                return;
            }

            const r = doc.data() || {};
            editingRuleId = id;

            const set = (field, val) => { const el = document.getElementById(field); if (el) el.value = val ?? ""; };
            set("com_ruleId", id);
            set("com_roleKey", r.roleKey || "tech");
            set("com_customRoleName", r.customRoleName || "");
            set("com_commissionType", r.commissionType || "percentage");
            set("com_appliesTo", r.appliesTo || "serviceRevenue");
            set("com_percentage", r.percentage || "");
            set("com_fixedAmount", r.fixedAmount || "");
            set("com_minRevenue", r.minRevenue || "");
            set("com_priority", r.priority || 1);
            set("com_tierNotes", r.tierNotes || "");
            set("com_notes", r.notes || "");

            const active = document.getElementById("com_active");
            if (active) active.checked = r.active !== false;

            const title = document.getElementById("comFormTitle");
            if (title) title.textContent = "Edit Commission Rule";

            onRoleChange();
            onTypeChange();
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) {
            console.error("Commission edit failed", e);
            alert("Could not load rule: " + e.message);
        }
    }

    async function deleteRule(id) {
        if (!confirm("Delete this commission rule?")) return;

        try {
            await db.collection("Commission_Rules").doc(id).delete();
        } catch (e) {
            console.error("Commission delete failed", e);
            alert("Could not delete rule: " + e.message);
        }
    }

    async function toggleRule(id, active) {
        try {
            await db.collection("Commission_Rules").doc(id).set({
                active: active,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: firebase.auth().currentUser?.email || ""
            }, { merge: true });
        } catch (e) {
            console.error("Commission toggle failed", e);
            alert("Could not update rule: " + e.message);
        }
    }

    async function seedStarterRules() {
        if (!confirm("Create starter rules for Technician, FOH, and Manager?")) return;

        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Please sign in again.");
            return;
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        const starterRules = [
            {
                roleKey: "tech",
                roleName: "Technician",
                commissionType: "percentage",
                appliesTo: "serviceRevenue",
                percentage: 10,
                fixedAmount: 0,
                minRevenue: 0,
                priority: 1,
                active: true,
                notes: "Starter technician rule. Edit percentage as needed."
            },
            {
                roleKey: "foh",
                roleName: "Front of House",
                commissionType: "percentage",
                appliesTo: "totalBill",
                percentage: 2,
                fixedAmount: 0,
                minRevenue: 0,
                priority: 1,
                active: true,
                notes: "Starter FOH rule. Edit percentage as needed."
            },
            {
                roleKey: "manager",
                roleName: "Manager",
                commissionType: "percentage",
                appliesTo: "totalBill",
                percentage: 3,
                fixedAmount: 0,
                minRevenue: 0,
                priority: 1,
                active: true,
                notes: "Starter manager rule. Edit percentage as needed."
            }
        ];

        try {
            const batch = db.batch();
            starterRules.forEach(rule => {
                const ref = db.collection("Commission_Rules").doc();
                batch.set(ref, {
                    ...rule,
                    customRoleName: "",
                    tierNotes: "",
                    createdAt: now,
                    updatedAt: now,
                    createdBy: user.email || "",
                    updatedBy: user.email || ""
                });
            });
            await batch.commit();
            alert("Starter commission rules created.");
        } catch (e) {
            console.error("Starter rules failed", e);
            alert("Could not create starter rules: " + e.message);
        }
    }

    function attachRulesListener() {
        const list = document.getElementById("com_rulesList");
        if (!list || unsubscribeRules) return;

        unsubscribeRules = db.collection("Commission_Rules")
            .onSnapshot(snap => {
                const rows = [];
                snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));

                rows.sort((a, b) =>
                    String(a.roleName || "").localeCompare(String(b.roleName || "")) ||
                    Number(a.priority || 1) - Number(b.priority || 1)
                );

                renderRules(rows);
            }, err => {
                console.error("Commission rules listener failed", err);
                list.innerHTML = `
                    <div class="com-note" style="border-left-color:var(--error);">
                        Could not load Commission_Rules. Check Firestore security rules.<br>
                        <strong>${safe(err.message)}</strong>
                    </div>
                `;
            });
    }

    function renderRules(rows) {
        const list = document.getElementById("com_rulesList");
        if (!list) return;

        if (!rows.length) {
            list.innerHTML = `
                <div class="com-note">
                    No commission rules yet. Use the form to add one, or click <strong>Create Starter Rules</strong>.
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="com-table-wrap">
                <table class="com-table">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Role</th>
                            <th>Type</th>
                            <th>Applies To</th>
                            <th>Rate</th>
                            <th>Priority</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            const rateText =
                                r.commissionType === "percentage" ? `${num(r.percentage)}%` :
                                r.commissionType === "fixed" ? `${num(r.fixedAmount).toFixed(2)} GHC` :
                                r.commissionType === "hybrid" ? `${num(r.percentage)}% + ${num(r.fixedAmount).toFixed(2)} GHC` :
                                "Tiered";

                            return `
                                <tr>
                                    <td>
                                        <span class="com-badge ${r.active === false ? "inactive" : "active"}">
                                            ${r.active === false ? "Inactive" : "Active"}
                                        </span>
                                    </td>
                                    <td>
                                        <strong>${safe(r.roleName || roleText(r.roleKey, r.customRoleName))}</strong>
                                        ${r.notes ? `<div style="font-size:0.76rem;color:#777;margin-top:4px;">${safe(r.notes)}</div>` : ""}
                                    </td>
                                    <td>${safe(r.commissionType || "")}</td>
                                    <td>${safe(r.appliesTo || "")}</td>
                                    <td><strong>${safe(rateText)}</strong></td>
                                    <td>${safe(r.priority || 1)}</td>
                                    <td>
                                        <div class="com-inline-actions">
                                            <button class="com-small-btn" onclick="com_editRule('${r.id}')">Edit</button>
                                            <button class="com-small-btn" onclick="com_toggleRule('${r.id}', ${r.active === false ? "true" : "false"})">
                                                ${r.active === false ? "Activate" : "Disable"}
                                            </button>
                                            <button class="com-small-btn" style="color:var(--error);" onclick="com_deleteRule('${r.id}')">Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function init() {
        ensureCommissionShell();
        renderShell();
    }

    function patchSwitchModule() {
        if (window.__comSwitchPatched) return;
        if (typeof window.switchModule !== "function") return;

        const originalSwitchModule = window.switchModule;
        window.switchModule = function(moduleId) {
            originalSwitchModule(moduleId);
            if (moduleId === "commissionsView") {
                setTimeout(init, 50);
            }
        };

        window.__comSwitchPatched = true;
    }

    function boot() {
        ensureCommissionShell();
        patchSwitchModule();

        if (firebase?.auth) {
            firebase.auth().onAuthStateChanged(user => {
                setTimeout(() => updateCommissionsTabVisibility(user), 900);
            });
        }
    }

    window.com_init = init;
    window.com_onRoleChange = onRoleChange;
    window.com_onTypeChange = onTypeChange;
    window.com_saveRule = saveRule;
    window.com_resetForm = resetForm;
    window.com_editRule = editRule;
    window.com_deleteRule = deleteRule;
    window.com_toggleRule = toggleRule;
    window.com_seedStarterRules = seedStarterRules;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
