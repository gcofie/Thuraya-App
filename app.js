// ============================================================
//  THURAYA SALON OS — app.js (Improved)
//  Key changes:
//  • Toast notification system replaces all alert()/confirm()
//  • setButtonLoading() helper — prevents double-submits
//  • loadStaffDirectory() unsubscribes previous listener
//  • Orphan-safe addStaffAccount() rolls back auth on DB fail
//  • liveClientSearch() deduped into one shared function
//  • getLocalDateString() called once
//  • Minor: uses CSS class toggles instead of style strings
// ============================================================

// ⚠️ PASTE YOUR GOOGLE CHAT WEBHOOK URL HERE
const GOOGLE_CHAT_WEBHOOK = "";

const firebaseConfig = {
    apiKey: "AIzaSyBTZOVjppINaVyYslRnAkC04EjJyMt40j8",
    authDomain: "thuraya-client-telling.firebaseapp.com",
    projectId: "thuraya-client-telling",
    storageBucket: "thuraya-client-telling.firebasestorage.app",
    messagingSenderId: "1061064260367",
    appId: "1:1061064260367:web:ffedb019649bcf1cbadc7a"
};

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

let secondaryApp;
try { secondaryApp = firebase.app("SecondaryApp"); }
catch (e) { secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp"); }

let currentUserEmail = "", currentUserName = "", currentRoles = [];
let allTechs = [], allClientsCache = [], allMenuServicesCache = [], liveTaxes = [], liveTaxesInclusive = false;
let isFetchingClients = false, searchTimeout = null, fohSearchTimeout = null, editingApptId = null;
let currentConsultJobId = null, currentConsultJobData = null, pendingUpsells = [];
let consultTemplate = [];
// Active promo applied in the booking form
let _activePromo = null; // { id, code, type, value, discountAmount }

// Listener references (for cleanup)
let expectedTodayListener = null, scheduleListener = null,
    techQueueListener = null, fohBillingListener = null,
    fohRosterListener = null, fohFinancialListener = null,
    techFinancialListener = null, staffDirectoryListener = null;

// Date — computed once
const todayDateStr = getLocalDateString();

function getLocalDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

document.addEventListener("DOMContentLoaded", () => {
    const schedDate = document.getElementById('sched_date');
    if (schedDate) schedDate.min = todayDateStr;
});

// ============================================================
//  TOAST NOTIFICATION SYSTEM (replaces alert / confirm)
// ============================================================

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration ms before auto-dismiss (0 = manual only)
 */
function toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) { console.warn('Toast:', message); return; }

    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ'}</span>
        <span style="flex:1; line-height:1.45;">${message}</span>
        <button class="toast-close" aria-label="Close">✕</button>`;

    const close = t.querySelector('.toast-close');
    const dismiss = () => {
        t.classList.add('fade-out');
        t.addEventListener('animationend', () => t.remove(), { once: true });
    };
    close.addEventListener('click', dismiss);
    container.appendChild(t);
    if (duration > 0) setTimeout(dismiss, duration);
    return t;
}

/**
 * Async confirm dialog using a toast-style modal.
 * Returns a Promise<boolean>.
 */
function confirm(message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.5);
            z-index:9999999; display:flex; align-items:center; justify-content:center;
            padding:20px; backdrop-filter:blur(2px);`;
        overlay.innerHTML = `
            <div style="background:white; border-radius:10px; padding:28px 30px;
                        max-width:420px; width:100%; box-shadow:0 20px 50px rgba(0,0,0,0.2);
                        font-family:'DM Sans',sans-serif;">
                <p style="color:#2c3e50; font-size:0.975rem; line-height:1.6; margin-bottom:22px;">${message}</p>
                <div style="display:flex; gap:12px; justify-content:flex-end;">
                    <button id="confirmNo"  style="padding:9px 22px; border-radius:6px; border:1.5px solid #ccc; background:white; color:#555; cursor:pointer; font-weight:600; font-family:inherit;">Cancel</button>
                    <button id="confirmYes" style="padding:9px 22px; border-radius:6px; border:none; background:#e74c3c; color:white; cursor:pointer; font-weight:700; font-family:inherit;">Confirm</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#confirmYes').onclick = () => { overlay.remove(); resolve(true); };
        overlay.querySelector('#confirmNo').onclick  = () => { overlay.remove(); resolve(false); };
    });
}

// ============================================================
//  BUTTON LOADING STATE HELPER
// ============================================================

/**
 * Set a button into a loading/disabled state.
 * @param {string|HTMLElement} btnOrId
 * @param {boolean} isLoading
 * @param {string} [loadingText] optional label override while loading
 */
function setButtonLoading(btnOrId, isLoading, loadingText) {
    const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
    if (!btn) return;
    const textEl = btn.querySelector('.btn-text');
    if (isLoading) {
        btn.disabled = true;
        btn.classList.add('loading');
        if (loadingText && textEl) textEl.textContent = loadingText;
    } else {
        btn.disabled = false;
        btn.classList.remove('loading');
        // Restore original text from data attribute if set
        if (textEl && btn.dataset.originalText) {
            textEl.textContent = btn.dataset.originalText;
        }
    }
}

/** Save original button text on first call */
function captureButtonText(btnOrId) {
    const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
    if (!btn) return;
    const textEl = btn.querySelector('.btn-text');
    if (textEl && !btn.dataset.originalText) {
        btn.dataset.originalText = textEl.textContent;
    }
}

// ============================================================
//  UTILITY
// ============================================================

function timeToMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':');
    return parseInt(h) * 60 + parseInt(m);
}

/**
 * Safely parse taxBreakdown regardless of whether it was stored as a JSON string,
 * a double-serialised string, or is already an array.
 * Always returns an array of { name, rate, amount } objects.
 */
function _parseTaxBreakdown(raw) {
    if (!raw) return [];
    // Already an array (should not happen with Firestore strings, but defensive)
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw);
        // Double-serialised: JSON.parse returned another string
        if (typeof parsed === 'string') return JSON.parse(parsed);
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch (e) { return []; }
}

// ============================================================
//  MODULE SWITCHING
// ============================================================

window.switchModule = function(moduleId) {
    document.querySelectorAll('.app-module').forEach(mod => mod.style.display = 'none');
    const target = document.getElementById(moduleId);
    if (target) target.style.display = 'block';
    if (moduleId === 'adminView') { loadStaffDirectory(); }
};

window.toggleClientsSubView = function() {
    const view = document.querySelector('input[name="clients_view_toggle"]:checked').value;
    ['Checkin', 'Schedule', 'Billing', 'History', 'Ops'].forEach(x => {
        const el = document.getElementById('subView_' + x);
        if (el) el.style.display = (view.toLowerCase() === x.toLowerCase()) ? 'block' : 'none';
    });
    // Sync active class on cat-tabs for browsers without :has() support
    document.querySelectorAll('.cat-tab').forEach(t => {
        const inp = t.querySelector('input[type="radio"]');
        t.classList.toggle('cat-tab--active', inp?.checked || false);
    });
};

window.toggleDeptView = function() {
    const view = document.querySelector('input[name="dept_toggle"]:checked')?.value;
    ['Hand', 'Foot'].forEach(dept => {
        const el = document.getElementById('menu_dept_' + dept);
        if (el) el.style.display = (view === dept) ? 'block' : 'none';
    });
};

window.toggleAdminDeptView = function() {
    const view = document.querySelector('input[name="admin_dept_toggle"]:checked')?.value;
    ['Hand', 'Foot'].forEach(dept => {
        const el = document.getElementById('admin_dept_' + dept);
        if (el) el.style.display = (view === dept) ? 'block' : 'none';
    });
};

window.toggleMenuViewDept = function() {
    const view = document.querySelector('input[name="menu_view_dept_toggle"]:checked')?.value;
    ['Hand', 'Foot'].forEach(dept => {
        const el = document.getElementById('menu_view_dept_' + dept);
        if (el) el.style.display = (view === dept) ? 'block' : 'none';
    });
};

// ============================================================
//  AUTH
// ============================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        const userEmail = user.email.toLowerCase();
        try { await clockInStaff(userEmail, user.displayName || "Staff", []); } catch (e) { }

        try {
            const userDoc = await db.collection('Users').doc(userEmail).get();

            if (userDoc.exists) {
                const userData = userDoc.data() || {};
                currentUserEmail = userEmail;
                currentUserName = userData.name || user.displayName || "Staff Member";
                currentRoles = Array.isArray(userData.roles)
                    ? userData.roles
                    : (userData.role ? [userData.role] : []);

                document.getElementById('userNameDisplay').innerText = currentUserName;
                document.getElementById('userRoleDisplay').innerText = currentRoles.join(' | ');
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appDashboard').style.display = 'block';

                try { await fetchAllTechs(); } catch (e) { console.error(e); }
                try { startTaxListener(); } catch (e) { console.error(e); }
                try { startConsultTemplateListener(); } catch (e) { }

                document.getElementById('topNavMenu').style.display = 'flex';
                document.querySelectorAll('.nav-tab').forEach(tab => tab.style.display = 'none');

                const safeRoles = currentRoles.map(r => (typeof r === 'string' ? r.trim().toLowerCase() : ''));
                const isFOH     = safeRoles.some(r => r.includes('foh') || r.includes('front of house'));
                const isTech    = safeRoles.some(r => r.includes('tech'));
                const isManager = safeRoles.some(r => r.includes('manager'));
                const isAdmin   = safeRoles.some(r => r.includes('admin'));
                const isSupply  = safeRoles.some(r => r.includes('supply'));

                if (isManager || isFOH || isAdmin) {
                    document.getElementById('tabClients').style.display = 'flex';
                    try { startFohRosterListener(); } catch (e) { }
                    try { startFohFinancialListener(); } catch (e) { }
                    try { startExpectedTodayListener(); } catch (e) { }
                    try { startScheduleListener(); } catch (e) { }
                    try { startFohBillingListener(); } catch (e) { }
                }
                if (isManager || isTech || isAdmin) {
                    document.getElementById('tabAtelier').style.display = 'flex';
                    try { startTechFinancialListener(); } catch (e) { }
                    try { startTechQueueListener(); } catch (e) { }
                }
                if (isManager || isFOH || isTech || isAdmin) document.getElementById('tabMenu').style.display = 'flex';
                if (isAdmin || isManager) {
                    document.getElementById('tabMenuSettings').style.display = 'flex';
                    document.getElementById('tabPromos').style.display = 'flex';
                    try { loadPromos(); } catch (e) { }
                }
                if (isAdmin || isManager) document.getElementById('tabHR').style.display = 'flex';
                if (isAdmin || isManager || isSupply) document.getElementById('tabSupply').style.display = 'flex';
                if (isAdmin) {
                    document.getElementById('tabAdmin').style.display = 'flex';
                    try { loadStaffDirectory(); } catch (e) { }
                }
                if (isAdmin || isManager || isFOH || isTech) {
                    try { fetchLiveMenu(isManager || isAdmin); } catch (e) { }
                }

                const firstVisibleTab = document.querySelector('.nav-tab[style*="flex"] input');
                if (firstVisibleTab) {
                    firstVisibleTab.checked = true;
                    switchModule(firstVisibleTab.value);
                }
            } else {
                auth.signOut();
                showError("Access Denied: Your email is not registered in the matrix.");
            }
        } catch (error) { console.error(error); showError("Database connection error."); }
    } else {
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('appDashboard').style.display = 'none';
        document.getElementById('topNavMenu').style.display = 'none';
    }
});

window.signInWithEmail = function() {
    const email    = document.getElementById('testEmail').value.trim();
    const password = document.getElementById('testPassword').value;
    if (!email || !password) { showError("Enter email and password."); return; }
    const errorEl = document.getElementById('errorMsg');
    if (errorEl) errorEl.style.display = 'none';
    auth.signInWithEmailAndPassword(email, password).catch(error => {
        const knownCodes = ['auth/invalid-login-credentials','auth/wrong-password',
                            'auth/user-not-found','auth/invalid-credential'];
        if (knownCodes.includes(error.code))       showError("Invalid email or password.");
        else if (error.code === 'auth/invalid-email') showError("Please enter a valid email address.");
        else if (error.code === 'auth/too-many-requests') showError("Too many failed attempts. Try again later.");
        else showError(error.message || "Login failed.");
    });
};

window.signInWithGoogle = function() {
    document.getElementById('errorMsg').style.display = 'none';
    auth.signInWithPopup(provider).catch(error => showError(error.message));
};

window.logOut = async function() {
    if (currentUserEmail) {
        try {
            await db.collection('Attendance')
                .doc(`${currentUserEmail}_${todayDateStr}`)
                .update({ clockOut: firebase.firestore.FieldValue.serverTimestamp() });
        } catch (e) { }
    }
    auth.signOut();
};

window.showError = function(msg) {
    const el = document.getElementById('errorMsg');
    if (!el) { toast(msg, 'error'); return; }
    el.innerText = msg;
    el.style.display = 'block';
};

async function clockInStaff(email, name, rolesArray) {
    const docId  = `${email}_${todayDateStr}`;
    const docRef = db.collection('Attendance').doc(docId);
    const doc    = await docRef.get();
    if (!doc.exists) {
        await docRef.set({
            email, name,
            roleString: rolesArray.join(','),
            date: todayDateStr,
            clockIn: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

// ============================================================
//  TECH / USER FETCHING
// ============================================================

async function fetchAllTechs() {
    try {
        const snapshot = await db.collection('Users').get();
        allTechs = [];
        snapshot.forEach(doc => {
            const data   = doc.data();
            const r      = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
            const safeR  = r.map(role => (typeof role === 'string' ? role.toLowerCase() : ''));
            const isNorm = safeR.some(role => role === 'tech' || role === 'technician');
            const isTest = safeR.some(role => role.includes('test tech'));
            if (isNorm || isTest) allTechs.push({ email: doc.id, name: data.name || "Unknown", isTest });
        });

        const selects = ['sched_techSelect', 'consultReassignTech', 'consultReassign']
            .map(id => document.getElementById(id))
            .filter(Boolean);

        selects.forEach(sel => {
            const defaultLabel = sel.id === 'sched_techSelect' ? 'Select Technician...' : 'Reassign to...';
            sel.innerHTML = `<option value="" disabled selected>${defaultLabel}</option>`;
            allTechs.forEach(t => { sel.innerHTML += `<option value="${t.email}">${t.name}</option>`; });
        });
    } catch (e) { console.error("Error fetching techs:", e); }
}

// ============================================================
//  TAX ENGINE
// ============================================================

function startTaxListener() {
    db.collection('Tax_Settings').doc('current_taxes').onSnapshot(doc => {
        const data = doc.exists ? doc.data() : {};
        liveTaxes          = data.rates     || [];
        liveTaxesInclusive = data.inclusive === true;

        // Sync the inclusive/exclusive radio in Tax Configuration
        const yesEl = document.getElementById('cfg_inclusive_yes');
        const noEl  = document.getElementById('cfg_inclusive_no');
        if (yesEl && noEl) {
            yesEl.checked = liveTaxesInclusive;
            noEl.checked  = !liveTaxesInclusive;
        }
        // Sync the Price Simulator toggle (read-only preview)
        const simYes = document.querySelector('input[name="tax_inclusive_toggle"][value="inclusive"]');
        const simNo  = document.querySelector('input[name="tax_inclusive_toggle"][value="exclusive"]');
        if (simYes && simNo) {
            simYes.checked = liveTaxesInclusive;
            simNo.checked  = !liveTaxesInclusive;
        }

        renderTaxConfigUI();
        updatePreviewToggles();
        calculateScheduleTotals();
    });
}

/** Persist the tax inclusive/exclusive setting to Firestore */
window.saveTaxInclusiveSetting = async function(isInclusive) {
    try {
        await db.collection('Tax_Settings').doc('current_taxes')
            .set({ inclusive: isInclusive }, { merge: true });
        toast(`Pricing set to tax-${isInclusive ? 'inclusive' : 'exclusive'}.`, 'info');
    } catch (e) { toast('Error saving setting: ' + e.message, 'error'); }
};

/**
 * _applyTaxes — single source of truth for all tax arithmetic.
 *
 * TAX-INCLUSIVE (liveTaxesInclusive = true):
 *   Listed price already contains tax.
 *   basePrice  = listedTotal / (1 + combinedRate)  — extract pre-tax amount
 *   grandTotal = listedTotal                         — unchanged; client pays listed price
 *
 * TAX-EXCLUSIVE (liveTaxesInclusive = false):
 *   Listed price is pre-tax.
 *   basePrice  = listedTotal                         — unchanged
 *   grandTotal = listedTotal × (1 + combinedRate)    — add tax on top
 *
 * @param {number} listedTotal  Sum of service prices as stored in the menu
 * @returns {{ basePrice, grandTotal, taxLines, taxHtml }}
 */
function _applyTaxes(listedTotal) {
    if (!liveTaxes.length || listedTotal === 0) {
        return { basePrice: listedTotal, grandTotal: listedTotal, taxLines: [], taxHtml: '' };
    }
    const combinedRate = liveTaxes.reduce((s, t) => s + t.rate, 0) / 100;
    const basePrice    = liveTaxesInclusive ? listedTotal / (1 + combinedRate) : listedTotal;
    const grandTotal   = liveTaxesInclusive ? listedTotal : listedTotal * (1 + combinedRate);

    const taxLines = liveTaxes.map(t => ({
        name: t.name, rate: t.rate,
        amount: basePrice * (t.rate / 100),
    }));
    const taxHtml = taxLines.map(l =>
        `<div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#888;margin-bottom:3px;">
            <span>+ ${l.name} (${l.rate}%)</span><span>${l.amount.toFixed(2)} GHC</span>
         </div>`).join('');

    return { basePrice, grandTotal, taxLines, taxHtml };
}

window.editTax = function(name, rate) {
    document.getElementById('cfgTaxName').value = name;
    document.getElementById('cfgTaxRate').value = rate;
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.addTax = async function() {
    const btn  = document.getElementById('btnAddTax');
    const name = document.getElementById('cfgTaxName').value.trim();
    const rate = parseFloat(document.getElementById('cfgTaxRate').value);
    if (!name || isNaN(rate)) { toast("Enter a valid Tax Name and numerical Rate.", 'warning'); return; }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');
    let current = [...liveTaxes];
    const idx = current.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) current[idx].rate = rate; else current.push({ name, rate });

    try {
        await db.collection('Tax_Settings').doc('current_taxes').set({ rates: current }, { merge: true });
        document.getElementById('cfgTaxName').value = '';
        document.getElementById('cfgTaxRate').value = '';
        toast(`Tax "${name}" saved successfully.`, 'success');
    } catch (e) { toast("Error saving tax: " + e.message, 'error'); }
    finally { setButtonLoading(btn, false); }
};

window.deleteTax = async function(taxName) {
    const ok = await confirm(`Remove <strong>${taxName}</strong> from the system?`);
    if (!ok) return;
    const current = liveTaxes.filter(t => t.name !== taxName);
    try {
        await db.collection('Tax_Settings').doc('current_taxes').set({ rates: current }, { merge: true });
        toast(`Tax "${taxName}" removed.`, 'info');
    } catch (e) { toast("Error deleting tax: " + e.message, 'error'); }
};

function renderTaxConfigUI() {
    const listDiv = document.getElementById('taxConfigList');
    if (!listDiv) return;
    if (liveTaxes.length === 0) {
        listDiv.innerHTML = '<p class="text-muted">No taxes currently configured.</p>';
        return;
    }
    listDiv.innerHTML = liveTaxes.map(t => `
        <div class="tax-row">
            <strong>${t.name}</strong>
            <div class="tax-row-actions">
                <span class="tax-rate-label">${t.rate}%</span>
                <button class="btn btn-sm" style="width:auto; background:var(--primary);" onclick="editTax('${t.name}', ${t.rate})">Edit</button>
                <button class="btn btn-sm btn-error" style="width:auto;" onclick="deleteTax('${t.name}')">Remove</button>
            </div>
        </div>`).join('');
}

window.updatePreviewToggles = function() {
    const container = document.getElementById('previewTaxToggles');
    if (!container) return;
    if (liveTaxes.length === 0) {
        container.innerHTML = '<p class="text-muted" style="margin:0;">Add a tax above to see toggles here.</p>';
        calculatePreview();
        return;
    }
    container.innerHTML = liveTaxes.map((t, i) => `
        <label style="font-weight:400; cursor:pointer; display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:0.875rem;">
            <input type="checkbox" class="preview-tax-cb" value="${i}" checked onchange="calculatePreview()" style="width:15px; height:15px; accent-color:var(--manager);">
            ${t.name} (${t.rate}%)
        </label>`).join('');
    calculatePreview();
};

window.calculatePreview = function() {
    const inputPrice  = parseFloat(document.getElementById('previewBasePrice').value) || 0;
    const toggleEl    = document.querySelector('input[name="tax_inclusive_toggle"]:checked');
    const isInclusive = toggleEl ? toggleEl.value === 'inclusive' : false;
    let totalTaxRate  = 0;

    document.querySelectorAll('.preview-tax-cb:checked').forEach(cb => {
        const t = liveTaxes[cb.value];
        if (t) totalTaxRate += t.rate;
    });

    const basePrice  = isInclusive ? inputPrice / (1 + totalTaxRate / 100) : inputPrice;
    const grandTotal = isInclusive ? inputPrice : inputPrice * (1 + totalTaxRate / 100);

    let taxHtml = '';
    document.querySelectorAll('.preview-tax-cb:checked').forEach(cb => {
        const t = liveTaxes[cb.value];
        if (t) {
            const amt = basePrice * (t.rate / 100);
            taxHtml += `<div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#777; margin-bottom:3px;"><span>+ ${t.name} (${t.rate}%)</span><span>${amt.toFixed(2)} GHC</span></div>`;
        }
    });

    const baseOut = document.getElementById('prevBaseOut');
    const brkDwn  = document.getElementById('prevTaxBreakdown');
    const totOut  = document.getElementById('prevTotalOut');
    if (baseOut) baseOut.innerText = basePrice.toFixed(2) + ' GHC';
    if (brkDwn)  brkDwn.innerHTML  = taxHtml;
    if (totOut)  totOut.innerText  = grandTotal.toFixed(2) + ' GHC';
};

