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
let allTechs = [], allClientsCache = [], allMenuServicesCache = [], liveTaxes = [];
let isFetchingClients = false, searchTimeout = null, fohSearchTimeout = null, editingApptId = null;
let currentConsultJobId = null, currentConsultJobData = null, pendingUpsells = [];
let consultTemplate = [];

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
    ['Checkin', 'Schedule', 'Billing', 'Ops'].forEach(x => {
        const el = document.getElementById('subView_' + x);
        if (el) el.style.display = (view.toLowerCase() === x.toLowerCase()) ? 'block' : 'none';
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
        liveTaxes = (doc.exists && doc.data().rates) ? doc.data().rates : [];
        renderTaxConfigUI();
        updatePreviewToggles();
        calculateScheduleTotals();
    });
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
//  SERVICE MENU
// ============================================================

function fetchLiveMenu(hasEditAccess) {
    if (hasEditAccess) {
        ['managerMenuControls', 'seedMenuBtnContainer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
    }

    db.collection('Menu_Services').onSnapshot(snap => {
        const menuContainer = document.getElementById('sched_serviceMenu');
        const adminList     = document.getElementById('menuManagerList');

        if (snap.empty) {
            if (adminList)     adminList.innerHTML     = '<p class="text-muted" style="text-align:center;">Menu database is empty. Manager must initialise.</p>';
            if (menuContainer) menuContainer.innerHTML = '<p class="text-muted" style="text-align:center;">No services available.</p>';
            return;
        }

        let services = [];
        snap.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
        services.sort((a, b) => (a.category || "").localeCompare(b.category || ""));
        allMenuServicesCache = services;

        const uSel = document.getElementById('consultUpsellSelect');
        if (uSel) {
            uSel.innerHTML = '<option value="">Select a service or add-on...</option>';
            allMenuServicesCache.forEach(s => {
                if (s.status === "Active") {
                    uSel.innerHTML += `<option value="${s.id}">${s.name} (${s.price} GHC)</option>`;
                }
            });
        }

        let dbData = { Hand: {}, Foot: {} };
        services.forEach(s => {
            const cat = s.category || "Uncategorized";
            if (s.department === "Both") {
                ['Hand','Foot'].forEach(dept => {
                    if (!dbData[dept][cat]) dbData[dept][cat] = [];
                    dbData[dept][cat].push(s);
                });
            } else {
                const dept = s.department || "Hand";
                if (!dbData[dept]) dbData[dept] = {};
                if (!dbData[dept][cat]) dbData[dept][cat] = [];
                dbData[dept][cat].push(s);
            }
        });

        let bookingHtml = '', adminHtml = '';

        ['Hand', 'Foot'].forEach(dept => {
            const disp = dept === 'Hand' ? 'block' : 'none';
            bookingHtml += `<div id="menu_dept_${dept}" style="display:${disp};">`;
            adminHtml   += `<div id="admin_dept_${dept}" style="display:${disp};">`;

            let col1 = '', col2 = '', adminSecs = '';
            let toggleCol = true;

            const numRegex  = /^(\d+|I{1,3}|IV|V|VI)\./;
            const sortedCats = Object.keys(dbData[dept]).sort((a, b) => {
                const aU = a.trim().toUpperCase(), bU = b.trim().toUpperCase();
                const aNum = numRegex.test(aU), bNum = numRegex.test(bU);
                if (aNum && !bNum) return -1;
                if (!aNum && bNum) return 1;
                return aU.localeCompare(bU, undefined, { numeric: true, sensitivity: 'base' });
            });

            sortedCats.forEach(cat => {
                let hint = '';
                if (dbData[dept][cat].length > 0) {
                    hint = dbData[dept][cat][0].inputType === 'radio'
                        ? "<span class='section-hint'>(SELECT ONE ONLY)</span>"
                        : "<span class='section-hint'>(SELECT ANY / MULTIPLE)</span>";
                }

                let sectionHtml  = `<div class="menu-col"><div class="menu-section-title"><span>${cat}</span>${hint}</div>`;
                let aSectionHtml = `<div class="menu-section-title">${cat}</div><div class="grid-2">`;

                dbData[dept][cat].forEach(s => {
                    const type     = s.inputType || "radio";
                    const safeName = s.name || "Unnamed";
                    const safeDur  = s.duration || 0;
                    const safePrc  = s.price || 0;
                    const descHtml = s.desc ? `<span class="service-desc">${s.desc}</span>` : '';
                    const tagHtml  = (s.tag && s.tag !== "None") ? `<span class="hl-tag">${s.tag}</span>` : '';
                    const priceTag = `<span class="service-price-tag">${safeDur > 0 ? safeDur + ' mins | ' : ''}${safePrc} GHC</span>`;

                    if (type === 'counter') {
                        sectionHtml += `
                            <div class="service-card" style="align-items:center;">
                                <label style="margin-left:0; cursor:default;">
                                    <strong>${safeName} ${tagHtml}</strong>
                                    ${descHtml}
                                    ${priceTag}
                                </label>
                                <div class="counter-box">
                                    <button class="btn btn-secondary btn-sm btn-auto" onclick="updateCounter('${s.id}',-1)">−</button>
                                    <input type="number" id="sched_qty_${s.id}" class="sched-service-counter"
                                        data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}"
                                        value="0" min="0" readonly>
                                    <button class="btn btn-secondary btn-sm btn-auto" onclick="updateCounter('${s.id}',1)">+</button>
                                </div>
                            </div>`;
                    } else {
                        const inputName = type === 'radio' ? `sched_base_${dept}` : `sched_cb_${s.id}`;
                        const inputHtml = type === 'radio'
                            ? `<input type="radio"    name="${inputName}" class="sched-service-item" id="sched_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`
                            : `<input type="checkbox" class="sched-service-item" id="sched_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`;

                        sectionHtml += `
                            <div class="service-card" onclick="toggleServiceCard(event,this,'${s.id}','${type}','${inputName}')">
                                ${inputHtml}
                                <label>
                                    <strong>${safeName} ${tagHtml}</strong>
                                    ${descHtml}
                                    ${priceTag}
                                </label>
                            </div>`;
                    }

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
                                    <button class="btn btn-error  btn-sm btn-auto" onclick="deleteMenuService('${s.id}')">Del</button>
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

                sectionHtml  += '</div>';
                aSectionHtml += '</div>';

                if (toggleCol) col1 += sectionHtml; else col2 += sectionHtml;
                toggleCol = !toggleCol;
                adminSecs += aSectionHtml;
            });

            bookingHtml += `<div class="grid-2" style="align-items:start;">${col1}${col2}</div></div>`;
            adminHtml   += adminSecs + '</div>';
        });

        if (adminList)     adminList.innerHTML     = adminHtml;
        if (menuContainer) menuContainer.innerHTML = bookingHtml;

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
        { dept:"Hand", cat:"I. HAND THERAPIES",        type:"radio",    name:"Youthful Touch (Hand Renewal)", dur:45, prc:220, desc:"", tag:"None" },
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

    // Tax engine
    let totalTaxAmt = 0, taxBreakdownHtml = '', taxDataArr = [];

    if (subtotalCost > 0 && liveTaxes.length > 0) {
        taxBreakdownHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-weight:600; color:#555;"><span>Subtotal:</span><span>${subtotalCost.toFixed(2)} GHC</span></div>`;
        liveTaxes.forEach(t => {
            const tAmt = subtotalCost * (t.rate / 100);
            totalTaxAmt += tAmt;
            taxDataArr.push({ name: t.name, rate: t.rate, amount: tAmt });
            taxBreakdownHtml += `<div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#888; margin-bottom:3px;"><span>+ ${t.name} (${t.rate}%)</span><span>${tAmt.toFixed(2)} GHC</span></div>`;
        });
        const taxEl = document.getElementById('sched_taxBreakdown');
        if (taxEl) { taxEl.innerHTML = taxBreakdownHtml; taxEl.style.display = 'block'; }
    } else {
        const taxEl = document.getElementById('sched_taxBreakdown');
        if (taxEl) taxEl.style.display = 'none';
    }

    const grandTotal = subtotalCost + totalTaxAmt;

    document.getElementById('sched_totalDuration').innerText = totalMins;
    document.getElementById('sched_totalCost').innerText     = grandTotal.toFixed(2);
    document.getElementById('sched_subtotalVal').value       = subtotalCost;
    document.getElementById('sched_taxData').value           = JSON.stringify(taxDataArr);
    document.getElementById('sched_grandTotalVal').value     = grandTotal;

    const brkDiv  = document.getElementById('sched_breakdown');
    const brkList = document.getElementById('sched_breakdownList');
    if (subtotalCost > 0 || totalMins > 0) {
        if (brkList) brkList.innerHTML = breakdownHtml;
        if (brkDiv)  brkDiv.style.display = 'block';
    } else {
        if (brkList) brkList.innerHTML = '';
        if (brkDiv)  brkDiv.style.display = 'none';
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
            bookedService: services.join(', '), bookedDuration: duration,
            bookedPrice: subtotal, taxBreakdown: taxData, grandTotal,
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
                        </div>
                    </div>`;
            });

            listDiv.innerHTML = validCount === 0
                ? '<p class="text-muted">No more appointments expected today.</p>'
                : html;
        });
}

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
            bookedService:  appt.bookedService  || "N/A",
            bookedDuration: parseInt(appt.bookedDuration || 0, 10),
            bookedPrice:    parseFloat(appt.bookedPrice  || 0),
            grandTotal:     parseFloat(appt.grandTotal   || appt.bookedPrice || 0),
            taxBreakdown:   appt.taxBreakdown   || "[]",
            status:         "Waiting",
            fohCreator:     currentUserEmail,
            sourceApptId:   id,                // reference back to the Appointment doc
            apptDate:       appt.dateString,   // original booked date (used by requestReschedule)
            dateString:     todayDateStr,      // operational date (used by financial reports)
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

function startFohBillingListener() {
    if (fohBillingListener) { fohBillingListener(); fohBillingListener = null; }
    const listDiv = document.getElementById('fohPendingCheckoutList');

    fohBillingListener = db.collection('Active_Jobs')
        .where('status', '==', 'Ready for Payment')
        .onSnapshot(snap => {
            if (snap.empty) {
                listDiv.innerHTML = '<p class="text-muted">No pending checkouts.</p>';
                document.getElementById('checkoutPanel').style.display = 'none';
                return;
            }

            listDiv.innerHTML = '';
            snap.forEach(doc => {
                const job = doc.data();
                let taxes = [];
                try { taxes = JSON.parse(job.taxBreakdown || '[]'); } catch (e) { }
                const subtotal   = parseFloat(job.bookedPrice || 0).toFixed(2);
                const grandTotal = parseFloat(job.grandTotal  || job.bookedPrice || 0).toFixed(2);
                const taxHtml    = taxes.map(t => `<div class="checkout-row" style="font-size:0.8rem; color:#888;"><span>+ ${t.name}</span><span>${parseFloat(t.amount).toFixed(2)} GHC</span></div>`).join('');

                const div = document.createElement('div');
                div.className = 'ticket';
                div.style.borderColor = 'var(--success)';
                div.innerHTML = `
                    <div class="ticket-info">
                        <h4 class="text-success">${job.clientName}</h4>
                        <p>💅 ${job.bookedService}</p>
                        <div style="background:#f1f1f1; padding:8px; border-radius:4px; max-width:260px; margin-top:6px;">
                            <div class="checkout-row" style="font-size:0.85rem;"><span>Subtotal:</span><span>${subtotal} GHC</span></div>
                            ${taxHtml}
                            <div class="checkout-total"><span>Total:</span><span>${grandTotal} GHC</span></div>
                        </div>
                    </div>`;
                const checkoutBtn = document.createElement('button');
                checkoutBtn.className = 'btn btn-success btn-auto btn-sm';
                checkoutBtn.textContent = 'Checkout';
                checkoutBtn.onclick = () => window.openCheckout(doc.id, job.clientName, job.bookedService, subtotal, taxHtml, grandTotal);
                div.appendChild(checkoutBtn);
                listDiv.appendChild(div);
            });
        });
}

window.openCheckout = function(id, name, services, subtotal, taxHtml, grandTotal) {
    document.getElementById('checkoutJobId').value        = id;
    document.getElementById('checkoutClientName').innerText = name;
    document.getElementById('checkoutServices').innerText   = services;
    document.getElementById('checkoutSubtotal').innerText   = subtotal + ' GHC';
    document.getElementById('checkoutTaxList').innerHTML    = taxHtml;
    document.getElementById('checkoutTotal').innerText      = grandTotal + ' GHC';
    document.getElementById('checkoutGrandTotalVal').value  = grandTotal;
    document.getElementById('checkoutPaymentMethod').value  = '';
    document.getElementById('checkoutPanel').style.display = 'block';
    document.getElementById('checkoutPanel').scrollIntoView({ behavior: 'smooth' });
};

window.confirmPayment = async function() {
    const btn    = document.getElementById('btnConfirmPayment');
    const id     = document.getElementById('checkoutJobId').value;
    const method = document.getElementById('checkoutPaymentMethod').value;
    const price  = parseFloat(document.getElementById('checkoutGrandTotalVal').value) || 0;

    if (!method) { toast("Please select a Payment Method.", 'warning'); return; }

    captureButtonText(btn);
    setButtonLoading(btn, true, 'Processing...');
    try {
        await db.collection('Active_Jobs').doc(id).update({
            status: 'Closed', paymentMethod: method, totalGHC: price,
            closedAt: firebase.firestore.FieldValue.serverTimestamp(),
            closedBy: currentUserEmail
        });
        toast("Payment processed successfully.", 'success');
        document.getElementById('checkoutPanel').style.display = 'none';
    } catch (e) { toast("Error processing payment: " + e.message, 'error'); }
    finally { setButtonLoading(btn, false); }
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

    // Recalculate projected total from original base price (not from grandTotal which includes tax)
    let base = parseFloat(currentConsultJobData?.bookedPrice || 0);
    pendingUpsells.forEach(p => base += parseFloat(p.price || 0));
    let taxes = 0;
    liveTaxes.forEach(t => taxes += base * (t.rate / 100));
    document.getElementById('consultProjectedTotal').innerText = (base + taxes).toFixed(2) + ' GHC';
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

    let base       = parseFloat(currentConsultJobData.bookedPrice || 0);
    let serviceStr = currentConsultJobData.bookedService || '';
    let dur        = parseInt(currentConsultJobData.bookedDuration || 0, 10);

    pendingUpsells.forEach(p => {
        base += parseFloat(p.price || 0);
        dur  += parseInt(p.duration || 0);
        serviceStr += `, ${p.name}`;
    });

    let totalTaxes = 0;
    const newTaxArr = [];
    liveTaxes.forEach(t => {
        const tAmt = base * (t.rate / 100);
        totalTaxes += tAmt;
        newTaxArr.push({ name: t.name, rate: t.rate, amount: tAmt });
    });

    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).update({
            status:             'In Progress',
            consultationRecord: consultData,
            bookedPrice:        base,
            bookedService:      serviceStr,
            bookedDuration:     dur,          // always a Number
            taxBreakdown:       JSON.stringify(newTaxArr),
            grandTotal:         base + totalTaxes,
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