// ============================================================
//  SERVICE MENU — single snapshot, renders into 3 targets:
//   1. sched_serviceMenu      — booking form (selectable cards)
//   2. menuViewReadOnly       — Service Menu tab (read-only, all roles)
//   3. menuManagerList        — Menu Settings tab (edit cards, Manager/Admin only)
// ============================================================

function fetchLiveMenu(hasEditAccess) {
    // Show seed button for Manager/Admin
    const seedBtn = document.getElementById('seedMenuBtnContainer');
    if (seedBtn && hasEditAccess) seedBtn.style.display = 'block';

    db.collection('Menu_Services').onSnapshot(snap => {
        const bookingContainer  = document.getElementById('sched_serviceMenu');
        const readOnlyContainer = document.getElementById('menuViewReadOnly');
        const adminList         = document.getElementById('menuManagerList');

        if (snap.empty) {
            const emptyMsg = '<p class="text-muted" style="text-align:center;">No services configured yet.</p>';
            if (bookingContainer)  bookingContainer.innerHTML  = emptyMsg;
            if (readOnlyContainer) readOnlyContainer.innerHTML = emptyMsg;
            if (adminList) adminList.innerHTML = '<p class="text-muted" style="text-align:center;">No services configured. Use the form above to add the first service.</p>';
            return;
        }

        let services = [];
        snap.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
        services.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
        allMenuServicesCache = services;

        // Populate upsell select in consultation modal
        const uSel = document.getElementById('consultUpsellSelect');
        if (uSel) {
            uSel.innerHTML = '<option value="">Add a service or upgrade...</option>';
            allMenuServicesCache.forEach(s => {
                if (s.status === "Active") {
                    uSel.innerHTML += `<option value="${s.id}">${s.name} (${s.price} GHC)</option>`;
                }
            });
        }

        // ── Build dept data structure ─────────────────────────────────────────
        // Normalise category strings (trim + collapse whitespace) so minor
        // storage inconsistencies don't create phantom duplicate sections.
        //
        // CATEGORY ALIASES — maps legacy / variant names to the canonical name.
        // Services stored under an alias are merged into the canonical bucket
        // at render time; Firestore documents are not modified.
        const CATEGORY_ALIASES = {
            'I. HAND THERAPIES': 'I. HAND THERAPY RITUALS',
        };

        let dbData = { Hand: {}, Foot: {} };
        services.forEach(s => {
            let rawCat = (s.category || "Uncategorized").trim().replace(/\s+/g, ' ');
            // Apply alias: check both the exact string and an upper-cased version
            rawCat = CATEGORY_ALIASES[rawCat] ?? CATEGORY_ALIASES[rawCat.toUpperCase()] ?? rawCat;
            const dept = s.department || "Hand";

            const addTo = (d) => {
                if (!dbData[d]) dbData[d] = {};
                if (!dbData[d][rawCat]) dbData[d][rawCat] = [];
                dbData[d][rawCat].push(s);
            };

            if (s.department === "Both") { addTo("Hand"); addTo("Foot"); }
            else addTo(dept);
        });

        // Within every category, sort: radio → checkbox → counter
        const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
        Object.values(dbData).forEach(deptObj => {
            Object.values(deptObj).forEach(arr => {
                arr.sort((a, b) => {
                    const ta = typeOrder[a.inputType] ?? 1;
                    const tb = typeOrder[b.inputType] ?? 1;
                    return ta - tb;
                });
            });
        });

        const numRegex = /^(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)\./i;

        function sortedCatsFor(dept) {
            return Object.keys(dbData[dept]).sort((a, b) => {
                const aU = a.trim().toUpperCase(), bU = b.trim().toUpperCase();
                const aNum = numRegex.test(aU), bNum = numRegex.test(bU);

                // Numbered sections (I., II., A., B.) always before un-numbered
                if (aNum && !bNum) return -1;
                if (!aNum && bNum) return 1;

                // Among same-numbered tier: radio-dominant categories before multi-select
                const aRadio = (dbData[dept][a][0]?.inputType || 'checkbox') === 'radio';
                const bRadio = (dbData[dept][b][0]?.inputType || 'checkbox') === 'radio';
                if (aRadio && !bRadio) return -1;
                if (!aRadio && bRadio) return 1;

                return aU.localeCompare(bU, undefined, { numeric: true, sensitivity: 'base' });
            });
        }

        // ── Shared helper: build card HTML for one service ───────────────────
        // prefix = 'sched' or 'menu', dept used for radio group name
        function buildCard(s, dept, prefix, toggleFn, counterFn) {
            const type     = s.inputType || "radio";
            const safeName = s.name     || "Unnamed";
            const safeDur  = s.duration || 0;
            const safePrc  = s.price    || 0;
            const descHtml = s.desc ? `<span class="service-desc">${s.desc}</span>` : '';
            const tagHtml  = (s.tag && s.tag !== "None") ? `<span class="hl-tag">${s.tag}</span>` : '';
            const priceTag = `<span class="service-price-tag">${safeDur > 0 ? safeDur + ' mins | ' : ''}${safePrc} GHC</span>`;

            if (type === 'counter') {
                return `
                    <div class="service-card" style="align-items:center;">
                        <label style="margin-left:0; cursor:default;">
                            <strong>${safeName} ${tagHtml}</strong>${descHtml}${priceTag}
                        </label>
                        <div class="counter-box">
                            <button class="btn btn-secondary btn-sm btn-auto" onclick="${counterFn}('${s.id}',-1)">−</button>
                            <input type="number" id="${prefix}_qty_${s.id}" class="${prefix}-service-counter"
                                data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}" value="0" min="0" readonly>
                            <button class="btn btn-secondary btn-sm btn-auto" onclick="${counterFn}('${s.id}',1)">+</button>
                        </div>
                    </div>`;
            }

            const inputName = type === 'radio' ? `${prefix}_base_${dept}` : `${prefix}_cb_${s.id}`;
            const inputHtml = type === 'radio'
                ? `<input type="radio"    name="${inputName}" class="${prefix}-service-item" id="${prefix}_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`
                : `<input type="checkbox"                    class="${prefix}-service-item" id="${prefix}_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`;

            return `
                <div class="service-card" onclick="${toggleFn}(event,this,'${s.id}','${type}','${inputName}')">
                    ${inputHtml}
                    <label><strong>${safeName} ${tagHtml}</strong>${descHtml}${priceTag}</label>
                </div>`;
        }

        // Build one full category section — items already sorted radio→checkbox→counter
        // Renders a sub-divider between the single-select block and multi-select block
        function buildCategorySection(dept, cat, services, prefix, toggleFn, counterFn) {
            const singles = services.filter(s => (s.inputType || 'radio') === 'radio');
            const multis  = services.filter(s => (s.inputType || 'radio') !== 'radio');

            let sectionHtml = `<div class="menu-col">`;

            if (singles.length > 0 && multis.length === 0) {
                // Pure single-select section
                sectionHtml += `<div class="menu-section-title"><span>${cat}</span><span class="section-hint">Select one</span></div>`;
                singles.forEach(s => { sectionHtml += buildCard(s, dept, prefix, toggleFn, counterFn); });

            } else if (multis.length > 0 && singles.length === 0) {
                // Pure multi-select section
                sectionHtml += `<div class="menu-section-title"><span>${cat}</span><span class="section-hint">Select any</span></div>`;
                multis.forEach(s => { sectionHtml += buildCard(s, dept, prefix, toggleFn, counterFn); });

            } else {
                // Mixed section: single-select items first, then a divider, then multi-select
                sectionHtml += `<div class="menu-section-title"><span>${cat}</span></div>`;

                // Single-select sub-block
                sectionHtml += `<div class="menu-subgroup-label">Choose your ritual <span class="section-hint">Select one</span></div>`;
                singles.forEach(s => { sectionHtml += buildCard(s, dept, prefix, toggleFn, counterFn); });

                // Multi-select sub-block
                sectionHtml += `<div class="menu-subgroup-divider"></div>`;
                sectionHtml += `<div class="menu-subgroup-label">Enhancements &amp; Add-ons <span class="section-hint">Select any</span></div>`;
                multis.forEach(s => { sectionHtml += buildCard(s, dept, prefix, toggleFn, counterFn); });
            }

            sectionHtml += '</div>';
            return sectionHtml;
        }

        // ── 1. BOOKING HTML (selectable cards) ──────────────────────────────
        let bookingHtml = '';
        ['Hand', 'Foot'].forEach(dept => {
            const disp = dept === 'Hand' ? 'block' : 'none';
            bookingHtml += `<div id="menu_dept_${dept}" style="display:${disp};">`;
            let col1 = '', col2 = '', toggleCol = true;

            sortedCatsFor(dept).forEach(cat => {
                const html = buildCategorySection(dept, cat, dbData[dept][cat], 'sched', 'toggleServiceCard', 'updateCounter');
                if (toggleCol) col1 += html; else col2 += html;
                toggleCol = !toggleCol;
            });

            bookingHtml += `<div class="grid-2" style="align-items:start;">${col1}${col2}</div></div>`;
        });
        if (bookingContainer) bookingContainer.innerHTML = bookingHtml;

        // ── 2. INTERACTIVE MENU TAB (selectable cards with own breakdown) ────
        let menuViewHtml = '';
        ['Hand', 'Foot'].forEach(dept => {
            const disp = dept === 'Hand' ? 'block' : 'none';
            menuViewHtml += `<div id="menu_view_dept_${dept}" style="display:${disp};">`;
            let col1 = '', col2 = '', toggleCol = true;

            sortedCatsFor(dept).forEach(cat => {
                const html = buildCategorySection(dept, cat, dbData[dept][cat], 'menu', 'toggleMenuServiceCard', 'updateMenuCounter');
                if (toggleCol) col1 += html; else col2 += html;
                toggleCol = !toggleCol;
            });

            menuViewHtml += `<div class="grid-2" style="align-items:start;">${col1}${col2}</div></div>`;
        });
        if (readOnlyContainer) readOnlyContainer.innerHTML = menuViewHtml;

        // ── 3. ADMIN EDIT CARDS (Menu Settings tab) ──────────────────────────
        let adminHtml = '';
        ['Hand', 'Foot'].forEach(dept => {
            const disp = dept === 'Hand' ? 'block' : 'none';
            adminHtml += `<div id="admin_dept_${dept}" style="display:${disp};">`;

            sortedCatsFor(dept).forEach(cat => {
                // Within the settings tab, preserve the same single-then-multi order
                const catServices = dbData[dept][cat];
                let aSectionHtml = `<div class="menu-section-title"><span>${cat}</span></div><div class="grid-2">`;

                catServices.forEach(s => {
                    const type     = s.inputType || "radio";
                    const safeName = s.name || "Unnamed";
                    const safeDur  = s.duration || 0;
                    const safePrc  = s.price || 0;
                    const tagHtml  = (s.tag && s.tag !== "None") ? `<span class="hl-tag">${s.tag}</span>` : '';

                    if (hasEditAccess) {
                        aSectionHtml += `
                            <div class="service-card" style="align-items:center; cursor:default;">
                                <div style="flex-grow:1;">
                                    <strong>${safeName} ${tagHtml}</strong>
                                    <span class="form-builder-item-type">${type.toUpperCase()}</span><br>
                                    <div style="margin-top:8px; display:flex; gap:10px; align-items:center;">
                                        <input type="number" id="dur_${s.id}" value="${safeDur}" style="width:70px; padding:5px; border:1px solid #ccc; border-radius:4px;"> m
                                        <input type="number" id="prc_${s.id}" value="${safePrc}" style="width:70px; padding:5px; border:1px solid #ccc; border-radius:4px;"> ₵
                                    </div>
                                </div>
                                <div style="display:flex; flex-direction:column; gap:5px;">
                                    <button class="btn btn-success btn-sm btn-auto" onclick="updateMenuService('${s.id}')">Save</button>
                                    <button class="btn btn-error  btn-sm btn-auto" onclick="deleteMenuService('${s.id}')">Delete</button>
                                </div>
                            </div>`;
                    } else {
                        aSectionHtml += `
                            <div class="service-card" style="cursor:default;">
                                <label style="margin-left:0; cursor:default;">
                                    <strong>${safeName} ${tagHtml}</strong>
                                    <span class="service-desc">${safeDur} mins | ${safePrc} GHC</span>
                                </label>
                            </div>`;
                    }
                });

                aSectionHtml += '</div>';
                adminHtml += aSectionHtml;
            });

            adminHtml += '</div>';
        });
        if (adminList) adminList.innerHTML = adminHtml;

    }, error => {
        const el = document.getElementById('sched_serviceMenu');
        if (el) el.innerHTML = `<p style="color:var(--error);">Error loading menu: ${error.message}</p>`;
    });
}

window.updateMenuService = async function(id) {
    const dur = parseInt(document.getElementById('dur_' + id).value) || 0;
    const prc = parseFloat(document.getElementById('prc_' + id).value) || 0;
    try {
        await db.collection('Menu_Services').doc(id).update({ duration: dur, price: prc });
        toast("Service updated successfully.", 'success');
    } catch (e) { toast("Error updating: " + e.message, 'error'); }
};

window.deleteMenuService = async function(id) {
    const ok = await confirm("Permanently delete this service from the menu?");
    if (!ok) return;
    try {
        await db.collection('Menu_Services').doc(id).delete();
        toast("Service deleted.", 'info');
    } catch (e) { toast("Error deleting: " + e.message, 'error'); }
};

window.seedDefaultMenu = async function() {
    const ok = await confirm("This will inject dummy data. Proceed?");
    if (!ok) return;
    const menuItems = [
        { dept:"Hand", cat:"I. HAND THERAPY RITUALS",   type:"radio",    name:"Youthful Touch (Hand Renewal)", dur:45, prc:220, desc:"", tag:"None" },
        { dept:"Hand", cat:"A. FINISHING INDULGENCES", type:"checkbox", name:"Lush Arm Sculpt",               dur:20, prc:50,  desc:"", tag:"None" }
    ];
    try {
        for (const item of menuItems) {
            const docId = item.name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
            await db.collection('Menu_Services').doc(docId).set({
                department: item.dept, category: item.cat, inputType: item.type,
                name: item.name, duration: item.dur, price: item.prc,
                desc: item.desc, status: "Active", tag: item.tag
            });
        }
        toast("Menu seeded successfully.", 'success');
    } catch (e) { toast("Error seeding menu: " + e.message, 'error'); }
};

// One-time migration: rewrites legacy category names in Firestore to their
// canonical equivalents. Safe to run multiple times — skips docs already correct.
window.runCategoryMigration = async function() {
    const MIGRATIONS = {
        'I. HAND THERAPIES': 'I. HAND THERAPY RITUALS',
    };

    const ok = await confirm(
        'This will permanently update service documents in Firestore, ' +
        'renaming legacy category labels to their canonical names.\n\n' +
        'It is safe to run more than once. Proceed?'
    );
    if (!ok) return;

    const btn = document.getElementById('btnRunCategoryMigration');
    captureButtonText(btn); setButtonLoading(btn, true, 'Migrating...');

    try {
        const snap = await db.collection('Menu_Services').get();
        const batch = db.batch();
        let count = 0;

        snap.forEach(doc => {
            const cat = (doc.data().category || '').trim().replace(/\s+/g, ' ');
            const canonical = MIGRATIONS[cat] ?? MIGRATIONS[cat.toUpperCase()];
            if (canonical) {
                batch.update(doc.ref, { category: canonical });
                count++;
            }
        });

        if (count === 0) {
            toast('Nothing to migrate — all categories are already up to date.', 'info');
            return;
        }

        await batch.commit();
        toast(`Migration complete. ${count} service${count !== 1 ? 's' : ''} updated.`, 'success', 7000);
    } catch (e) {
        toast('Migration error: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
};

// ============================================================
//  SERVICE CARD SELECTION
// ============================================================

window.toggleServiceCard = function(event, cardElement, id, type, groupName) {
    event.preventDefault();
    const input = document.getElementById('sched_cb_' + id);
    if (!input) return;

    if (type === 'radio') {
        if (input.checked) {
            input.checked = false;
            cardElement.classList.remove('selected');
        } else {
            document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
                r.checked = false;
                r.closest('.service-card')?.classList.remove('selected');
            });
            input.checked = true;
            cardElement.classList.add('selected');
        }
    } else {
        input.checked = !input.checked;
        cardElement.classList.toggle('selected', input.checked);
    }
    calculateScheduleTotals();
};

window.updateCounter = function(id, val) {
    const input = document.getElementById('sched_qty_' + id);
    if (!input) return;
    let current = parseInt(input.value) || 0;
    current = Math.max(0, current + val);
    input.value = current;
    calculateScheduleTotals();
};

window.clearAllSelections = function() {
    document.querySelectorAll('.sched-service-item').forEach(cb => cb.checked = false);
    document.querySelectorAll('.sched-service-counter').forEach(input => input.value = 0);
    document.querySelectorAll('.service-card').forEach(card => card.classList.remove('selected'));
    calculateScheduleTotals();
};

// ============================================================
//  SERVICE MENU TAB — selection & breakdown
//  Uses menu_cb_* / menu_qty_* / menu_base_* to avoid
//  colliding with the booking form's sched_* inputs.
// ============================================================

window.toggleMenuServiceCard = function(event, cardElement, id, type, groupName) {
    event.preventDefault();
    const input = document.getElementById('menu_cb_' + id);
    if (!input) return;

    if (type === 'radio') {
        if (input.checked) {
            input.checked = false;
            cardElement.classList.remove('selected');
        } else {
            document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
                r.checked = false;
                r.closest('.service-card')?.classList.remove('selected');
            });
            input.checked = true;
            cardElement.classList.add('selected');
        }
    } else {
        input.checked = !input.checked;
        cardElement.classList.toggle('selected', input.checked);
    }
    calculateMenuTotals();
};

window.updateMenuCounter = function(id, val) {
    const input = document.getElementById('menu_qty_' + id);
    if (!input) return;
    let current = parseInt(input.value) || 0;
    current = Math.max(0, current + val);
    input.value = current;
    calculateMenuTotals();
};

window.clearMenuSelections = function() {
    document.querySelectorAll('.menu-service-item').forEach(cb => cb.checked = false);
    document.querySelectorAll('.menu-service-counter').forEach(input => input.value = 0);
    // Only clear cards inside the menu tab, not booking form cards
    const menuContainer = document.getElementById('menuViewReadOnly');
    if (menuContainer) menuContainer.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
    calculateMenuTotals();
};

function calculateMenuTotals() {
    let totalMins = 0, subtotalCost = 0;
    let breakdownHtml = '';

    document.querySelectorAll('.menu-service-item:checked').forEach(input => {
        const mins = parseInt(input.getAttribute('data-duration')) || 0;
        const cost = parseFloat(input.getAttribute('data-price')) || 0;
        const name = input.getAttribute('data-name');
        totalMins += mins; subtotalCost += cost;
        breakdownHtml += `<div class="breakdown-row"><span>${name}</span><span>${cost.toFixed(2)} GHC</span></div>`;
    });

    document.querySelectorAll('.menu-service-counter').forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
            const costPer   = parseFloat(input.getAttribute('data-price')) || 0;
            const mins      = parseInt(input.getAttribute('data-duration')) || 0;
            const name      = input.getAttribute('data-name');
            const itemTotal = costPer * qty;
            totalMins += mins; subtotalCost += itemTotal;
            breakdownHtml += `<div class="breakdown-row"><span>${name} (x${qty})</span><span>${itemTotal.toFixed(2)} GHC</span></div>`;
        }
    });

    // Apply taxes — inclusive or exclusive via _applyTaxes
    const { basePrice, grandTotal, taxLines, taxHtml: taxBreakdownHtml } = _applyTaxes(subtotalCost);

    if (subtotalCost > 0 && taxLines.length > 0) {
        const subtotalLine = `<div style="display:flex;justify-content:space-between;margin-bottom:5px;font-weight:600;color:#555;"><span>Subtotal (ex. tax):</span><span>${basePrice.toFixed(2)} GHC</span></div>`;
        if (taxEl) { taxEl.innerHTML = subtotalLine + taxBreakdownHtml; taxEl.style.display = 'block'; }
    } else {
        if (taxEl) taxEl.style.display = 'none';
    }

    const taxEl  = document.getElementById('menu_taxBreakdown');
    const brkDiv = document.getElementById('menu_breakdown');
    const brkList= document.getElementById('menu_breakdownList');
    const durEl  = document.getElementById('menu_totalDuration');
    const costEl = document.getElementById('menu_totalCost');

    if (!brkDiv) return; // menu tab not yet in DOM

    if (subtotalCost > 0 || totalMins > 0) {
        if (brkList) brkList.innerHTML = breakdownHtml;
        if (taxEl) {
            if (taxBreakdownHtml) { taxEl.innerHTML = taxBreakdownHtml; taxEl.style.display = 'block'; }
            else taxEl.style.display = 'none';
        }
        if (durEl)  durEl.innerText  = totalMins;
        if (costEl) costEl.innerText = grandTotal.toFixed(2);
        brkDiv.style.display = 'block';
    } else {
        if (brkList) brkList.innerHTML = '';
        if (taxEl)   taxEl.style.display = 'none';
        if (durEl)   durEl.innerText  = '0';
        if (costEl)  costEl.innerText = '0.00';
        brkDiv.style.display = 'none';
    }
}

// ============================================================
//  BOOKING TOTALS & TIME SLOTS
// ============================================================

function calculateScheduleTotals() {
    let totalMins = 0, subtotalCost = 0;
    let breakdownHtml = '';

    document.querySelectorAll('.sched-service-item:checked').forEach(input => {
        const mins = parseInt(input.getAttribute('data-duration')) || 0;
        const cost = parseFloat(input.getAttribute('data-price')) || 0;
        const name = input.getAttribute('data-name');
        totalMins += mins; subtotalCost += cost;
        breakdownHtml += `<div class="breakdown-row"><span>${name}</span><span>${cost.toFixed(2)} GHC</span></div>`;
    });

    document.querySelectorAll('.sched-service-counter').forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
            const costPer = parseFloat(input.getAttribute('data-price')) || 0;
            const mins    = parseInt(input.getAttribute('data-duration')) || 0;
            const name    = input.getAttribute('data-name');
            const itemTotal = costPer * qty;
            totalMins += mins; subtotalCost += itemTotal;
            breakdownHtml += `<div class="breakdown-row"><span>${name} (x${qty})</span><span>${itemTotal.toFixed(2)} GHC</span></div>`;
        }
    });

    // Tax engine — inclusive or exclusive, handled by _applyTaxes
    const { basePrice, grandTotal, taxLines, taxHtml: taxBreakdownHtml } = _applyTaxes(subtotalCost);
    const taxDataArr = taxLines.map(l => ({ name: l.name, rate: l.rate, amount: l.amount }));

    if (subtotalCost > 0 && taxLines.length > 0) {
        const subtotalLine = `<div style="display:flex;justify-content:space-between;margin-bottom:5px;font-weight:600;color:#555;"><span>Subtotal (ex. tax):</span><span>${basePrice.toFixed(2)} GHC</span></div>`;
        const taxEl = document.getElementById('sched_taxBreakdown');
        if (taxEl) { taxEl.innerHTML = subtotalLine + taxBreakdownHtml; taxEl.style.display = 'block'; }
    } else {
        const taxEl = document.getElementById('sched_taxBreakdown');
        if (taxEl) taxEl.style.display = 'none';
    }

    document.getElementById('sched_totalDuration').innerText = totalMins;
    document.getElementById('sched_totalCost').innerText     = grandTotal.toFixed(2);
    document.getElementById('sched_subtotalVal').value       = basePrice;       // pre-tax amount
    document.getElementById('sched_taxData').value           = JSON.stringify(taxDataArr);
    document.getElementById('sched_grandTotalVal').value     = grandTotal;

    const brkDiv  = document.getElementById('sched_breakdown');
    const brkList = document.getElementById('sched_breakdownList');
    if (subtotalCost > 0 || totalMins > 0) {
        let displayHtml = breakdownHtml;

        // Promo discount line
        let finalTotal = grandTotal;
        let discountAmt = 0;
        if (_activePromo && grandTotal > 0) {
            if (_activePromo.minSpend > 0 && grandTotal < _activePromo.minSpend) {
                // Minimum spend not met — clear promo silently and show warning
                _showPromoStatus(`Minimum spend of ${_activePromo.minSpend.toFixed(2)} GHC not reached.`, false);
                _activePromo = null;
                _syncPromoHiddenInputs(0, 0);
            } else {
                discountAmt = _activePromo.type === 'percent'
                    ? grandTotal * (_activePromo.value / 100)
                    : Math.min(_activePromo.value, grandTotal);
                discountAmt = Math.round(discountAmt * 100) / 100;
                finalTotal  = Math.max(0, grandTotal - discountAmt);
                displayHtml += `<div class="discount-row"><span>🎟 ${_activePromo.code} discount</span><span>−${discountAmt.toFixed(2)} GHC</span></div>`;
                _syncPromoHiddenInputs(grandTotal, discountAmt);
            }
        } else {
            _syncPromoHiddenInputs(0, 0);
        }

        if (brkList) brkList.innerHTML = displayHtml;
        if (brkDiv)  brkDiv.style.display = 'block';

        // Update cost display to show discounted total
        document.getElementById('sched_totalCost').innerText = finalTotal.toFixed(2);
        document.getElementById('sched_grandTotalVal').value = finalTotal;
    } else {
        if (brkList) brkList.innerHTML = '';
        if (brkDiv)  brkDiv.style.display = 'none';
        _syncPromoHiddenInputs(0, 0);
    }

    generateTimeSlots();
}

window.selectTimeSlot = function(timeStr, btnElement) {
    document.getElementById('sched_time').value = timeStr;
    document.querySelectorAll('.time-slot-btn').forEach(btn => btn.classList.remove('selected'));
    btnElement.classList.add('selected');
};

async function generateTimeSlots() {
    const date       = document.getElementById('sched_date').value;
    const duration   = parseInt(document.getElementById('sched_totalDuration').innerText) || 0;
    const techEmail  = document.getElementById('sched_techSelect').value;
    const slotsEl    = document.getElementById('sched_timeSlots');

    if (date && date < todayDateStr) {
        slotsEl.innerHTML = '<p style="color:var(--error); font-weight:700; margin:0;">You cannot book appointments in the past.</p>';
        return;
    }

    document.getElementById('sched_time').value = '';

    if (!date || !techEmail || duration === 0) {
        slotsEl.innerHTML = '<p class="text-muted" style="margin:0;">⚠️ Select at least one service, a date, and a technician to generate times.</p>';
        return;
    }

    slotsEl.innerHTML = '<p style="color:#888; font-size:0.85rem; margin:0;">Calculating slots...</p>';

    try {
        const snap = await db.collection('Appointments').where('dateString', '==', date).get();
        const busyBlocks = [];
        snap.forEach(doc => {
            if (editingApptId && doc.id === editingApptId) return;
            const appt = doc.data();
            if (appt.assignedTechEmail === techEmail &&
                (appt.status === 'Scheduled' || appt.status === 'Arrived')) {
                busyBlocks.push({ start: timeToMins(appt.timeString), end: timeToMins(appt.timeString) + parseInt(appt.bookedDuration || 0) });
            }
        });

        const openTime = 8 * 60, closeTime = 20 * 60, interval = 30;
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const isToday = (date === todayDateStr);
        let html = '<div style="display:flex; flex-wrap:wrap; gap:8px;">';
        let slotsFound = false;

        for (let t = openTime; t + duration <= closeTime; t += interval) {
            if (isToday && t <= currentMins) continue;
            const slotEnd = t + duration;
            let available = busyBlocks.every(b => slotEnd <= b.start || t >= b.end);
            if (available) {
                slotsFound = true;
                const hrs = Math.floor(t / 60), mins = t % 60;
                const ampm = hrs >= 12 ? 'PM' : 'AM';
                const h12  = hrs % 12 || 12;
                const mm   = String(mins).padStart(2, '0');
                const t24  = `${String(hrs).padStart(2,'0')}:${mm}`;
                html += `<button type="button" class="time-slot-btn" data-time="${t24}" onclick="selectTimeSlot('${t24}',this)">${h12}:${mm} ${ampm}</button>`;
            }
        }
        html += '</div>';

        slotsEl.innerHTML = slotsFound
            ? html
            : '<p style="color:var(--error); font-weight:700; margin:0;">No time slots available for this duration.</p>';
    } catch (e) { console.error("Availability Error:", e); }
}

// ============================================================
//  APPOINTMENT CRUD
// ============================================================

window.bookAppointment = async function() {
    const btn      = document.getElementById('btnConfirmBooking');
    const phone    = document.getElementById('sched_phone').value;
    const name     = document.getElementById('sched_name').value;
    const date     = document.getElementById('sched_date').value;
    const time     = document.getElementById('sched_time').value;
    const duration = document.getElementById('sched_totalDuration').innerText;
    const subtotal = document.getElementById('sched_subtotalVal').value;
    const taxData  = document.getElementById('sched_taxData').value;
    const grandTotal = document.getElementById('sched_grandTotalVal').value;
    const techEmail  = document.getElementById('sched_techSelect').value;
    const techName   = document.getElementById('sched_techSelect').options[document.getElementById('sched_techSelect').selectedIndex]?.text;

    const services = [];
    document.querySelectorAll('.sched-service-item:checked').forEach(cb => services.push(cb.getAttribute('data-name')));
    document.querySelectorAll('.sched-service-counter').forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) services.push(`${input.getAttribute('data-name')} (x${qty})`);
    });

    if (!phone || !name || !date || !time || !techEmail || services.length === 0) {
        toast("Please complete the form: select a client, at least one service, date, technician, and an available time slot.", 'warning');
        return;
    }

    captureButtonText(btn);
    setButtonLoading(btn, true, editingApptId ? 'Updating...' : 'Booking...');

    try {
        const payload = {
            clientPhone: phone, clientName: name, dateString: date, timeString: time,
            assignedTechEmail: techEmail, assignedTechName: techName,
            bookedService:  services.join(', '),
            bookedDuration: parseInt(duration, 10)    || 0,
            bookedPrice:    parseFloat(subtotal)      || 0,
            grandTotal:     parseFloat(grandTotal)    || 0,
            taxBreakdown:   taxData,
            // Promo fields — empty strings/0 when no promo applied
            promoCode:      document.getElementById('sched_promoCodeVal').value     || '',
            promoId:        document.getElementById('sched_promoId').value          || '',
            discountAmount: parseFloat(document.getElementById('sched_discountAmount').value) || 0,
            originalGrandTotal: parseFloat(document.getElementById('sched_originalGrandTotal').value) || parseFloat(grandTotal) || 0,
            status: 'Scheduled', bookedBy: currentUserEmail,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (editingApptId) {
            await db.collection('Appointments').doc(editingApptId).update(payload);
            toast("Appointment updated successfully.", 'success');
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('Appointments').add(payload);
            toast("Appointment booked successfully.", 'success');
        }
        clearPromoCode();
        cancelEditMode();
    } catch (e) { toast("Error booking: " + e.message, 'error'); }
    finally { setButtonLoading(btn, false); }
};

window.cancelAppointment = async function(id) {
    const ok = await confirm("Are you sure you want to cancel this appointment?");
    if (!ok) return;
    try {
        await db.collection('Appointments').doc(id).update({ status: 'Cancelled' });
        toast("Appointment cancelled.", 'info');
    } catch (e) { toast("Error cancelling appointment.", 'error'); }
};

window.editAppointment = async function(id) {
    try {
        const doc = await db.collection('Appointments').doc(id).get();
        if (!doc.exists) return;
        const appt = doc.data();

        document.getElementById('tab_toggle_schedule').click();
        document.getElementById('sched_phone').value = appt.clientPhone || '';
        document.getElementById('sched_name').value  = appt.clientName  || '';
        document.getElementById('sched_displayName').innerText  = appt.clientName  || 'Unknown';
        document.getElementById('sched_displayPhone').innerText = appt.clientPhone || 'Unknown';
        document.getElementById('sched_search').value = '';
        document.getElementById('sched_searchResults').style.display = 'none';
        document.getElementById('sched_selectedClientDisplay').classList.remove('hidden');

        editingApptId = id;
        const bookBtn = document.getElementById('btnConfirmBooking');
        const textEl  = bookBtn.querySelector('.btn-text');
        if (textEl) textEl.textContent = "Update Appointment";
        document.getElementById('btnCancelEdit').classList.remove('hidden');

        clearAllSelections();

        setTimeout(() => {
            const servicesArr = appt.bookedService.split(', ').map(s => s.trim());
            document.querySelectorAll('.sched-service-item').forEach(cb => {
                if (servicesArr.includes(cb.getAttribute('data-name'))) {
                    cb.checked = true;
                    cb.closest('.service-card')?.classList.add('selected');
                }
            });
            document.querySelectorAll('.sched-service-counter').forEach(input => {
                const name  = input.getAttribute('data-name');
                const match = servicesArr.find(s => s.startsWith(name + ' (x'));
                if (match) {
                    const arr = match.match(/\(x(\d+)\)/);
                    if (arr?.[1]) input.value = parseInt(arr[1]);
                }
            });

            document.getElementById('sched_date').value = appt.dateString;
            document.getElementById('sched_techSelect').value = appt.assignedTechEmail;
            calculateScheduleTotals();

            setTimeout(() => {
                document.querySelectorAll('.time-slot-btn').forEach(btn => {
                    if (btn.getAttribute('data-time') === appt.timeString) selectTimeSlot(appt.timeString, btn);
                });
            }, 500);
        }, 200);
    } catch (e) { toast("Error loading appointment for edit.", 'error'); }
};

window.cancelEditMode = function() {
    editingApptId = null;
    const bookBtn = document.getElementById('btnConfirmBooking');
    const textEl  = bookBtn?.querySelector('.btn-text');
    if (textEl) textEl.textContent = "Confirm & Book Appointment";
    document.getElementById('btnCancelEdit')?.classList.add('hidden');
    window.clearScheduleClient?.();
    ['sched_date','sched_time'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('sched_techSelect').value = '';
    clearAllSelections();
};

window.clearScheduleClient = function() {
    document.getElementById('sched_phone').value = '';
    document.getElementById('sched_name').value  = '';
    document.getElementById('sched_selectedClientDisplay').classList.add('hidden');
};

function startScheduleListener() {
    if (scheduleListener) { scheduleListener(); scheduleListener = null; }
    const listDiv = document.getElementById('upcomingScheduleList');
    scheduleListener = db.collection('Appointments')
        .where('status', 'in', ['Scheduled','Action Required'])
        .onSnapshot(snap => {
            if (snap.empty) { listDiv.innerHTML = '<p class="text-muted">No upcoming appointments scheduled.</p>'; return; }

            let all = [];
            snap.forEach(doc => {
                const a = doc.data();
                if (a.dateString >= todayDateStr || a.status === 'Action Required') all.push({ id: doc.id, ...a });
            });
            all.sort((a, b) => {
                if (a.dateString === b.dateString) return (a.timeString || "").localeCompare(b.timeString || "");
                return (a.dateString || "").localeCompare(b.dateString || "");
            });

            if (all.length === 0) { listDiv.innerHTML = '<p class="text-muted">No upcoming appointments scheduled.</p>'; return; }

            listDiv.innerHTML = all.map(appt => {
                const [hr, min] = (appt.timeString || "00:00").split(':').map(Number);
                const ampm  = hr >= 12 ? 'PM' : 'AM';
                const h12   = hr % 12 || 12;
                const mm    = String(min || 0).padStart(2,'0');
                const amt   = parseFloat(appt.grandTotal || appt.bookedPrice || 0).toFixed(2);
                const isTodayBadge  = appt.dateString === todayDateStr ? '<span class="ticket-badge" style="background:var(--error);">TODAY</span>' : '';
                const actionBadge   = appt.status === 'Action Required' ? '<span class="ticket-badge" style="background:var(--error); margin-left:5px;">RESCHEDULE REQUESTED</span>' : '';
                const borderColor   = appt.status === 'Action Required' ? 'var(--error)' : 'var(--manager)';
                return `
                    <div class="ticket" style="border-color:${borderColor};">
                        <div class="ticket-info">
                            <h4 style="color:var(--manager);">${appt.clientName || 'Unknown'} ${isTodayBadge}${actionBadge}</h4>
                            <p>💅 ${appt.bookedService} (${appt.bookedDuration} mins | ${amt} GHC)</p>
                            <p>📅 ${appt.dateString} at ⏰ ${h12}:${mm} ${ampm} | Tech: ${appt.assignedTechName || 'Unknown'}</p>
                        </div>
                        <div class="ticket-actions">
                            <button class="btn btn-secondary btn-sm btn-auto" onclick="editAppointment('${appt.id}')">Edit</button>
                            <button class="btn btn-secondary btn-sm btn-auto" style="color:var(--error); border-color:var(--error);" onclick="cancelAppointment('${appt.id}')">Cancel</button>
                        </div>
                    </div>`;
            }).join('');
        });
}

// ============================================================
//  CLIENT SEARCH (shared helper — DRY)
// ============================================================

async function _clientSearch(query, resultsDivId, onSelect) {
    const resDiv = document.getElementById(resultsDivId);
    if (!resDiv) return;
    const val = query.toLowerCase().trim();
    if (val.length < 2) { resDiv.style.display = 'none'; return; }

    if (allClientsCache.length === 0) {
        if (isFetchingClients) return;
        isFetchingClients = true;
        resDiv.innerHTML = '<div style="padding:10px; color:#888; font-size:0.85rem;">Loading database...</div>';
        resDiv.style.display = 'block';
        try {
            const snap = await db.collection('Clients').get();
            allClientsCache = [];
            snap.forEach(doc => allClientsCache.push(doc.data()));
        } finally { isFetchingClients = false; }
    }

    const matches = allClientsCache.filter(c => {
        const phone = String(c.Tel_Number || "");
        const fname = String(c.Forename  || "").toLowerCase();
        const sname = String(c.Surname   || "").toLowerCase();
        return phone.includes(val) || fname.includes(val) || sname.includes(val);
    });

    resDiv.innerHTML = '';
    if (matches.length > 0) {
        matches.slice(0, 6).forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'search-result-item';
            btn.innerHTML = `<strong>${m.Forename || ''} ${m.Surname || ''}</strong><br><small style="color:var(--manager);">${m.Tel_Number || 'No Phone'}</small>`;
            btn.onmousedown = e => { e.preventDefault(); onSelect(m); resDiv.style.display = 'none'; };
            resDiv.appendChild(btn);
        });
        resDiv.style.display = 'block';
    } else {
        resDiv.innerHTML = '<div style="padding:10px; color:#aaa; font-size:0.85rem;">No client found.</div>';
        resDiv.style.display = 'block';
    }
}

window.liveClientSearchFOH = function() {
    clearTimeout(fohSearchTimeout);
    fohSearchTimeout = setTimeout(() => {
        _clientSearch(document.getElementById('fohSearchPhone')?.value || '', 'foh_searchResults', window.selectClientForFOH);
    }, 300);
};

window.liveClientSearch = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        _clientSearch(document.getElementById('sched_search')?.value || '', 'sched_searchResults', window.selectClientForSchedule);
    }, 300);
};

window.selectClientForSchedule = function(clientData) {
    document.getElementById('sched_phone').value = clientData.Tel_Number || '';
    const fullName = `${clientData.Forename || ''} ${clientData.Surname || ''}`.trim() || 'Unknown Client';
    document.getElementById('sched_name').value = fullName;
    document.getElementById('sched_displayName').innerText  = fullName;
    document.getElementById('sched_displayPhone').innerText = clientData.Tel_Number || 'No Phone';
    document.getElementById('sched_search').value = '';
    document.getElementById('sched_selectedClientDisplay').classList.remove('hidden');
};

window.selectClientForFOH = function(clientData) {
    document.getElementById('f_forename').value = clientData.Forename       || '';
    document.getElementById('f_surname').value  = clientData.Surname        || '';
    document.getElementById('f_tel').value      = clientData.Tel_Number     || '';
    document.getElementById('f_altTel').value   = clientData.Tel_Number_Alt || '';
    document.getElementById('f_gender').value   = clientData.Gender         || '';
    document.getElementById('f_email').value    = clientData.Email          || '';
    document.getElementById('f_dob').value      = clientData.DOB            || '';
    document.getElementById('fohSearchPhone').value = '';
    const msg = document.getElementById('fohSearchMsg');
    msg.innerText = "Client loaded. Update their details and save.";
    msg.style.color = "var(--success)";
};

window.clearFohForm = function() {
    ['f_forename','f_surname','f_tel','f_altTel','f_gender','f_email','f_dob'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
};

window.registerClientOnly = async function() {
    const btn        = document.getElementById('btnRegisterClient');
    const f_forename = document.getElementById('f_forename').value.trim();
    const f_surname  = document.getElementById('f_surname').value.trim();
    const f_tel      = document.getElementById('f_tel').value.replace(/\D/g, '');
    const f_altTel   = document.getElementById('f_altTel').value.replace(/\D/g, '');
    const f_gender   = document.getElementById('f_gender').value;

    if (!f_forename || !f_surname || !f_tel || !f_gender) {
        toast("Please fill in all required fields (*).", 'warning'); return;
    }
    if (f_tel.length !== 10) {
        toast("Primary telephone must be 10 digits.", 'warning'); return;
    }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');

    const clientData = {
        Forename: f_forename, Surname: f_surname,
        Tel_Number: f_tel, Tel_Number_Alt: f_altTel,
        Gender: f_gender,
        Email: document.getElementById('f_email').value.trim(),
        DOB:   document.getElementById('f_dob').value,
        Last_Updated: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("Clients").doc(f_tel).set(clientData, { merge: true });
        const idx = allClientsCache.findIndex(c => c.Tel_Number === f_tel);
        if (idx >= 0) allClientsCache[idx] = clientData; else allClientsCache.push(clientData);

        toast(`${f_forename} ${f_surname} saved. Proceed to Book Appointment to assign a service.`, 'success', 6000);
        window.clearFohForm();
        document.getElementById('fohSearchPhone').value = '';
        document.getElementById('fohSearchMsg').innerText = '';
    } catch (error) {
        toast("Error saving client: " + error.message, 'error');
    } finally { setButtonLoading(btn, false); }
};

// ============================================================
//  FOH PIPELINE LISTENERS
// ============================================================

function startExpectedTodayListener() {
    if (expectedTodayListener) { expectedTodayListener(); expectedTodayListener = null; }
    const listDiv = document.getElementById('expectedTodayList');

    expectedTodayListener = db.collection('Appointments')
        .where('dateString', '==', todayDateStr)
        .onSnapshot(snap => {
            if (snap.empty) { listDiv.innerHTML = '<p class="text-muted">No appointments scheduled for today.</p>'; return; }

            let todays = [];
            snap.forEach(doc => { if (doc.data().status === 'Scheduled') todays.push({ id: doc.id, ...doc.data() }); });
            todays.sort((a,b) => (a.timeString||"").localeCompare(b.timeString||""));

            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            let html = '', validCount = 0;

            todays.forEach(appt => {
                const [hr, min] = (appt.timeString || "00:00").split(':').map(Number);
                const aStart = hr * 60 + (min || 0);
                const aEnd   = aStart + parseInt(appt.bookedDuration || 0);
                if (currentMins > aEnd + 15) return;
                validCount++;

                const ampm = hr >= 12 ? 'PM' : 'AM';
                const h12  = hr % 12 || 12;
                const mm   = String(min || 0).padStart(2, '0');
                const amt  = parseFloat(appt.grandTotal || appt.bookedPrice || 0).toFixed(2);

                html += `
                    <div class="ticket" style="border-color:var(--accent);">
                        <div class="ticket-info">
                            <h4>${appt.clientName || 'Unknown'}</h4>
                            <p>💅 <strong>${appt.bookedService || 'N/A'}</strong></p>
                            <p>⏰ ${h12}:${mm} ${ampm} | Tech: ${appt.assignedTechName || 'Unknown'} | 📞 ${appt.clientPhone || 'N/A'} | ${amt} GHC</p>
                        </div>
                        <div class="ticket-actions">
                            <button class="btn btn-sm btn-auto" onclick="checkInAppointment('${appt.id}', this)">Check-In</button>
                            <button class="btn btn-secondary btn-sm btn-auto" onclick="editAppointment('${appt.id}')">Edit</button>
                            <button class="btn btn-secondary btn-sm btn-auto" style="color:var(--error); border-color:var(--error);" onclick="cancelAppointment('${appt.id}')">Cancel</button>
                            <button class="btn btn-secondary btn-sm btn-auto" style="color:#888; border-color:#ccc;" onclick="markNoShow('${appt.id}')">No Show</button>
                        </div>
                    </div>`;
            });

            listDiv.innerHTML = validCount === 0
                ? '<p class="text-muted">No more appointments expected today.</p>'
                : html;
        });
}

window.markNoShow = async function(id) {
    const ok = await confirm("Mark this appointment as a No Show?");
    if (!ok) return;
    try {
        await db.collection('Appointments').doc(id).update({
            status: 'No Show',
            noShowAt: firebase.firestore.FieldValue.serverTimestamp(),
            noShowBy: currentUserEmail
        });
        toast("Appointment marked as No Show.", 'info');
    } catch (e) { toast("Error updating appointment: " + e.message, 'error'); }
};

window.checkInAppointment = async function(id, triggerEl) {
    // Accept the button element explicitly — global `event` is deprecated
    const btn = (triggerEl instanceof HTMLElement) ? triggerEl : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Routing...'; }
    try {
        const doc  = await db.collection('Appointments').doc(id).get();
        const appt = doc.data();
        await db.collection('Appointments').doc(id).update({ status: 'Arrived' });

        await db.collection("Active_Jobs").add({
            clientPhone: appt.clientPhone, clientName: appt.clientName,
            assignedTechEmail: appt.assignedTechEmail, assignedTechName: appt.assignedTechName,
            bookedService:      appt.bookedService  || "N/A",
            bookedDuration:     parseInt(appt.bookedDuration || 0, 10),
            bookedPrice:        parseFloat(appt.bookedPrice  || 0),
            grandTotal:         parseFloat(appt.grandTotal   || appt.bookedPrice || 0),
            taxBreakdown:       appt.taxBreakdown   || "[]",
            // Promo passthrough — zero/empty when no promo was applied
            promoCode:          appt.promoCode          || '',
            promoId:            appt.promoId            || '',
            discountAmount:     parseFloat(appt.discountAmount     || 0),
            originalGrandTotal: parseFloat(appt.originalGrandTotal || appt.grandTotal || appt.bookedPrice || 0),
            status:         "Waiting",
            fohCreator:     currentUserEmail,
            sourceApptId:   id,
            apptDate:       appt.dateString,
            dateString:     todayDateStr,
            createdAt:      firebase.firestore.FieldValue.serverTimestamp()
        });

        if (GOOGLE_CHAT_WEBHOOK !== "") {
            fetch(GOOGLE_CHAT_WEBHOOK, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: `🛎️ *Client Arrived*\n*Client:* ${appt.clientName}\n*Service:* ${appt.bookedService}\n*Assigned Tech:* ${appt.assignedTechName}\n_Please check your Dashboard._` })
            }).catch(e => console.error(e));
        }
        toast(`${appt.clientName} checked in and routed to ${appt.assignedTechName}!`, 'success');
    } catch (e) {
        toast("Error checking in: " + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Check-In'; }
    }
};

// ============================================================
//  FOH BILLING
// ============================================================

// Track which job id is currently open in the checkout panel (fix 4 & 5)
let _activeCheckoutJobId = null;

function _closeCheckoutPanel() {
    _activeCheckoutJobId = null;
    const panel = document.getElementById('checkoutPanel');
    if (panel) panel.style.display = 'none';
    const method = document.getElementById('checkoutPaymentMethod');
    if (method) method.value = '';
}

function startFohBillingListener() {
    if (fohBillingListener) { fohBillingListener(); fohBillingListener = null; }
    const listDiv = document.getElementById('fohPendingCheckoutList');

    fohBillingListener = db.collection('Active_Jobs')
        .where('status', '==', 'Ready for Payment')
        .onSnapshot(snap => {
            listDiv.innerHTML = '';

            if (snap.empty) {
                listDiv.innerHTML = '<p class="text-muted">No pending checkouts.</p>';
                _closeCheckoutPanel(); // fix 7 & 10: close panel when queue clears
                return;
            }

            // Fix 4 & 7: if the job currently open was closed by another session, close the panel
            const snapIds = new Set();
            snap.forEach(doc => snapIds.add(doc.id));
            if (_activeCheckoutJobId && !snapIds.has(_activeCheckoutJobId)) {
                _closeCheckoutPanel();
            }

            snap.forEach(doc => {
                const job = doc.data();
                const taxes = _parseTaxBreakdown(job.taxBreakdown);

                const subtotal   = parseFloat(job.bookedPrice || 0);
                const grandTotal = parseFloat(job.grandTotal  || job.bookedPrice || 0);
                const discount   = parseFloat(job.discountAmount || 0);
                const original   = parseFloat(job.originalGrandTotal || grandTotal);

                const taxSum   = taxes.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
                const expected = subtotal + taxSum - discount;
                const mismatch = Math.abs(expected - grandTotal) > 0.02;

                const taxLines = taxes.map(t =>
                    `<div class="checkout-row" style="font-size:0.8rem;color:#888;">
                        <span>+ ${t.name} (${parseFloat(t.rate||0).toFixed(1)}%)</span>
                        <span>${parseFloat(t.amount||0).toFixed(2)} GHC</span>
                     </div>`).join('');

                const discountLine = discount > 0
                    ? `<div class="checkout-row" style="color:var(--success);font-weight:700;">
                           <span>🎟 ${job.promoCode || 'Promo'} discount</span>
                           <span>−${discount.toFixed(2)} GHC</span>
                       </div>` : '';

                const mismatchBanner = mismatch
                    ? `<div style="color:var(--error);font-size:0.75rem;margin-top:5px;padding:4px 6px;
                                   background:#fff0f0;border-radius:4px;border:1px solid var(--error);">
                           ⚠ Total mismatch — verify before charging (expected ${expected.toFixed(2)} GHC)
                       </div>` : '';

                const isActive = doc.id === _activeCheckoutJobId;
                const div = document.createElement('div');
                div.className = 'ticket';
                div.style.borderColor = isActive ? 'var(--manager)' : 'var(--success)';
                if (isActive) div.style.background = '#f0f7ff';

                div.innerHTML = `
                    <div class="ticket-info">
                        <h4 class="text-success">${job.clientName || 'Unknown'}</h4>
                        <p style="font-size:0.82rem;color:#666;margin-bottom:6px;">💅 ${job.bookedService || 'N/A'}</p>
                        <div style="background:#f5f5f5;padding:8px 10px;border-radius:4px;font-size:0.875rem;">
                            <div class="checkout-row"><span>Subtotal:</span><strong>${subtotal.toFixed(2)} GHC</strong></div>
                            ${taxLines}
                            ${discountLine}
                            <div class="checkout-row" style="font-weight:700;color:var(--success);
                                 border-top:1px solid #ddd;padding-top:5px;margin-top:4px;">
                                <span>Grand Total:</span><span>${grandTotal.toFixed(2)} GHC</span>
                            </div>
                            ${mismatchBanner}
                        </div>
                    </div>`;

                const checkoutBtn = document.createElement('button');
                checkoutBtn.className = isActive ? 'btn btn-manager btn-auto btn-sm' : 'btn btn-success btn-auto btn-sm';
                checkoutBtn.textContent = isActive ? '▶ In Progress' : 'Checkout';
                checkoutBtn.onclick = () => window.openCheckout(
                    doc.id, job.clientName, job.bookedService,
                    subtotal, taxes, grandTotal, discount, job.promoCode || '', job.promoId || ''
                );
                div.appendChild(checkoutBtn);
                listDiv.appendChild(div);
            });
        });
}

/**
 * Open the checkout panel for a specific job.
 * Fix 9: accepts Numbers + parsed tax array — no raw HTML or untyped strings.
 */
window.openCheckout = function(id, name, services, subtotal, taxes, grandTotal, discountAmt, promoCode, promoId) {
    _activeCheckoutJobId = id;

    document.getElementById('checkoutJobId').value          = id;
    document.getElementById('checkoutClientName').innerText = name     || 'Unknown';
    document.getElementById('checkoutServices').innerText   = services || '';
    document.getElementById('checkoutSubtotal').innerText   = parseFloat(subtotal   || 0).toFixed(2) + ' GHC';
    document.getElementById('checkoutTotal').innerText      = parseFloat(grandTotal || 0).toFixed(2) + ' GHC';
    document.getElementById('checkoutGrandTotalVal').value  = parseFloat(grandTotal || 0).toFixed(2);
    document.getElementById('checkoutPromoIdVal').value     = promoId  || '';
    document.getElementById('checkoutPaymentMethod').value  = '';

    // Tax lines
    const taxListEl = document.getElementById('checkoutTaxList');
    if (taxes && taxes.length > 0) {
        taxListEl.innerHTML = taxes.map(t =>
            `<div class="checkout-row" style="font-size:0.85rem;color:#777;">
                <span>+ ${t.name} (${parseFloat(t.rate||0).toFixed(1)}%)</span>
                <span>${parseFloat(t.amount||0).toFixed(2)} GHC</span>
             </div>`).join('');
        taxListEl.style.display = 'block';
    } else {
        taxListEl.innerHTML = '<div style="color:#aaa;font-size:0.8rem;padding:2px 0;">No taxes applied</div>';
        taxListEl.style.display = 'block';
    }

    // Discount line
    const discountEl = document.getElementById('checkoutDiscountLine');
    const d = parseFloat(discountAmt || 0);
    if (discountEl) {
        if (d > 0) {
            discountEl.innerHTML = `<div class="checkout-row" style="color:var(--success);font-weight:700;">
                <span>🎟 ${promoCode || 'Promo'} discount</span><span>−${d.toFixed(2)} GHC</span></div>`;
            discountEl.style.display = 'block';
        } else {
            discountEl.innerHTML = '';
            discountEl.style.display = 'none';
        }
    }

    const panel = document.getElementById('checkoutPanel');
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.confirmPayment = async function() {
    const btn    = document.getElementById('btnConfirmPayment');
    const id     = document.getElementById('checkoutJobId').value;
    const method = document.getElementById('checkoutPaymentMethod').value;
    // Fix 9: grandTotal stored as toFixed(2) string — always parses cleanly
    const price  = parseFloat(document.getElementById('checkoutGrandTotalVal').value) || 0;
    const name   = document.getElementById('checkoutClientName').innerText || 'Client';

    // Fix 2: guard against empty id (panel was open with no job selected)
    if (!id) {
        toast("No job selected — please click Checkout on a pending job first.", 'error');
        return;
    }
    if (!method) {
        toast("Please select a Payment Method before confirming.", 'warning');
        return;
    }
    if (price <= 0) {
        toast("Grand total is zero — please verify the job before closing.", 'warning');
        return;
    }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Processing...');
    try {
        const batch = db.batch();

        // Close the job
        batch.update(db.collection('Active_Jobs').doc(id), {
            status:        'Closed',
            paymentMethod: method,
            totalGHC:      price,
            grandTotal:    price,
            closedAt:      firebase.firestore.FieldValue.serverTimestamp(),
            closedBy:      currentUserEmail
        });

        // If a promo was used, increment its usedCount atomically
        const promoId = document.getElementById('checkoutPromoIdVal')?.value || '';
        if (promoId) {
            batch.update(db.collection('Promos').doc(promoId), {
                usedCount: firebase.firestore.FieldValue.increment(1)
            });
        }

        await batch.commit();

        const methodIcon = { 'Cash': '💵', 'Card / POS': '💳', 'Mobile Money': '📱' };
        toast(
            `${methodIcon[method] || '✓'} Payment confirmed — ${name} — ${price.toFixed(2)} GHC via ${method}`,
            'success', 7000
        );

        _closeCheckoutPanel();
    } catch (e) {
        toast("Error processing payment: " + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
};

// ============================================================
//  FINANCIAL LISTENERS
// ============================================================

function startFohFinancialListener() {
    if (fohFinancialListener) { fohFinancialListener(); fohFinancialListener = null; }
    fohFinancialListener = db.collection('Active_Jobs')
        .where('status', '==', 'Closed')
        .where('dateString', '==', todayDateStr)
        .onSnapshot(snap => {
            let totalRev = 0, jobCount = 0;
            snap.forEach(doc => { totalRev += parseFloat(doc.data().totalGHC) || 0; jobCount++; });
            document.getElementById('fohDailyRevenue').innerText = totalRev.toFixed(2) + " GHC";
            document.getElementById('fohDailyJobs').innerText    = jobCount;
        });
}

function startTechFinancialListener() {
    if (techFinancialListener) { techFinancialListener(); techFinancialListener = null; }
    techFinancialListener = db.collection('Active_Jobs')
        .where('status', '==', 'Closed')
        .where('dateString', '==', todayDateStr)
        .where('assignedTechEmail', '==', currentUserEmail)
        .onSnapshot(snap => {
            let techRev = 0, serviceCount = 0;
            snap.forEach(doc => { techRev += parseFloat(doc.data().totalGHC) || 0; serviceCount++; });
            document.getElementById('techDailyRevenue').innerText = techRev.toFixed(2) + " GHC";
            document.getElementById('techServiceCount').innerText = serviceCount;
        });
}

function startFohRosterListener() {
    if (fohRosterListener) { fohRosterListener(); fohRosterListener = null; }
    const rosterDiv = document.getElementById('fohRosterList');

    fohRosterListener = db.collection('Attendance')
        .where('date', '==', todayDateStr)
        .onSnapshot(async attendanceSnap => {
            const activeSnap = await db.collection('Active_Jobs').where('status', 'in', ['Waiting','In Progress']).get();
            const busyEmails = [];
            activeSnap.forEach(job => busyEmails.push(job.data().assignedTechEmail));

            const schedSnap  = await db.collection('Appointments')
                .where('dateString', '==', todayDateStr)
                .where('status', '==', 'Scheduled').get();
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            schedSnap.forEach(doc => {
                const a = doc.data();
                const aStart = timeToMins(a.timeString);
                const aEnd   = aStart + parseInt(a.bookedDuration || 0);
                if (currentMins >= aStart && currentMins < aEnd) busyEmails.push(a.assignedTechEmail);
            });

            let html = '';
            attendanceSnap.forEach(doc => {
                const tech = doc.data();
                if (tech.clockOut || !(tech.roleString && (tech.roleString.toLowerCase().includes('tech') || tech.roleString.toLowerCase().includes('test tech')))) return;
                const isBusy = busyEmails.includes(tech.email);
                html += `
                    <div class="roster-item">
                        <strong>${tech.name}</strong>
                        <div class="status-label ${isBusy ? 'busy' : 'available'}">
                            <span class="status-dot ${isBusy ? 'status-busy' : 'status-available'}"></span>
                            ${isBusy ? 'BUSY' : 'AVAILABLE'}
                        </div>
                    </div>`;
            });

            rosterDiv.innerHTML = html || '<p class="text-muted">No Technicians currently on the floor.</p>';
        });
}

// ============================================================
//  REPORT
// ============================================================

window.generateReport = async function() {
    const btn   = document.getElementById('btnGenerateReport');
    const start = document.getElementById('reportStart').value;
    const end   = document.getElementById('reportEnd').value;
    if (!start || !end) { toast("Please select both a Start Date and End Date.", 'warning'); return; }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Running...');
    try {
        const snap = await db.collection('Active_Jobs')
            .where('status', '==', 'Closed')
            .where('dateString', '>=', start)
            .where('dateString', '<=', end).get();

        let totalRev = 0;
        const techStats = {};
        snap.forEach(doc => {
            const job = doc.data();
            totalRev += parseFloat(job.totalGHC) || 0;
            if (job.assignedTechEmail) {
                if (!techStats[job.assignedTechEmail]) techStats[job.assignedTechEmail] = { name: job.assignedTechName || job.assignedTechEmail, count: 0, rev: 0 };
                techStats[job.assignedTechEmail].count++;
                techStats[job.assignedTechEmail].rev += parseFloat(job.totalGHC) || 0;
            }
        });

        document.getElementById('reportTotalRevenue').innerText = totalRev.toFixed(2) + " GHC";
        let tbody = Object.values(techStats)
            .map(t => `<tr><td><strong>${t.name}</strong></td><td style="text-align:center;">${t.count}</td><td style="text-align:right;">${t.rev.toFixed(2)} GHC</td></tr>`)
            .join('');
        if (!tbody) tbody = '<tr><td colspan="3" style="text-align:center;" class="text-muted">No completed services found in this date range.</td></tr>';
        document.getElementById('reportTechBody').innerHTML = tbody;
        document.getElementById('reportResults').style.display = 'block';
    } catch (e) { toast("Error generating report: " + e.message, 'error'); }
    finally { setButtonLoading(btn, false); }
};

// ============================================================
//  TECH QUEUE
// ============================================================

function startTechQueueListener() {
    if (techQueueListener) { techQueueListener(); techQueueListener = null; }
    const queueDiv = document.getElementById('techLiveQueue');

    techQueueListener = db.collection('Active_Jobs')
        .where('assignedTechEmail', '==', currentUserEmail)
        .where('status', 'in', ['Waiting','In Progress'])
        .onSnapshot(snap => {
            if (snap.empty) { queueDiv.innerHTML = '<p class="text-muted">Queue is currently empty.</p>'; return; }
            queueDiv.innerHTML = '';

            snap.forEach(doc => {
                const job = doc.data();
                const div = document.createElement('div');
                div.className = 'ticket';
                div.style.borderColor = job.status === 'Waiting' ? 'var(--accent)' : 'var(--manager)';
                div.innerHTML = `
                    <div class="ticket-info">
                        <h4>${job.clientName}</h4>
                        <span class="ticket-badge" style="background:${job.status === 'Waiting' ? '#f39c12' : 'var(--manager)'}; margin-bottom:6px;">${job.status.toUpperCase()}</span>
                        <p>💅 <strong>${job.bookedService}</strong></p>
                    </div>`;

                const btnWrapper = document.createElement('div');
                btnWrapper.style.cssText = 'width:140px; display:flex; flex-direction:column; gap:5px;';

                if (job.status === 'Waiting') {
                    const b = document.createElement('button');
                    b.className = 'btn btn-sm'; b.textContent = 'Consultation';
                    b.addEventListener('click', () => window.openConsultation(doc.id));
                    btnWrapper.appendChild(b);
                } else {
                    const bEdit = document.createElement('button');
                    bEdit.className = 'btn btn-secondary btn-sm'; bEdit.textContent = 'Edit Record';
                    bEdit.addEventListener('click', () => window.openConsultation(doc.id));

                    const bDone = document.createElement('button');
                    bDone.className = 'btn btn-success btn-sm'; bDone.textContent = 'Complete Job';
                    bDone.addEventListener('click', async () => {
                        bDone.disabled = true;
                        try {
                            await db.collection('Active_Jobs').doc(doc.id).update({ status: 'Ready for Payment' });
                            toast("Job marked as complete.", 'success');
                        } catch (e) { toast("Error: " + e.message, 'error'); bDone.disabled = false; }
                    });
                    btnWrapper.appendChild(bEdit);
                    btnWrapper.appendChild(bDone);
                }

                div.appendChild(btnWrapper);
                queueDiv.appendChild(div);
            });
        });
}

// ============================================================
//  CONSULTATION MODAL
// ============================================================

window.toggleMedNone = function(checkbox) {
    document.querySelectorAll('.med-cb').forEach(cb => { cb.disabled = checkbox.checked; if (checkbox.checked) cb.checked = false; });
};

let _consultOpening = false; // re-entrancy lock

window.openConsultation = async function(id) {
    if (_consultOpening) return;          // prevent double-open race
    _consultOpening = true;

    // Reset state immediately so a failed fetch doesn't leave stale data
    currentConsultJobId   = null;
    currentConsultJobData = null;
    pendingUpsells        = [];

    try {
        const doc = await db.collection('Active_Jobs').doc(id).get();
        if (!doc.exists) {
            toast("This job no longer exists — it may have been closed or reassigned.", 'warning');
            return;
        }
        currentConsultJobData = doc.data();
        currentConsultJobId   = id;
        pendingUpsells = [];

        document.getElementById('consultClientName').innerText    = currentConsultJobData.clientName;
        document.getElementById('consultCurrentTicket').innerText = currentConsultJobData.bookedService;
        document.getElementById('consultProjectedTotal').innerText = parseFloat(currentConsultJobData.grandTotal || currentConsultJobData.bookedPrice || 0).toFixed(2) + ' GHC';
        document.getElementById('consultAddedUpsells').innerHTML  = '';
        document.getElementById('consultUpsellSelect').value = '';

        const cr  = currentConsultJobData.consultationRecord || {};
        const md  = cr.medicalHistory || [];

        document.querySelectorAll('.med-cb').forEach(cb => { cb.checked = md.includes(cb.value); cb.disabled = false; });
        const medNone = document.getElementById('med_none');
        if (medNone) {
            medNone.checked = md.includes("None");
            if (md.includes("None")) document.querySelectorAll('.med-cb').forEach(c => c.disabled = true);
        }

        document.getElementById('med_allergies').value = cr.allergies    || '';
        document.getElementById('med_other').value     = cr.otherMedical || '';
        document.querySelectorAll('input[name="cond_callus"]').forEach(r => r.checked = (r.value === cr.callusLevel));
        document.querySelectorAll('input[name="cond_skin"]').forEach(r   => r.checked = (r.value === cr.skinCondition));
        document.getElementById('cond_notes').value    = cr.visualNotes  || '';
        document.getElementById('consultReassignTech').value = '';

        // Dynamic form
        const cf = cr.customFields || {};
        let dynHtml = '';
        consultTemplate.forEach(q => {
            dynHtml += `<div class="consult-section-title" style="margin-top:20px; font-size:0.9rem;">${q.label}</div><div style="margin-bottom:15px;">`;
            if (q.type === 'text') {
                dynHtml += `<input type="text" id="ans_${q.id}" value="${cf[q.id] || ''}" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:4px;">`;
            } else if (q.type === 'checkbox') {
                const vArr = cf[q.id] || [];
                dynHtml += `<div class="checkbox-grid">${q.options.map(o => `<label><input type="checkbox" class="ans_cb_${q.id}" value="${o}" ${vArr.includes(o)?'checked':''}> ${o}</label>`).join('')}</div>`;
            } else if (q.type === 'radio') {
                const vStr = cf[q.id] || '';
                dynHtml += `<div class="radio-group">${q.options.map(o => `<label><input type="radio" name="ans_rd_${q.id}" value="${o}" ${vStr===o?'checked':''}> ${o}</label>`).join('')}</div>`;
            }
            dynHtml += '</div>';
        });
        const dynDiv = document.getElementById('dynamicConsultForm');
        if (dynDiv) dynDiv.innerHTML = dynHtml;

        const saveBtn = document.getElementById('btnConsultSaveStart');
        if (saveBtn) {
            const textEl = saveBtn.querySelector('.btn-text');
            if (textEl) textEl.textContent = currentConsultJobData.status === 'In Progress' ? "Update Record" : "Save & Start Service";
        }

        document.getElementById('consultationModal').style.display = 'block';
    } catch (e) { toast("Error opening consultation: " + e.message, 'error'); }
    finally { _consultOpening = false; }
};

window.closeConsultation = function() {
    document.getElementById('consultationModal').style.display = 'none';
    currentConsultJobId   = null;
    currentConsultJobData = null;
    pendingUpsells        = [];
    _consultOpening       = false;   // safety release in case lock got stuck
    // Reset save button text for next open
    const saveBtn = document.getElementById('btnConsultSaveStart');
    const textEl  = saveBtn?.querySelector('.btn-text');
    if (textEl) textEl.textContent = 'Save & Start Service';
    setButtonLoading('btnConsultSaveStart', false);
};
window.closeConsult = window.closeConsultation;
window.openConsult  = window.openConsultation;

window.addUpsellToTicket = function() {
    const select = document.getElementById('consultUpsellSelect');
    const sId    = select.value;
    if (!sId) return;
    const sObj = allMenuServicesCache.find(s => s.id === sId);
    if (!sObj) return;

    // Prevent adding the exact same service more than once
    if (pendingUpsells.some(p => p.id === sId)) {
        toast(`"${sObj.name}" is already added to this ticket.`, 'warning');
        select.value = '';
        return;
    }

    pendingUpsells.push(sObj);
    _renderUpsellList();
    select.value = '';
};
window.addUpsell = window.addUpsellToTicket;

window.removeUpsell = function(sId) {
    pendingUpsells = pendingUpsells.filter(p => p.id !== sId);
    _renderUpsellList();
};

function _renderUpsellList() {
    const container = document.getElementById('consultAddedUpsells');
    if (!pendingUpsells.length) {
        container.innerHTML = '';
        // Reset projected total back to original job price
        const base     = parseFloat(currentConsultJobData?.bookedPrice || 0);
        const origGrand = parseFloat(currentConsultJobData?.grandTotal  || currentConsultJobData?.bookedPrice || 0);
        document.getElementById('consultProjectedTotal').innerText = origGrand.toFixed(2) + ' GHC';
        return;
    }
    container.innerHTML = pendingUpsells.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center;
                    padding:6px 10px; background:#f9f9f9; border-radius:4px; margin-top:5px; font-size:0.875rem;">
            <span>+ ${p.name} <span style="color:var(--accent); font-weight:700;">(${parseFloat(p.price).toFixed(2)} GHC)</span></span>
            <button onclick="removeUpsell('${p.id}')"
                    style="background:none; border:none; color:var(--error); cursor:pointer;
                           font-weight:700; font-size:1rem; padding:0 4px; line-height:1;">✕</button>
        </div>`).join('');

    // Recalculate projected total.
    // bookedPrice on the job is the pre-tax base. Upsell prices from the menu
    // are "listed" prices, so _applyTaxes handles inclusive/exclusive correctly.
    let base = parseFloat(currentConsultJobData?.bookedPrice || 0);
    pendingUpsells.forEach(p => base += parseFloat(p.price || 0));
    const { grandTotal: projTotal } = _applyTaxes(base);
    document.getElementById('consultProjectedTotal').innerText = projTotal.toFixed(2) + ' GHC';
}

window.reassignTech = async function() {
    const sel      = document.getElementById('consultReassignTech');
    const techEmail = sel.value;
    const techName  = sel.options[sel.selectedIndex]?.text;
    if (!techEmail) { toast("Please select a Technician to reassign to.", 'warning'); return; }
    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).update({ assignedTechEmail: techEmail, assignedTechName: techName });
        toast(`Ticket reassigned to ${techName}.`, 'success');
        closeConsultation();
    } catch (e) { toast("Error reassigning: " + e.message, 'error'); }
};
window.reassign = window.reassignTech;

window.requestReschedule = async function() {
    const ok = await confirm("Cancel this Active Job and send it back to Front of House to Reschedule?");
    if (!ok) return;
    if (!currentConsultJobId || !currentConsultJobData) return;

    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).delete();

        // Prefer the direct sourceApptId reference; fall back to date+phone query
        if (currentConsultJobData.sourceApptId) {
            try {
                await db.collection('Appointments')
                    .doc(currentConsultJobData.sourceApptId)
                    .update({ status: 'Action Required' });
            } catch (e) { console.warn('Could not update source appointment:', e); }
        } else {
            // Legacy fallback: query by client phone + appointment date
            const lookupDate = currentConsultJobData.apptDate || currentConsultJobData.dateString;
            const snap = await db.collection('Appointments')
                .where('clientPhone', '==', currentConsultJobData.clientPhone)
                .where('dateString',  '==', lookupDate)
                .where('status', 'in', ['Arrived', 'Scheduled'])
                .get();
            if (!snap.empty) {
                await db.collection('Appointments').doc(snap.docs[0].id).update({ status: 'Action Required' });
            }
        }

        toast("Ticket removed. Front of House has been notified.", 'info');
        closeConsultation();
    } catch (e) { toast("Error rescheduling: " + e.message, 'error'); }
};
window.reqReschedule = window.requestReschedule;

window.saveConsultationAndStart = async function() {
    // Guard: should never happen, but protect against stale state
    if (!currentConsultJobId || !currentConsultJobData) {
        toast("No active consultation job. Please close and reopen the form.", 'error');
        return;
    }

    // Validate: medical section must be acknowledged
    const medChecked = document.querySelectorAll('.med-cb:checked').length > 0;
    const noneChecked = document.getElementById('med_none')?.checked;
    if (!medChecked && !noneChecked) {
        toast("Please complete Section II — tick the relevant conditions or confirm 'None of the above'.", 'warning');
        return;
    }

    const btn = document.getElementById('btnConsultSaveStart');
    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');

    let medChecks = [];
    document.querySelectorAll('.med-cb:checked').forEach(cb => medChecks.push(cb.value));
    if (document.getElementById('med_none')?.checked) medChecks = ["None"];

    const cust = {};
    consultTemplate.forEach(q => {
        if (q.type === 'text') {
            cust[q.id] = document.getElementById('ans_' + q.id)?.value || '';
        } else if (q.type === 'checkbox') {
            const a = [];
            document.querySelectorAll('.ans_cb_' + q.id + ':checked').forEach(c => a.push(c.value));
            cust[q.id] = a;
        } else if (q.type === 'radio') {
            cust[q.id] = document.querySelector('input[name="ans_rd_' + q.id + '"]:checked')?.value || '';
        }
    });

    const consultData = {
        medicalHistory: medChecks,
        allergies:    document.getElementById('med_allergies').value.trim(),
        otherMedical: document.getElementById('med_other').value.trim(),
        callusLevel:  document.querySelector('input[name="cond_callus"]:checked')?.value || "Not specified",
        skinCondition:document.querySelector('input[name="cond_skin"]:checked')?.value   || "Not specified",
        visualNotes:  document.getElementById('cond_notes').value.trim(),
        customFields: cust,
        assessedAt:   firebase.firestore.FieldValue.serverTimestamp()
    };

    // Build the new listed total: existing job's grand total + upsell listed prices.
    // grandTotal on the job is what the client was originally quoted (inclusive or not).
    // Upsell prices come from the menu and are also listed prices.
    let listedTotal = parseFloat(currentConsultJobData.grandTotal
                        || currentConsultJobData.bookedPrice || 0);
    let serviceStr  = currentConsultJobData.bookedService || '';
    let dur         = parseInt(currentConsultJobData.bookedDuration || 0, 10);

    pendingUpsells.forEach(p => {
        listedTotal += parseFloat(p.price || 0);
        dur         += parseInt(p.duration || 0);
        serviceStr  += `, ${p.name}`;
    });

    const { basePrice: taxedBase, grandTotal: newGrand, taxLines } = _applyTaxes(listedTotal);
    const newTaxArr = taxLines.map(l => ({ name: l.name, rate: l.rate, amount: l.amount }));

    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).update({
            status:             'In Progress',
            consultationRecord: consultData,
            bookedPrice:        taxedBase,            // pre-tax subtotal
            bookedService:      serviceStr,
            bookedDuration:     dur,
            taxBreakdown:       JSON.stringify(newTaxArr),
            grandTotal:         newGrand,             // what the client pays
            lastSavedAt:        firebase.firestore.FieldValue.serverTimestamp(),
            lastSavedBy:        currentUserEmail
        });
        toast("Consultation saved. Service started.", 'success');
        closeConsultation();
    } catch (e) { toast("Error saving consultation: " + e.message, 'error'); }
    finally { setButtonLoading(btn, false); }
};
window.saveConsult = window.saveConsultationAndStart;

// ============================================================
//  CONSULTATION FORM BUILDER
// ============================================================

function startConsultTemplateListener() {
    db.collection('Settings').doc('consultation').onSnapshot(d => {
        consultTemplate = (d.exists && d.data().fields) ? d.data().fields : [];
        renderFormBuilderUI();
    });
}

window.addConsultQuestion = async function() {
    const btn  = document.querySelector('[onclick="addConsultQuestion()"]');
    const lbl  = document.getElementById('bld_label').value.trim();
    const typ  = document.getElementById('bld_type').value;
    const opts = document.getElementById('bld_opts').value.split(',').map(s => s.trim()).filter(Boolean);

    if (!lbl) { toast("A question label is required.", 'warning'); return; }
    if (typ !== 'text' && !opts.length) { toast("Options are required for this answer type.", 'warning'); return; }

    if (btn) { captureButtonText(btn); setButtonLoading(btn, true, 'Saving...'); }
    const updated = [...consultTemplate, { id: 'q_' + Date.now(), label: lbl, type: typ, options: opts }];
    try {
        await db.collection('Settings').doc('consultation').set({ fields: updated }, { merge: true });
        document.getElementById('bld_label').value = '';
        document.getElementById('bld_opts').value  = '';
        toast("Question added to template.", 'success');
    } catch (e) { toast("Error saving question: " + e.message, 'error'); }
    finally { if (btn) setButtonLoading(btn, false); }
};

window.deleteConsultQuestion = async function(id) {
    const ok = await confirm("Remove this question from the template?");
    if (!ok) return;
    try {
        await db.collection('Settings').doc('consultation')
            .set({ fields: consultTemplate.filter(q => q.id !== id) }, { merge: true });
        toast("Question removed.", 'info');
    } catch (e) { toast("Error removing question.", 'error'); }
};

function renderFormBuilderUI() {
    const el = document.getElementById('consultBuilderList');
    if (!el) return;
    el.innerHTML = consultTemplate.length
        ? consultTemplate.map(q => `
            <div class="form-builder-item">
                <div class="form-builder-item-label">
                    <strong>${q.label}</strong>
                    <span class="form-builder-item-type">${q.type.toUpperCase()}</span>
                    ${q.type !== 'text' ? `<div class="form-builder-item-opts">Options: ${q.options.join(', ')}</div>` : ''}
                </div>
                <button class="btn btn-error btn-sm btn-auto" onclick="deleteConsultQuestion('${q.id}')">Remove</button>
            </div>`).join('')
        : '<p class="text-muted">No custom questions configured.</p>';
}

// ============================================================
//  ADMIN: STAFF DIRECTORY
//  FIX: unsubscribes previous listener before creating a new one
// ============================================================

window.loadStaffDirectory = function() {
    // Unsubscribe existing listener to prevent leaks & duplicate renders
    if (staffDirectoryListener) { staffDirectoryListener(); staffDirectoryListener = null; }

    const listDiv = document.getElementById('adminStaffList');
    if (!listDiv) return;
    listDiv.innerHTML = '<p style="font-weight:600;">Loading directory... Please wait.</p>';

    staffDirectoryListener = db.collection('Users').onSnapshot(snap => {
        if (snap.empty) { listDiv.innerHTML = '<p class="text-muted">No staff found.</p>'; return; }

        const table  = document.createElement('table');
        table.className = 'breakdown-table';
        table.style.marginTop = '0';
        table.innerHTML = '<thead><tr><th>Name</th><th>Google Email</th><th>Departments</th><th style="text-align:center;">Action</th></tr></thead>';
        const tbody = document.createElement('tbody');

        snap.forEach(doc => {
            try {
                const data = doc.data() || {};
                const name  = data.name ? String(data.name).replace(/['"]/g, "") : "Unknown";
                const email = doc.id;

                let rolesArr = [];
                if (Array.isArray(data.roles))             rolesArr = data.roles;
                else if (typeof data.roles === 'string')   rolesArr = [data.roles];
                else if (typeof data.role  === 'string')   rolesArr = [data.role];

                const validRoles = rolesArr.filter(Boolean);
                const rolesStr   = validRoles.join(',');
                const tagsHtml   = validRoles.map(r => {
                    const rl = r.toLowerCase();
                    const c  = rl.includes('admin')   ? 'var(--admin)'   :
                               rl === 'manager'       ? 'var(--manager)' :
                               rl === 'supply chain'  ? 'var(--supply)'  :
                               rl === 'foh'           ? 'var(--error)'   : 'var(--primary)';
                    return `<span class="ticket-badge" style="background:${c}; margin-right:4px; margin-bottom:3px; display:inline-block;">${r}</span>`;
                }).join('');

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${name}</strong></td>
                    <td style="color:#777;">${email}</td>
                    <td>${tagsHtml}</td>
                    <td style="text-align:center;">
                        <div style="display:flex; gap:5px; justify-content:center;">
                            <button class="btn btn-sm btn-auto" onclick="editStaff('${email}','${name.replace(/'/g,"\\'")}','${rolesStr}')">Edit</button>
                            <button class="btn btn-secondary btn-sm btn-auto" style="color:var(--error); border-color:var(--error);" onclick="removeStaffAccount('${email}')">Del</button>
                        </div>
                    </td>`;
                tbody.appendChild(tr);
            } catch (err) { console.warn("Skipped corrupted user:", doc.id); }
        });

        table.appendChild(tbody);
        listDiv.innerHTML = '';
        listDiv.appendChild(table);
    }, error => {
        listDiv.innerHTML = `<div style="background:#ffebee; padding:15px; border:1px solid var(--error); border-radius:6px; color:var(--error);"><strong>Database Error!</strong><br>${error.message}</div>`;
    });
};

window.editStaff = function(email, name, rolesStr) {
    document.getElementById('admin_newEmail').value = email;
    document.getElementById('admin_newName').value  = name;
    document.getElementById('admin_newPassword').value = '';
    document.getElementById('admin_newPassword').placeholder = "(Leave blank to keep current password)";
    const safeRoles = rolesStr.toLowerCase().split(',');
    document.querySelectorAll('.role-checkbox').forEach(cb => { cb.checked = safeRoles.includes(cb.value.toLowerCase()); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.addStaffAccount = async function() {
    const btn           = document.getElementById('btnSaveStaffAccount');
    const name          = document.getElementById('admin_newName').value.trim();
    const email         = document.getElementById('admin_newEmail').value.trim().toLowerCase();
    const password      = document.getElementById('admin_newPassword').value;
    const selectedRoles = Array.from(document.querySelectorAll('.role-checkbox:checked')).map(cb => cb.value);

    if (!name || !email || selectedRoles.length === 0) {
        toast("Please fill all required fields and select at least one department.", 'warning');
        return;
    }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');
    let authUserCreated = false;

    try {
        if (password) {
            try {
                await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
                authUserCreated = true;
                await secondaryApp.auth().signOut();
            } catch (authError) {
                if (authError.code !== 'auth/email-already-in-use') {
                    toast(`Failed to create login credential.\n${authError.message}`, 'error');
                    return;
                }
            }
        }

        try {
            await db.collection('Users').doc(email).set({
                name, roles: selectedRoles,
                updatedBy: currentUserEmail,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (dbError) {
            // Rollback: if we just created the auth user but Firestore failed, warn the admin
            if (authUserCreated) {
                toast(`Database error. Auth account was created but profile save failed. Please re-save. (${dbError.message})`, 'error', 8000);
            } else {
                toast("Database Error: " + dbError.message, 'error');
            }
            return;
        }

        toast(`Staff profile updated for ${name}.`, 'success');
        document.getElementById('admin_newName').value  = '';
        document.getElementById('admin_newEmail').value = '';
        document.getElementById('admin_newPassword').value = '';
        document.getElementById('admin_newPassword').placeholder = "(Optional) Min 6 chars";
        document.querySelectorAll('.role-checkbox').forEach(cb => cb.checked = false);
        fetchAllTechs();
    } finally { setButtonLoading(btn, false); }
};

window.removeStaffAccount = async function(email) {
    if (email === currentUserEmail) { toast("You cannot revoke your own admin access.", 'warning'); return; }
    const ok = await confirm(`Permanently revoke system access for <strong>${email}</strong>?`);
    if (!ok) return;
    try {
        await db.collection('Users').doc(email).delete();
        toast("Access revoked.", 'info');
        fetchAllTechs();
    } catch (e) { toast("Error revoking access: " + e.message, 'error'); }
};

// ============================================================
//  ADVANCED MENU FORM
// ============================================================

window.clearAdvForm = function() {
    ['adv_name','adv_duration','adv_price','adv_desc','adv_section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const defaults = { adv_category:'Hand Therapy', adv_pricing_type:'Fixed', adv_status:'Active', adv_applies_to:'Hand', adv_selection:'Single', adv_tag:'None' };
    Object.entries(defaults).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
    updateAdvForm();
};

window.updateAdvForm = function() {
    const category  = document.getElementById('adv_category')?.value || 'Hand Therapy';
    const typeSelect = document.getElementById('adv_type');
    const appliesTo  = document.getElementById('adv_applies_to');
    const selection  = document.getElementById('adv_selection');
    if (!typeSelect) return;
    if (category === 'Add-On') {
        typeSelect.innerHTML = '<option value="Add-On">Add-On / Upgrade</option>';
        if (appliesTo) appliesTo.value = 'Both';
        if (selection) selection.value = 'Multi';
    } else {
        typeSelect.innerHTML = '<option value="Main Therapy">Main Therapy (Single Select)</option>';
    }
};

window.addNewMenuServiceAdv = async function() {
    const btn = document.getElementById('btnSaveServiceConfig');
    const payload = {
        category:    document.getElementById('adv_category')?.value    || '',
        type:        document.getElementById('adv_type')?.value        || '',
        name:        document.getElementById('adv_name')?.value.trim() || '',
        duration:    parseInt(document.getElementById('adv_duration')?.value  || '0', 10),
        price:       parseFloat(document.getElementById('adv_price')?.value   || '0'),
        pricingType: document.getElementById('adv_pricing_type')?.value || 'Fixed',
        status:      document.getElementById('adv_status')?.value      || 'Active',
        description: document.getElementById('adv_desc')?.value.trim() || '',
        appliesTo:   document.getElementById('adv_applies_to')?.value  || 'Hand',
        selection:   document.getElementById('adv_selection')?.value   || 'Single',
        section:     document.getElementById('adv_section')?.value.trim() || '',
        tag:         document.getElementById('adv_tag')?.value         || 'None',
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!payload.name)                        { toast('Enter a service name.', 'warning'); return; }
    if (!payload.duration || payload.duration < 0) { toast('Enter a valid duration.', 'warning'); return; }
    if (isNaN(payload.price) || payload.price < 0) { toast('Enter a valid price.', 'warning'); return; }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');
    try {
        await db.collection('Menu_Services').add(payload);
        clearAdvForm();
        toast('Service configuration saved.', 'success');
    } catch (e) { toast('Error saving service configuration.', 'error'); }
    finally { setButtonLoading(btn, false); }
};

// ============================================================
//  CLIENT HISTORY — CRM PANEL
//  Queries: Active_Jobs (status=Closed, clientPhone)
//  Shows:   visits, services, spend, avg, last consultation
// ============================================================

let _histSearchTimeout = null;
let _histCurrentPhone  = null;   // phone of the client currently displayed

/** Search input handler — reuses the shared _clientSearch helper */
window.liveClientSearchHistory = function() {
    clearTimeout(_histSearchTimeout);
    _histSearchTimeout = setTimeout(() => {
        _clientSearch(
            document.getElementById('hist_search')?.value || '',
            'hist_searchResults',
            window.loadClientHistory
        );
    }, 300);
};

/**
 * Load and render the full history for a client.
 * Called either directly or via the search result click.
 * @param {Object} clientData  — from allClientsCache  { Forename, Surname, Tel_Number, … }
 */
window.loadClientHistory = async function(clientData) {
    const phone = clientData.Tel_Number || '';
    if (!phone) { toast("Client has no phone number on record.", 'warning'); return; }

    _histCurrentPhone = phone;

    // Show the client header with profile data immediately
    const fullName = `${clientData.Forename || ''} ${clientData.Surname || ''}`.trim() || 'Unknown';
    document.getElementById('hist_search').value = fullName;
    document.getElementById('hist_searchResults').style.display = 'none';

    _histShowState('loading');

    // Populate header fields
    document.getElementById('hist_clientName').textContent   = fullName;
    document.getElementById('hist_clientPhone').textContent  = `📞 ${phone}`;
    document.getElementById('hist_clientGender').textContent = clientData.Gender  ? `👤 ${clientData.Gender}`  : '';
    document.getElementById('hist_clientEmail').textContent  = clientData.Email   ? `✉ ${clientData.Email}`   : '';

    // Format DOB nicely if present
    if (clientData.DOB) {
        try {
            const dob = new Date(clientData.DOB + 'T00:00:00');
            document.getElementById('hist_clientDob').textContent =
                `🎂 ${dob.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;
        } catch { document.getElementById('hist_clientDob').textContent = ''; }
    } else {
        document.getElementById('hist_clientDob').textContent = '';
    }

    document.getElementById('hist_clientHeader').classList.remove('hidden');

    try {
        // Single query: all closed jobs for this phone, ordered newest first
        const snap = await db.collection('Active_Jobs')
            .where('clientPhone', '==', phone)
            .where('status', '==', 'Closed')
            .orderBy('closedAt', 'desc')
            .get();

        if (snap.empty) { _histShowState('empty'); return; }

        const visits = [];
        snap.forEach(doc => visits.push({ id: doc.id, ...doc.data() }));

        _histRenderKPIs(visits);
        _histRenderVisitList(visits);
        _histShowState('results');

    } catch (e) {
        // Firestore requires a composite index for where + orderBy on different fields.
        // If the index hasn't been created yet, fall back to client-side sort.
        if (e.code === 'failed-precondition' || e.message.includes('index')) {
            try {
                const snap2 = await db.collection('Active_Jobs')
                    .where('clientPhone', '==', phone)
                    .where('status', '==', 'Closed')
                    .get();

                if (snap2.empty) { _histShowState('empty'); return; }

                const visits = [];
                snap2.forEach(doc => visits.push({ id: doc.id, ...doc.data() }));

                // Client-side sort by closedAt descending
                visits.sort((a, b) => {
                    const tA = a.closedAt?.toDate?.()?.getTime() || 0;
                    const tB = b.closedAt?.toDate?.()?.getTime() || 0;
                    return tB - tA;
                });

                _histRenderKPIs(visits);
                _histRenderVisitList(visits);
                _histShowState('results');
            } catch (e2) {
                _histShowState('empty');
                toast("Error loading history: " + e2.message, 'error');
            }
        } else {
            _histShowState('empty');
            toast("Error loading history: " + e.message, 'error');
        }
    }
};

/** Show/hide the correct state element in the history panel */
function _histShowState(state) {
    document.getElementById('hist_loading').classList.toggle('hidden', state !== 'loading');
    document.getElementById('hist_empty').classList.toggle('hidden',   state !== 'empty');
    document.getElementById('hist_visitList').style.display = state === 'results' ? 'block' : 'none';
}

/** Calculate and render the 4 KPI chips in the client header */
function _histRenderKPIs(visits) {
    const totalSpend = visits.reduce((s, v) => s + (parseFloat(v.totalGHC || v.grandTotal || 0)), 0);
    const avgSpend   = visits.length ? totalSpend / visits.length : 0;

    // Last visit date
    let lastVisitStr = '—';
    const latestVisit = visits.find(v => v.closedAt);
    if (latestVisit?.closedAt) {
        try {
            const d = latestVisit.closedAt.toDate();
            lastVisitStr = d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' });
        } catch { lastVisitStr = latestVisit.dateString || '—'; }
    }

    document.getElementById('hist_kpiVisits').textContent = visits.length;
    document.getElementById('hist_kpiSpend').textContent  = totalSpend.toFixed(2) + ' ₵';
    document.getElementById('hist_kpiAvg').textContent    = avgSpend.toFixed(2)   + ' ₵';
    document.getElementById('hist_kpiLast').textContent   = lastVisitStr;
}

/** Render each visit as an expandable card */
function _histRenderVisitList(visits) {
    const container = document.getElementById('hist_visitList');

    container.innerHTML = visits.map((v, i) => {
        // Date display
        let dateStr = v.dateString || '—';
        if (v.closedAt) {
            try {
                const d = v.closedAt.toDate();
                dateStr = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
            } catch { /* keep dateString */ }
        }

        const amount  = parseFloat(v.totalGHC || v.grandTotal || 0).toFixed(2);
        const method  = v.paymentMethod || '—';
        const tech    = v.assignedTechName || '—';
        const service = v.bookedService || 'N/A';
        const dur     = v.bookedDuration ? `${v.bookedDuration} mins` : '';

        // Payment method icon
        const mIcon = { 'Cash':'💵', 'Card / POS':'💳', 'Mobile Money':'📱' };

        // Consultation notes block — only if a record exists
        const cr = v.consultationRecord;
        let consultHtml = '';
        if (cr) {
            const medList = Array.isArray(cr.medicalHistory) && cr.medicalHistory.length
                ? (cr.medicalHistory[0] === 'None' ? 'None declared' : cr.medicalHistory.join(', '))
                : '—';
            const callusLabel  = cr.callusLevel   || '—';
            const skinLabel    = cr.skinCondition || '—';
            const notes        = cr.visualNotes   || '';
            const allergies    = cr.allergies     || '';

            consultHtml = `
                <div style="margin-top:14px; padding-top:14px; border-top:1px dashed var(--border);">
                    <div style="font-size:0.72rem; font-weight:700; text-transform:uppercase;
                                letter-spacing:1.5px; color:var(--accent); margin-bottom:10px;">
                        Last Consultation Notes
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
                                gap:10px; font-size:0.85rem;">
                        <div>
                            <span style="color:#888; font-size:0.75rem; display:block;
                                         text-transform:uppercase; letter-spacing:0.5px;">Medical</span>
                            <strong>${_safeText(medList)}</strong>
                        </div>
                        ${allergies ? `<div>
                            <span style="color:#888; font-size:0.75rem; display:block;
                                         text-transform:uppercase; letter-spacing:0.5px;">Allergies</span>
                            <strong>${_safeText(allergies)}</strong>
                        </div>` : ''}
                        <div>
                            <span style="color:#888; font-size:0.75rem; display:block;
                                         text-transform:uppercase; letter-spacing:0.5px;">Callus</span>
                            <strong>${_safeText(callusLabel)}</strong>
                        </div>
                        <div>
                            <span style="color:#888; font-size:0.75rem; display:block;
                                         text-transform:uppercase; letter-spacing:0.5px;">Skin</span>
                            <strong>${_safeText(skinLabel)}</strong>
                        </div>
                    </div>
                    ${notes ? `<div style="margin-top:10px; padding:10px 12px; background:#fafafa;
                                           border-left:3px solid var(--accent); border-radius:0 4px 4px 0;
                                           font-size:0.85rem; color:#555; line-height:1.5;">
                        "${_safeText(notes)}"
                    </div>` : ''}
                </div>`;
        }

        // Tax breakdown tooltip
        const taxes = _parseTaxBreakdown(v.taxBreakdown);
        const taxDetail = taxes.length
            ? taxes.map(t =>
                `<span style="color:#888; font-size:0.78rem;">
                    + ${_safeText(t.name)} ${parseFloat(t.amount||0).toFixed(2)} ₵
                </span>`).join('&nbsp;&nbsp;')
            : '';

        return `
            <div style="border:1px solid var(--border); border-radius:var(--radius);
                        margin-bottom:12px; overflow:hidden; background:white;
                        box-shadow:var(--shadow-sm); transition:box-shadow 0.2s;"
                 onmouseenter="this.style.boxShadow='var(--shadow-md)'"
                 onmouseleave="this.style.boxShadow='var(--shadow-sm)'">

                <!-- Visit header row — always visible -->
                <div style="display:flex; justify-content:space-between; align-items:center;
                            padding:14px 18px; cursor:pointer; user-select:none;"
                     onclick="_histToggleCard(${i})">
                    <div style="flex-grow:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <span style="font-size:0.8rem; font-weight:700; color:white;
                                         background:var(--primary); padding:2px 8px;
                                         border-radius:4px; white-space:nowrap;">
                                #${visits.length - i}
                            </span>
                            <span style="font-weight:700; color:var(--primary); font-size:0.95rem;">
                                ${dateStr}
                            </span>
                            <span style="font-size:0.8rem; color:#777;">
                                👩‍🔧 ${_safeText(tech)}
                            </span>
                        </div>
                        <div style="margin-top:5px; font-size:0.85rem; color:#555;
                                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                                    max-width:420px;">
                            💅 ${_safeText(service)}${dur ? ` <span style="color:#aaa;">(${dur})</span>` : ''}
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0; margin-left:16px;">
                        <div style="font-size:1.15rem; font-weight:700; color:var(--success);">
                            ${amount} ₵
                        </div>
                        <div style="font-size:0.78rem; color:#999; margin-top:2px;">
                            ${mIcon[method] || '💰'} ${_safeText(method)}
                        </div>
                        ${taxDetail ? `<div style="margin-top:3px;">${taxDetail}</div>` : ''}
                    </div>
                    <div style="margin-left:14px; color:#bbb; font-size:0.85rem;"
                         id="hist_chevron_${i}">▼</div>
                </div>

                <!-- Expandable detail — hidden by default, only first card open -->
                <div id="hist_detail_${i}"
                     style="display:${i === 0 ? 'block' : 'none'};
                            padding:0 18px 18px 18px; border-top:1px solid #f0f0f0;">
                    ${consultHtml ||
                        `<p style="color:#bbb; font-size:0.85rem; padding-top:14px;
                                   font-style:italic;">No consultation record for this visit.</p>`}
                </div>
            </div>`;
    }).join('');
}

/** Toggle expand/collapse on a visit card */
window._histToggleCard = function(i) {
    const detail   = document.getElementById(`hist_detail_${i}`);
    const chevron  = document.getElementById(`hist_chevron_${i}`);
    if (!detail) return;
    const isOpen   = detail.style.display !== 'none';
    detail.style.display  = isOpen ? 'none' : 'block';
    if (chevron) chevron.textContent = isOpen ? '▼' : '▲';
};

/** Escape user-supplied text before inserting into innerHTML */
function _safeText(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ============================================================
//  PROMO / COUPON ENGINE
//  Collection: Promos  { code, type, value, minSpend,
//                        maxUses, usedCount, expiresAt,
//                        active, description, createdBy }
// ============================================================

// ── Booking-form helpers ─────────────────────────────────────

function _showPromoStatus(msg, success) {
    const el = document.getElementById('sched_promoStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = success ? 'var(--success)' : 'var(--error)';
    el.style.display = 'block';
}

function _syncPromoHiddenInputs(originalGrandTotal, discountAmount) {
    const codeEl    = document.getElementById('sched_promoCodeVal');
    const idEl      = document.getElementById('sched_promoId');
    const discEl    = document.getElementById('sched_discountAmount');
    const origEl    = document.getElementById('sched_originalGrandTotal');
    if (codeEl)  codeEl.value  = _activePromo ? _activePromo.code : '';
    if (idEl)    idEl.value    = _activePromo ? _activePromo.id   : '';
    if (discEl)  discEl.value  = discountAmount;
    if (origEl)  origEl.value  = originalGrandTotal;
}

window.applyPromoCode = async function() {
    const btn       = document.getElementById('btnApplyPromo');
    const codeInput = document.getElementById('sched_promoCode');
    const code      = (codeInput?.value || '').trim().toUpperCase();

    if (!code) { toast('Enter a promo code first.', 'warning'); return; }

    // Must have at least one service selected to validate minimum spend
    const currentTotal = parseFloat(document.getElementById('sched_grandTotalVal')?.value || 0);

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Checking...');

    try {
        const snap = await db.collection('Promos')
            .where('code', '==', code)
            .where('active', '==', true)
            .limit(1)
            .get();

        if (snap.empty) {
            _showPromoStatus('Code not found or no longer active.', false);
            setButtonLoading(btn, false);
            return;
        }

        const doc   = snap.docs[0];
        const promo = doc.data();

        // Expiry check
        if (promo.expiresAt) {
            const expires = promo.expiresAt.toDate ? promo.expiresAt.toDate() : new Date(promo.expiresAt);
            if (expires < new Date()) {
                _showPromoStatus('This code has expired.', false);
                setButtonLoading(btn, false);
                return;
            }
        }

        // Usage limit check
        if (promo.maxUses && promo.usedCount >= promo.maxUses) {
            _showPromoStatus('This code has reached its usage limit.', false);
            setButtonLoading(btn, false);
            return;
        }

        // Minimum spend check — only if services are selected
        const minSpend = parseFloat(promo.minSpend || 0);
        if (minSpend > 0 && currentTotal > 0 && currentTotal < minSpend) {
            _showPromoStatus(`Minimum spend of ${minSpend.toFixed(2)} GHC required.`, false);
            setButtonLoading(btn, false);
            return;
        }

        // Valid — store and recalculate
        _activePromo = {
            id:    doc.id,
            code:  promo.code,
            type:  promo.type,
            value: parseFloat(promo.value || 0),
            minSpend,
        };

        const discLabel = promo.type === 'percent'
            ? `${promo.value}% off`
            : `${parseFloat(promo.value).toFixed(2)} GHC off`;

        _showPromoStatus(`✓ "${promo.description || code}" applied — ${discLabel}`, true);

        // Show clear button, hide apply
        document.getElementById('btnApplyPromo').classList.add('hidden');
        document.getElementById('btnClearPromo').classList.remove('hidden');

        calculateScheduleTotals();
    } catch (e) {
        toast('Error checking code: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
};

window.clearPromoCode = function() {
    _activePromo = null;
    const codeInput = document.getElementById('sched_promoCode');
    if (codeInput) codeInput.value = '';
    const statusEl = document.getElementById('sched_promoStatus');
    if (statusEl) statusEl.style.display = 'none';
    document.getElementById('btnApplyPromo')?.classList.remove('hidden');
    document.getElementById('btnClearPromo')?.classList.add('hidden');
    _syncPromoHiddenInputs(0, 0);
    calculateScheduleTotals();
};

// ── Promo Management tab ─────────────────────────────────────

window.togglePromoValueLabel = function() {
    const type  = document.getElementById('promo_type')?.value;
    const label = document.getElementById('promo_value_label');
    if (label) label.innerHTML = type === 'percent'
        ? 'Discount Value (%) <span class="required-star">*</span>'
        : 'Discount Amount (GHC) <span class="required-star">*</span>';
};

window.generatePromoCode = function() {
    const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const array  = new Uint8Array(6);
    crypto.getRandomValues(array);
    const code   = Array.from(array, b => chars[b % chars.length]).join('');
    const input  = document.getElementById('promo_code');
    if (input) { input.value = code; input.focus(); }
};

window.clearPromoForm = function() {
    ['promo_code','promo_desc','promo_value','promo_min_spend',
     'promo_max_uses','promo_expires'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = id === 'promo_min_spend' ? '0' : '';
    });
    const typeEl = document.getElementById('promo_type');
    if (typeEl) typeEl.value = 'percent';
    const activeEl = document.getElementById('promo_active');
    if (activeEl) activeEl.value = 'true';
    togglePromoValueLabel();
    const saveBtn = document.getElementById('btnSavePromo');
    if (saveBtn) {
        saveBtn.dataset.editId = '';
        const t = saveBtn.querySelector('.btn-text');
        if (t) t.textContent = 'Save Promo Code';
    }
};

window.savePromo = async function() {
    const btn      = document.getElementById('btnSavePromo');
    const code     = (document.getElementById('promo_code')?.value || '').trim().toUpperCase();
    const desc     = document.getElementById('promo_desc')?.value.trim() || '';
    const type     = document.getElementById('promo_type')?.value || 'percent';
    const value    = parseFloat(document.getElementById('promo_value')?.value || 0);
    const minSpend = parseFloat(document.getElementById('promo_min_spend')?.value || 0);
    const maxUsesRaw = document.getElementById('promo_max_uses')?.value.trim();
    const maxUses  = maxUsesRaw ? parseInt(maxUsesRaw) : null;
    const expiresRaw = document.getElementById('promo_expires')?.value;
    const active   = document.getElementById('promo_active')?.value === 'true';
    const editId   = btn?.dataset.editId || '';

    if (!code)             { toast('A promo code is required.', 'warning'); return; }
    if (isNaN(value) || value <= 0) { toast('Enter a valid discount value greater than zero.', 'warning'); return; }
    if (type === 'percent' && value > 100) { toast('Percentage discount cannot exceed 100%.', 'warning'); return; }

    // Code uniqueness check on new saves
    if (!editId) {
        const existing = await db.collection('Promos').where('code', '==', code).limit(1).get();
        if (!existing.empty) { toast(`Code "${code}" already exists. Edit or deactivate the existing one.`, 'warning'); return; }
    }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Saving...');

    const payload = {
        code, description: desc, type, value,
        minSpend: minSpend || 0,
        maxUses:  maxUses ?? null,
        expiresAt: expiresRaw
            ? firebase.firestore.Timestamp.fromDate(new Date(expiresRaw + 'T23:59:59'))
            : null,
        active,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUserEmail,
    };

    try {
        if (editId) {
            await db.collection('Promos').doc(editId).update(payload);
            toast(`Promo "${code}" updated.`, 'success');
        } else {
            await db.collection('Promos').add({
                ...payload,
                usedCount: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: currentUserEmail,
            });
            toast(`Promo "${code}" created.`, 'success');
        }
        clearPromoForm();
        loadPromos();
    } catch (e) {
        toast('Error saving promo: ' + e.message, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
};

window.loadPromos = async function() {
    const listEl = document.getElementById('promoList');
    if (!listEl) return;
    listEl.innerHTML = '<p class="text-muted">Loading...</p>';

    try {
        const snap = await db.collection('Promos').orderBy('createdAt', 'desc').get();
        if (snap.empty) {
            listEl.innerHTML = '<p class="text-muted">No promo codes created yet.</p>';
            return;
        }

        const now = new Date();
        let html = `
            <div class="overflow-x">
            <table class="breakdown-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Description</th>
                        <th>Discount</th>
                        <th>Min Spend</th>
                        <th style="text-align:center;">Uses</th>
                        <th>Expiry</th>
                        <th style="text-align:center;">Status</th>
                        <th style="text-align:center;">Actions</th>
                    </tr>
                </thead>
                <tbody>`;

        snap.forEach(doc => {
            const p = doc.data();
            const discLabel = p.type === 'percent'
                ? `${p.value}%`
                : `${parseFloat(p.value).toFixed(2)} GHC`;

            let expiryLabel = '—';
            let isExpired   = false;
            if (p.expiresAt) {
                const d = p.expiresAt.toDate ? p.expiresAt.toDate() : new Date(p.expiresAt);
                expiryLabel = d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' });
                isExpired   = d < now;
            }

            const limitReached = p.maxUses && p.usedCount >= p.maxUses;
            const effectivelyActive = p.active && !isExpired && !limitReached;

            const statusBadge = effectivelyActive
                ? `<span class="ticket-badge" style="background:var(--success);">Active</span>`
                : `<span class="ticket-badge" style="background:#aaa;">${isExpired ? 'Expired' : limitReached ? 'Limit Reached' : 'Inactive'}</span>`;

            const usesLabel = p.maxUses
                ? `${p.usedCount || 0} / ${p.maxUses}`
                : `${p.usedCount || 0}`;

            html += `
                <tr>
                    <td><strong style="letter-spacing:1px;">${_safeText(p.code)}</strong></td>
                    <td style="color:#777;font-size:0.85rem;">${_safeText(p.description || '—')}</td>
                    <td><strong>${discLabel} off</strong></td>
                    <td>${parseFloat(p.minSpend||0) > 0 ? parseFloat(p.minSpend).toFixed(2)+' GHC' : '—'}</td>
                    <td style="text-align:center;">${usesLabel}</td>
                    <td style="font-size:0.85rem;${isExpired?'color:var(--error);':''}">${expiryLabel}</td>
                    <td style="text-align:center;">${statusBadge}</td>
                    <td style="text-align:center;">
                        <div style="display:flex;gap:5px;justify-content:center;">
                            <button class="btn btn-secondary btn-sm btn-auto" onclick="editPromo('${doc.id}')">Edit</button>
                            <button class="btn btn-ghost btn-sm btn-auto" style="color:var(--error);border-color:var(--error);" onclick="togglePromoActive('${doc.id}', ${p.active})">
                                ${p.active ? 'Deactivate' : 'Activate'}
                            </button>
                        </div>
                    </td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error);">Error loading promos: ${e.message}</p>`;
    }
};

window.editPromo = async function(id) {
    try {
        const doc = await db.collection('Promos').doc(id).get();
        if (!doc.exists) return;
        const p = doc.data();

        document.getElementById('promo_code').value      = p.code     || '';
        document.getElementById('promo_desc').value      = p.description || '';
        document.getElementById('promo_type').value      = p.type     || 'percent';
        document.getElementById('promo_value').value     = p.value    || '';
        document.getElementById('promo_min_spend').value = p.minSpend || 0;
        document.getElementById('promo_max_uses').value  = p.maxUses  || '';
        document.getElementById('promo_active').value    = String(p.active !== false);

        if (p.expiresAt) {
            const d = p.expiresAt.toDate ? p.expiresAt.toDate() : new Date(p.expiresAt);
            document.getElementById('promo_expires').value = d.toISOString().split('T')[0];
        } else {
            document.getElementById('promo_expires').value = '';
        }

        togglePromoValueLabel();

        const saveBtn = document.getElementById('btnSavePromo');
        if (saveBtn) {
            saveBtn.dataset.editId = id;
            const t = saveBtn.querySelector('.btn-text');
            if (t) t.textContent = 'Update Promo Code';
        }

        // Scroll to form
        document.getElementById('btnSavePromo')?.closest('.module-box')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast('Error loading promo: ' + e.message, 'error'); }
};

window.togglePromoActive = async function(id, currentActive) {
    const label = currentActive ? 'deactivate' : 'activate';
    const ok = await confirm(`Are you sure you want to ${label} this promo code?`);
    if (!ok) return;
    try {
        await db.collection('Promos').doc(id).update({ active: !currentActive });
        toast(`Promo ${label}d.`, 'info');
        loadPromos();
    } catch (e) { toast('Error updating promo: ' + e.message, 'error'); }
};
