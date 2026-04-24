// ⚠️ PASTE YOUR GOOGLE CHAT WEBHOOK URL HERE
const GOOGLE_CHAT_WEBHOOK = ""; 

// ── Firebase config loaded from firebase-config.js ───────────
// Switches automatically between production and staging
const firebaseConfig = window.THURAYA_CONFIG;

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
let _editingServiceId = null; // tracks which Menu_Services doc is being edited (null = creating new)
let expectedTodayListener = null, scheduleListener = null, techQueueListener = null, fohBillingListener = null;


function getLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

let todayDateStr = getLocalDateString();

document.addEventListener("DOMContentLoaded", () => {
    todayDateStr = getLocalDateString();
    const schedDate = document.getElementById('sched_date');
    if (schedDate) schedDate.min = todayDateStr;
});

function timeToMins(timeStr) {
    if(!timeStr) return 0;
    let [h, m] = timeStr.split(':');
    return parseInt(h) * 60 + parseInt(m);
}

// Ensure functions are on the window object for inline HTML calls
window.switchModule = function(moduleId) {
    document.querySelectorAll('.app-module').forEach(mod => mod.style.display = 'none');
    document.getElementById(moduleId).style.display = 'block';
    if (moduleId === 'adminView')          { loadStaffDirectory(); }
    if (moduleId === 'activeAteliersView') { aa_load(); }
    if (moduleId === 'reportsView')        { rpt_init(); }
}

window.toggleClientsSubView = function() {
    const view = document.querySelector('input[name="clients_view_toggle"]:checked').value;
    ['Checkin', 'Schedule', 'Billing', 'Ops'].forEach(x => {
        const target = document.getElementById('subView_' + x);
        if(target) target.style.display = (view.toLowerCase() === x.toLowerCase()) ? 'block' : 'none';
    });
}

window.toggleDeptView = function() {
    const view = document.querySelector('input[name="dept_toggle"]:checked')?.value;
    const hand = document.getElementById('menu_dept_Hand');
    const foot = document.getElementById('menu_dept_Foot');
    if (hand) hand.style.display = (view === 'Hand') ? 'block' : 'none';
    if (foot) foot.style.display = (view === 'Foot') ? 'block' : 'none';
}

window.toggleAdminDeptView = function() {
    const view = document.querySelector('input[name="admin_dept_toggle"]:checked')?.value;
    const hand = document.getElementById('admin_dept_Hand');
    const foot = document.getElementById('admin_dept_Foot');
    if (hand) hand.style.display = (view === 'Hand') ? 'block' : 'none';
    if (foot) foot.style.display = (view === 'Foot') ? 'block' : 'none';
}

window.toggleMenuViewDept = function() {
    const view = document.querySelector('input[name="menu_view_dept_toggle"]:checked')?.value;
    ['Hand', 'Foot'].forEach(dept => {
        const el = document.getElementById('menu_view_dept_' + dept);
        if (el) el.style.display = (view === dept) ? 'block' : 'none';
    });
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        const userEmail = user.email.toLowerCase();
        try { await clockInStaff(userEmail, user.displayName || "Staff", []); } catch(e) { }
        
        try {
            const userDoc = await db.collection('Users').doc(userEmail).get();
            
            if (userDoc.exists) {
                const userData = userDoc.data() || {};
                currentUserEmail = userEmail;
                currentUserName = userData.name || user.displayName || "Staff Member";
                currentRoles = Array.isArray(userData.roles) ? userData.roles : (userData.role ? [userData.role] : []);

                document.getElementById('userNameDisplay').innerText = currentUserName;
                document.getElementById('userRoleDisplay').innerText = currentRoles.join(' | ');
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appDashboard').style.display = 'block';

                try { await fetchAllTechs(); } catch(e) { console.error(e); }
                try { startTaxListener(); } catch(e) { console.error(e); }
                try { startConsultTemplateListener(); } catch(e) {}
                
                document.getElementById('topNavMenu').style.display = 'flex';
                document.querySelectorAll('.nav-tab').forEach(tab => tab.style.display = 'none');
                
                const safeRoles = currentRoles.map(r => (typeof r === 'string' ? r.trim().toLowerCase() : ''));
                
                const isFOH = safeRoles.some(r => r.includes('foh') || r.includes('front of house'));
                const isTech = safeRoles.some(r => r.includes('tech'));
                const isManager = safeRoles.some(r => r.includes('manager'));
                const isAdmin = safeRoles.some(r => r.includes('admin')); 
                const isSupply = safeRoles.some(r => r.includes('supply'));

                if(isManager || isFOH || isAdmin) {
                    document.getElementById('tabClients').style.display = 'flex';
                    try { startFohRosterListener(); } catch(e){}
                    try { startFohFinancialListener(); } catch(e){}
                    try { startExpectedTodayListener(); } catch(e){}
                    try { startScheduleListener(); } catch(e){}
                    try { startFohBillingListener(); } catch(e){}
                }

                if(isTech) {
                    document.getElementById('tabAtelier').style.display = 'flex';
                    try { startTechFinancialListener(); } catch(e){}
                    try { startTechQueueListener(); } catch(e){}
                }
                if(isManager || isAdmin) {
                    document.getElementById('tabActiveAteliers').style.display = 'flex';
                }

                if(isManager || isFOH || isTech || isAdmin) { document.getElementById('tabMenu').style.display = 'flex'; }
                if(isAdmin || isManager) { 
                    document.getElementById('tabMenuSettings').style.display = 'flex';
                }
                if(isAdmin || isManager) { document.getElementById('tabHR').style.display = 'flex'; }
                if(isAdmin || isManager) { document.getElementById('tabClientIntel').style.display = 'flex'; }
                if(isAdmin || isManager) { document.getElementById('tabAttendance').style.display = 'flex'; }
                if(isAdmin || isManager || isFOH || isTech || isSupply) {
                    if(typeof myatt_showTab === 'function') myatt_showTab();
                }
                if(isAdmin || isManager || isSupply) { document.getElementById('tabSupply').style.display = 'flex'; }
                if(isAdmin || isManager) { document.getElementById('tabReports').style.display = 'flex'; }
                
                if(isAdmin) { 
                    document.getElementById('tabAdmin').style.display = 'flex'; 
                    try { loadStaffDirectory(); } catch(e){} 
                }

                if(isAdmin || isManager || isFOH || isTech) {
                    try { fetchLiveMenu(isManager || isAdmin); } catch(e) {}
                }

                const firstVisibleTab = document.querySelector('.nav-tab[style*="flex"] input');
                if(firstVisibleTab) {
                    firstVisibleTab.checked = true;
                    switchModule(firstVisibleTab.value);
                }
            } else {
                auth.signOut();
                showError("Access Denied: Your email is not registered in the matrix.");
            }
        } catch (error) { console.error(error); showError("Database connection error."); }
    } else {
        const loginScreen = document.getElementById('loginScreen');
        const appDashboard = document.getElementById('appDashboard');
        const topNavMenu = document.getElementById('topNavMenu');
        if (loginScreen) loginScreen.style.display = 'block';
        if (appDashboard) appDashboard.style.display = 'none';
        if (topNavMenu) topNavMenu.style.display = 'none';
    }
});

window.signInWithEmail = function() { 
    const email = document.getElementById('testEmail').value.trim();
    const password = document.getElementById('testPassword').value;
    if(!email || !password) { showError("Enter email and password."); return; }
    const errorEl = document.getElementById('errorMsg');
    if (errorEl) errorEl.style.display = 'none'; 
    
    auth.signInWithEmailAndPassword(email, password).catch(error => {
        if (['auth/invalid-login-credentials','auth/wrong-password','auth/user-not-found','auth/invalid-credential'].includes(error.code)) {
            showError("Invalid email or password. Please try again.");
        } else if (error.code === 'auth/invalid-email') {
            showError("Please enter a valid email address.");
        } else if (error.code === 'auth/too-many-requests') {
            showError("Too many failed login attempts. Please try again later.");
        } else {
            showError(error.message || "Login failed.");
        }
    }); 
}

window.signInWithGoogle = function() { 
    document.getElementById('errorMsg').style.display = 'none'; 
    auth.signInWithPopup(provider).catch(error => showError(error.message)); 
}

window.logOut = async function() { 
    if(currentUserEmail) { try { await db.collection('Attendance').doc(`${currentUserEmail}_${todayDateStr}`).update({ clockOut: firebase.firestore.FieldValue.serverTimestamp() }); } catch(e) {} }
    auth.signOut(); 
}

window.showError = function(msg) { 
    const el = document.getElementById('errorMsg'); 
    if (!el) { alert(msg); return; }
    el.innerText = msg; 
    el.style.display = 'block'; 
}

async function clockInStaff(email, name, rolesArray) {
    const docId = `${email}_${todayDateStr}`;
    const docRef = db.collection('Attendance').doc(docId);
    const doc = await docRef.get();
    if(!doc.exists) { await docRef.set({ email: email, name: name, roleString: rolesArray.join(','), date: todayDateStr, clockIn: firebase.firestore.FieldValue.serverTimestamp() }); }
}

async function fetchAllTechs() {
    try {
        const snapshot = await db.collection('Users').get();
        allTechs = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const r = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
            const safeR = r.map(role => (typeof role === 'string' ? role.toLowerCase() : ''));
            
            const isNormalTech = safeR.some(role => role === 'tech' || role === 'technician');
            const isTestTech = safeR.some(role => role.includes('test tech'));

            if(isNormalTech || isTestTech) { 
                allTechs.push({ 
                    email: doc.id, 
                    name: data.name || "Unknown", 
                    isTest: isTestTech,
                    // visibleToClients defaults to true if not set
                    visibleToClients: data.visibleToClients !== false
                }); 
            }
        });
        
        const select = document.getElementById('sched_techSelect');
        if(select) {
            select.innerHTML = '<option value="" disabled selected>Select Technician...</option>';
            // Staff see ALL techs regardless of visibleToClients
            allTechs.forEach(t => { select.innerHTML += `<option value="${t.email}">${t.name}${t.visibleToClients ? '' : ' 🔒'}</option>`; });
        }
        const reassignSelect = document.getElementById('consultReassignTech');
        const consultReassign = document.getElementById('consultReassign');
        if(reassignSelect) {
            reassignSelect.innerHTML = '<option value="">Reassign to...</option>';
            allTechs.forEach(t => { reassignSelect.innerHTML += `<option value="${t.email}">${t.name}</option>`; });
        }
        if(consultReassign) {
            consultReassign.innerHTML = '<option value="">Reassign to...</option>';
            allTechs.forEach(t => { consultReassign.innerHTML += `<option value="${t.email}">${t.name}</option>`; });
        }
    } catch(e) { console.error("Error fetching techs:", e); }
}

// ==========================================
// DYNAMIC TAX ENGINE
// ==========================================
function startTaxListener() {
    db.collection('Tax_Settings').doc('current_taxes').onSnapshot(doc => {
        liveTaxes = [];
        if(doc.exists && doc.data().rates) {
            liveTaxes = doc.data().rates;
        }
        renderTaxConfigUI();
        updatePreviewToggles();
        calculateScheduleTotals(); 
    });
}

window.editTax = function(name, rate) {
    document.getElementById('cfgTaxName').value = name;
    document.getElementById('cfgTaxRate').value = rate;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addTax = async function() {
    const name = document.getElementById('cfgTaxName').value.trim();
    const rate = parseFloat(document.getElementById('cfgTaxRate').value);
    if(!name || isNaN(rate)) { alert("Enter a valid Tax Name and numerical Rate."); return; }

    let currentRates = [...liveTaxes];
    let existingIdx = currentRates.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if(existingIdx >= 0) { currentRates[existingIdx].rate = rate; } 
    else { currentRates.push({ name: name, rate: rate }); }

    try {
        await db.collection('Tax_Settings').doc('current_taxes').set({ rates: currentRates }, {merge: true});
        document.getElementById('cfgTaxName').value = '';
        document.getElementById('cfgTaxRate').value = '';
    } catch(e) { alert("Error saving tax: " + e.message); }
}

window.deleteTax = async function(taxName) {
    if(!confirm(`Remove ${taxName} from the system?`)) return;
    let currentRates = liveTaxes.filter(t => t.name !== taxName);
    try {
        await db.collection('Tax_Settings').doc('current_taxes').set({ rates: currentRates }, {merge: true});
    } catch(e) { alert("Error deleting tax: " + e.message); }
}

function renderTaxConfigUI() {
    const listDiv = document.getElementById('taxConfigList');
    if(!listDiv) return;
    if(liveTaxes.length === 0) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No taxes currently configured.</p>'; return; }
    
    let html = '';
    liveTaxes.forEach(t => {
        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:10px; border:1px solid var(--border); border-radius:4px; margin-bottom:5px;">
            <strong>${t.name}</strong>
            <div style="display:flex; align-items:center; gap:15px;">
                <span style="color:var(--manager); font-weight:bold;">${t.rate}%</span>
                <button class="btn" style="background:var(--primary); padding:4px 10px; width:auto; font-size:0.75rem;" onclick="editTax('${t.name}', ${t.rate})">Edit</button>
                <button class="btn" style="background:var(--error); padding:4px 10px; width:auto; font-size:0.75rem;" onclick="deleteTax('${t.name}')">Remove</button>
            </div>
        </div>`;
    });
    listDiv.innerHTML = html;
}

window.updatePreviewToggles = function() {
    const container = document.getElementById('previewTaxToggles');
    if(!container) return;
    if(liveTaxes.length === 0) {
        container.innerHTML = '<p style="color:#999; font-size:0.8rem; margin:0;">Add a tax above to see toggles here.</p>';
        calculatePreview();
        return;
    }
    let html = '';
    liveTaxes.forEach((t, index) => {
        html += `<label style="font-weight:normal; cursor:pointer; display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                    <input type="checkbox" class="preview-tax-cb" value="${index}" checked onchange="calculatePreview()" style="width:16px; height:16px; accent-color:var(--manager);"> 
                    ${t.name} (${t.rate}%)
                 </label>`;
    });
    container.innerHTML = html;
    calculatePreview();
}

window.calculatePreview = function() {
    let inputPrice = parseFloat(document.getElementById('previewBasePrice').value) || 0;
    let toggleEl = document.querySelector('input[name="tax_inclusive_toggle"]:checked');
    let isInclusive = toggleEl ? toggleEl.value === 'inclusive' : false;

    let taxHtml = '';
    let totalTaxRate = 0;

    document.querySelectorAll('.preview-tax-cb:checked').forEach(cb => {
        let taxObj = liveTaxes[cb.value];
        if(taxObj) { totalTaxRate += taxObj.rate; }
    });

    let basePrice = 0, grandTotal = 0;

    if (isInclusive) {
        grandTotal = inputPrice;
        basePrice = inputPrice / (1 + (totalTaxRate / 100));
    } else {
        basePrice = inputPrice;
        grandTotal = inputPrice * (1 + (totalTaxRate / 100));
    }

    let calculatedTotalTax = 0;

    document.querySelectorAll('.preview-tax-cb:checked').forEach(cb => {
        let taxObj = liveTaxes[cb.value];
        if(taxObj) {
            let amt = basePrice * (taxObj.rate / 100);
            calculatedTotalTax += amt;
            taxHtml += `<div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#777; margin-bottom:3px;"><span>+ ${taxObj.name} (${taxObj.rate}%)</span><span>${amt.toFixed(2)} GHC</span></div>`;
        }
    });

    let baseOut = document.getElementById('prevBaseOut');
    if(baseOut) baseOut.innerText = basePrice.toFixed(2) + ' GHC';

    let breakdownDiv = document.getElementById('prevTaxBreakdown');
    if(breakdownDiv) breakdownDiv.innerHTML = taxHtml;
    
    let totalOut = document.getElementById('prevTotalOut');
    if(totalOut) totalOut.innerText = grandTotal.toFixed(2) + ' GHC';
}

// ==========================================
// DYNAMIC MENU DISPLAY ENGINE 
// ==========================================
function fetchLiveMenu(hasEditAccess) {
    if (hasEditAccess) {
        let seedBtn = document.getElementById('seedMenuBtnContainer');
        if (seedBtn) seedBtn.style.display = 'block';
    }

    db.collection('Menu_Services').onSnapshot(snap => {
        const menuContainer   = document.getElementById('sched_serviceMenu');
        const adminList       = document.getElementById('menuManagerList');
        const readOnlyList    = document.getElementById('menuViewReadOnly');

        if(snap.empty) {
            const emptyMsg = '<p style="text-align:center; color:#999; font-style:italic;">No services configured yet.</p>';
            if(adminList)    adminList.innerHTML    = '<p style="text-align:center; color:#999;">Menu is empty. Use the form above to add services.</p>';
            if(menuContainer)menuContainer.innerHTML = emptyMsg;
            if(readOnlyList) readOnlyList.innerHTML  = emptyMsg;
            return;
        }

        let services = [];
        snap.forEach(doc => { services.push({ id: doc.id, ...doc.data() }); });
        
        services.sort((a, b) => {
            let catA = a.category || "";
            let catB = b.category || "";
            return catA.localeCompare(catB);
        });

        allMenuServicesCache = services; 

        let uSel = document.getElementById('consultUpsellSelect');
        if(uSel) {
            uSel.innerHTML = '<option value="">Select a service or add-on...</option>';
            allMenuServicesCache.forEach(s => {
                if(s.status === "Active") {
                    uSel.innerHTML += `<option value="${s.id}">${s.name} (${s.price} GHC)</option>`;
                }
            });
        }

        let dbData = { Hand: {}, Foot: {} };
        
        services.forEach(s => {
            let cat = s.category || "Uncategorized";
            if(s.department === "Both") {
                if(!dbData["Hand"][cat]) dbData["Hand"][cat] = [];
                dbData["Hand"][cat].push(s);
                if(!dbData["Foot"][cat]) dbData["Foot"][cat] = [];
                dbData["Foot"][cat].push(s);
            } else {
                let dept = s.department || "Hand"; 
                if(!dbData[dept]) dbData[dept] = {};
                if(!dbData[dept][cat]) dbData[dept][cat] = [];
                dbData[dept][cat].push(s);
            }
        });

        let bookingHtml = '';
        let adminHtml = '';

        ['Hand', 'Foot'].forEach(dept => {
            let disp = dept === 'Hand' ? 'block' : 'none';
            bookingHtml += `<div id="menu_dept_${dept}" style="display: ${disp};">`;
            adminHtml += `<div id="admin_dept_${dept}" style="display: ${disp};">`;
            
            let col1 = ''; let col2 = '';
            let toggleCol = true;

            let sortedCats = Object.keys(dbData[dept]).sort((a, b) => {
                let aClean = a.trim().toUpperCase();
                let bClean = b.trim().toUpperCase();
                let numRegex = /^(\d+|I{1,3}|IV|V|VI)\./;
                let isNumA = numRegex.test(aClean);
                let isNumB = numRegex.test(bClean);
                if (isNumA && !isNumB) return -1;
                if (!isNumA && isNumB) return 1;
                return aClean.localeCompare(bClean, undefined, {numeric: true, sensitivity: 'base'});
            });

            sortedCats.forEach(cat => {
                let sectionTypeHint = "";
                if (dbData[dept][cat].length > 0) {
                    let firstType = dbData[dept][cat][0].inputType;
                    if (firstType === 'radio') sectionTypeHint = "<span class='section-hint'>(SELECT ONE ONLY)</span>";
                    else sectionTypeHint = "<span class='section-hint'>(SELECT ANY / MULTIPLE)</span>";
                }

                let sectionHtml = `<div class="menu-col"><div class="menu-section-title"><span>${cat}</span> ${sectionTypeHint}</div>`;
                let adminSectionHtml = `<div class="menu-section-title">${cat}</div><div class="grid-2">`;
                
                dbData[dept][cat].forEach(s => {
                    let type = s.inputType || "radio"; 
                    let safeName = s.name || "Unnamed";
                    let safeDur = s.duration || 0;
                    let safePrc = s.price || 0;
                    let descHtml = s.desc ? `<span class="service-desc">${s.desc}</span>` : '';
                    let tagHtml = (s.tag && s.tag !== "None") ? `<span class="hl-tag">${s.tag}</span>` : '';
                    
                    if(type === 'counter') {
                        sectionHtml += `
                            <div class="service-card" style="align-items:center;">
                                <label style="margin-left:0; cursor:default;">
                                    <strong>${safeName} ${tagHtml}</strong>
                                    ${descHtml}
                                    <div style="margin-top:5px; color:var(--accent); font-weight:bold; font-size:0.8rem;">${safeDur > 0 ? safeDur+' mins | ' : ''}${safePrc} GHC / ea</div>
                                </label>
                                <div class="counter-box">
                                    <button class="btn btn-secondary" style="padding:2px 10px; width:auto;" onclick="updateCounter('${s.id}', -1)">-</button>
                                    <input type="number" id="sched_qty_${s.id}" class="sched-service-counter" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}" value="0" min="0" readonly>
                                    <button class="btn btn-secondary" style="padding:2px 10px; width:auto;" onclick="updateCounter('${s.id}', 1)">+</button>
                                </div>
                            </div>
                        `;
                    } else {
                        let inputName = type === 'radio' ? `sched_base_${dept}` : `sched_cb_${s.id}`;
                        let inputHtml = type === 'radio' 
                            ? `<input type="radio" name="${inputName}" class="sched-service-item" id="sched_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`
                            : `<input type="checkbox" class="sched-service-item" id="sched_cb_${s.id}" data-name="${safeName}" data-duration="${safeDur}" data-price="${safePrc}">`;

                        sectionHtml += `
                            <div class="service-card" onclick="toggleServiceCard(event, this, '${s.id}', '${type}', '${inputName}')">
                                ${inputHtml}
                                <label>
                                    <strong>${safeName} ${tagHtml}</strong>
                                    ${descHtml}
                                    <div style="margin-top:8px; display:inline-block; background:#eef5f9; color:#555; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:bold;">${safeDur > 0 ? safeDur+' mins | ' : ''}${safePrc} GHC</div>
                                </label>
                            </div>
                        `;
                    }

                    if(hasEditAccess) {
                        adminSectionHtml += `
                        <div class="service-card" style="align-items:center; cursor:default;">
                            <div style="flex-grow:1;">
                                <strong>${safeName} ${tagHtml}</strong>
                                <span style="font-size:0.7rem; background:#eee; padding:2px 5px; border-radius:4px; margin-left:4px;">${type.toUpperCase()}</span>
                                <div style="margin-top:5px; font-size:0.82rem; color:#777;">
                                    ${safeDur > 0 ? safeDur + ' mins &nbsp;·&nbsp; ' : ''}${safePrc} GHC
                                </div>
                                ${s.desc ? `<div style="font-size:0.78rem;color:#aaa;margin-top:3px;">${s.desc}</div>` : ''}
                            </div>
                            <div style="display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
                                <button class="btn btn-sm btn-auto" onclick="editMenuService('${s.id}')">Edit</button>
                                <button class="btn btn-sm btn-auto" style="background:var(--error);" onclick="deleteMenuService('${s.id}')">Delete</button>
                            </div>
                        </div>`;
                    } else {
                        adminSectionHtml += `
                        <div class="service-card" style="cursor:default;">
                            <label style="margin-left:0; cursor:default;">
                                <strong>${safeName} ${tagHtml}</strong>
                                <span class="service-desc">${safeDur} mins | ${safePrc} GHC</span>
                            </label>
                        </div>`;
                    }
                });
                
                sectionHtml += `</div>`;
                adminSectionHtml += `</div>`;

                if(toggleCol) { col1 += sectionHtml; } else { col2 += sectionHtml; }
                toggleCol = !toggleCol;
                adminHtml += adminSectionHtml;
            });
            
            bookingHtml += `<div class="grid-2" style="align-items:start;">${col1}${col2}</div></div>`;
            adminHtml   += `</div>`;
        });

        if(adminList)     adminList.innerHTML     = adminHtml;
        if(menuContainer) menuContainer.innerHTML = bookingHtml;

        // Render read-only view for Service Menu tab (all roles)
        // Reuse bookingHtml but swap IDs so dept toggles don't conflict
        const readOnlyHtml = bookingHtml
            .replace(/id="menu_dept_/g,    'id="menu_view_dept_')
            .replace(/name="sched_base_/g, 'name="view_base_');
        if(readOnlyList) readOnlyList.innerHTML = readOnlyHtml;

    }, error => {
        console.error(error);
        let menuContainer = document.getElementById('sched_serviceMenu');
        if(menuContainer) menuContainer.innerHTML = `<p style="color:red;">Error loading menu: ${error.message}</p>`;
    });
}

window.deleteMenuService = async function(id) {
    if(confirm("Are you sure you want to permanently delete this service from the menu?")) {
        try { await db.collection('Menu_Services').doc(id).delete(); } 
        catch(e) { alert("Error deleting: " + e.message); }
    }
};

window.seedDefaultMenu = async function() {
    if(!confirm("This will inject dummy data. Proceed?")) return;
    const menuItems = [
        { dept: "Hand", cat: "I. HAND THERAPIES", type: "radio", name: "Youthful Touch (Hand Renewal)", dur: 45, prc: 220, desc: "", tag: "None" },
        { dept: "Hand", cat: "A. FINISHING INDULGENCES", type: "checkbox", name: "Lush Arm Sculpt", dur: 20, prc: 50, desc: "", tag: "None" }
    ];
    try {
        for(let item of menuItems) {
            let docId = item.name.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
            await db.collection('Menu_Services').doc(docId).set({
                department: item.dept, category: item.cat, inputType: item.type, name: item.name,
                duration: item.dur, price: item.prc, desc: item.desc, status: "Active", tag: item.tag
            });
        }
        alert("Menu seeded successfully!");
    } catch(e) { alert("Error seeding menu: " + e.message); }
}

window.toggleServiceCard = function(event, cardElement, id, type, groupName) {
    event.preventDefault(); 
    const input = document.getElementById('sched_cb_' + id);
    if(!input) return;

    if(type === 'radio') {
        if(input.checked) {
            input.checked = false;
            cardElement.classList.remove('selected');
        } else {
            document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
                r.checked = false;
                let card = r.closest('.service-card');
                if (card) card.classList.remove('selected');
            });
            input.checked = true;
            cardElement.classList.add('selected');
        }
    } else {
        input.checked = !input.checked;
        if(input.checked) { cardElement.classList.add('selected'); } else { cardElement.classList.remove('selected'); }
    }
    calculateScheduleTotals();
}

window.updateCounter = function(id, val) {
    const input = document.getElementById('sched_qty_' + id);
    if(!input) return;
    let current = parseInt(input.value) || 0;
    current += val;
    if(current < 0) current = 0;
    input.value = current;
    calculateScheduleTotals();
}

window.clearAllSelections = function() {
    document.querySelectorAll('.sched-service-item').forEach(cb => cb.checked = false);
    document.querySelectorAll('.sched-service-counter').forEach(input => input.value = 0);
    document.querySelectorAll('.service-card').forEach(card => card.classList.remove('selected'));
    calculateScheduleTotals();
}

window.clearScheduleClient = function() {
    const phone = document.getElementById('sched_phone');
    const name = document.getElementById('sched_name');
    const displayName = document.getElementById('sched_displayName');
    const displayPhone = document.getElementById('sched_displayPhone');
    const selectedDisplay = document.getElementById('sched_selectedClientDisplay');
    const search = document.getElementById('sched_search');
    const searchResults = document.getElementById('sched_searchResults');
    if (phone) phone.value = '';
    if (name) name.value = '';
    if (displayName) displayName.innerText = '';
    if (displayPhone) displayPhone.innerText = '';
    if (selectedDisplay) selectedDisplay.style.display = 'none';
    if (search) search.value = '';
    if (searchResults) searchResults.style.display = 'none';
}

function calculateScheduleTotals() {
    let totalMins = 0;
    let subtotalCost = 0;
    let breakdownHtml = '';
    
    document.querySelectorAll('.sched-service-item:checked').forEach(input => { 
        let mins = parseInt(input.getAttribute('data-duration')) || 0;
        let cost = parseFloat(input.getAttribute('data-price')) || 0;
        let name = input.getAttribute('data-name');
        
        totalMins += mins; 
        subtotalCost += cost;
        breakdownHtml += `<div class="breakdown-row"><span>${name}</span><span>${cost.toFixed(2)} GHC</span></div>`;
    });
    
    document.querySelectorAll('.sched-service-counter').forEach(input => {
        let qty = parseInt(input.value) || 0;
        if(qty > 0) {
            let costPer = parseFloat(input.getAttribute('data-price')) || 0;
            let mins = parseInt(input.getAttribute('data-duration')) || 0;
            let name = input.getAttribute('data-name');
            
            let itemTotalCost = costPer * qty;
            totalMins += mins; 
            subtotalCost += itemTotalCost;
            breakdownHtml += `<div class="breakdown-row"><span>${name} (x${qty})</span><span>${itemTotalCost.toFixed(2)} GHC</span></div>`;
        }
    });

    // TAX ENGINE CALCULATION
    let totalTaxAmt = 0;
    let taxBreakdownHtml = '';
    let taxDataArr = [];

    if (subtotalCost > 0 && liveTaxes.length > 0) {
        taxBreakdownHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-weight:bold; color:#555;"><span>Subtotal:</span><span>${subtotalCost.toFixed(2)} GHC</span></div>`;
        
        liveTaxes.forEach(t => {
            let tAmt = subtotalCost * (t.rate / 100);
            totalTaxAmt += tAmt;
            taxDataArr.push({ name: t.name, rate: t.rate, amount: tAmt });
            taxBreakdownHtml += `<div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#777; margin-bottom:3px;"><span>+ ${t.name} (${t.rate}%)</span><span>${tAmt.toFixed(2)} GHC</span></div>`;
        });
        document.getElementById('sched_taxBreakdown').innerHTML = taxBreakdownHtml;
        document.getElementById('sched_taxBreakdown').style.display = 'block';
    } else {
        document.getElementById('sched_taxBreakdown').style.display = 'none';
    }

    let grandTotal = subtotalCost + totalTaxAmt;

    document.getElementById('sched_totalDuration').innerText = totalMins;
    document.getElementById('sched_totalCost').innerText = grandTotal.toFixed(2);
    
    document.getElementById('sched_subtotalVal').value = subtotalCost;
    document.getElementById('sched_taxData').value = JSON.stringify(taxDataArr);
    document.getElementById('sched_grandTotalVal').value = grandTotal;
    
    const breakdownDiv = document.getElementById('sched_breakdown');
    const breakdownList = document.getElementById('sched_breakdownList');
    
    if (subtotalCost > 0 || totalMins > 0) {
        breakdownList.innerHTML = breakdownHtml;
        breakdownDiv.style.display = 'block';
    } else {
        breakdownList.innerHTML = '';
        breakdownDiv.style.display = 'none';
    }

    generateTimeSlots(); 
}

window.selectTimeSlot = function(timeStr, btnElement) {
    document.getElementById('sched_time').value = timeStr;
    document.querySelectorAll('.time-slot-btn').forEach(btn => btn.classList.remove('selected'));
    btnElement.classList.add('selected');
}

async function generateTimeSlots() {
    let date      = document.getElementById('sched_date').value;
    let duration  = parseInt(document.getElementById('sched_totalDuration').innerText) || 0;
    let techEmail = document.getElementById('sched_techSelect').value;
    let groupSize = parseInt(document.getElementById('sched_groupSize')?.value) || 1;
    let slotsContainer = document.getElementById('sched_timeSlots');

    if (date && date < todayDateStr) {
        slotsContainer.innerHTML = '<p style="color:var(--error); font-weight:bold; margin:0;">You cannot book appointments in the past.</p>';
        return;
    }

    document.getElementById('sched_time').value = '';

    if (!date || !techEmail || duration === 0) {
        slotsContainer.innerHTML = '<p style="color:#999; font-size:0.85rem; margin:0; font-style:italic;">⚠️ Please select at least one Service, a Date, and a Technician to generate available times.</p>';
        return;
    }

    slotsContainer.innerHTML = '<p style="color:#666; font-size:0.85rem; margin:0;">Calculating slots...</p>';

    try {
        let snap = await db.collection('Appointments').where('dateString', '==', date).get();

        // Build busy blocks per technician
        let busyByTech = {};
        snap.forEach(doc => {
            if (editingApptId && doc.id === editingApptId) return;
            let appt = doc.data();
            if (appt.status === 'Scheduled' || appt.status === 'Arrived') {
                if (!busyByTech[appt.assignedTechEmail]) busyByTech[appt.assignedTechEmail] = [];
                busyByTech[appt.assignedTechEmail].push({
                    start: timeToMins(appt.timeString),
                    end:   timeToMins(appt.timeString) + parseInt(appt.bookedDuration || 0)
                });
            }
        });

        let openTime = 8 * 60, closeTime = 20 * 60, interval = 30;
        let now = new Date();
        let currentMins = now.getHours() * 60 + now.getMinutes();
        let isToday = (date === todayDateStr);

        let html = '<div style="display:flex; flex-wrap:wrap; gap:10px;">';
        let slotsFound = false;

        for (let t = openTime; t + duration <= closeTime; t += interval) {
            if (isToday && t < currentMins + 30) continue;

            let slotEnd = t + duration;

            if (groupSize <= 1) {
                // INDIVIDUAL: check only the selected tech
                let busy = busyByTech[techEmail] || [];
                let available = busy.every(b => slotEnd <= b.start || t >= b.end);
                if (!available) continue;
            } else {
                // GROUP: find how many techs (including selected) are free at this slot
                // The selected tech must be free, plus (groupSize-1) additional techs
                let selectedTechBusy = busyByTech[techEmail] || [];
                let selectedFree = selectedTechBusy.every(b => slotEnd <= b.start || t >= b.end);
                if (!selectedFree) continue; // selected tech must always be free

                // Count other free techs
                let otherFreeTechs = allTechs.filter(tech => {
                    if (tech.email === techEmail) return false; // already counted
                    let blocks = busyByTech[tech.email] || [];
                    return blocks.every(b => slotEnd <= b.start || t >= b.end);
                });

                // Need (groupSize - 1) additional free techs
                if (otherFreeTechs.length < groupSize - 1) continue;
            }

            slotsFound = true;
            let hrs = Math.floor(t / 60), mins = t % 60;
            let ampm = hrs >= 12 ? 'PM' : 'AM';
            let displayHrs = hrs % 12 || 12;
            let displayMins = mins < 10 ? '0' + mins : mins;
            let timeString24 = `${hrs < 10 ? '0'+hrs : hrs}:${displayMins}`;
            let timeString12 = `${displayHrs}:${displayMins} ${ampm}`;
            html += `<button type="button" class="time-slot-btn" data-time="${timeString24}" onclick="selectTimeSlot('${timeString24}', this)">${timeString12}</button>`;
        }
        html += '</div>';

        if (!slotsFound) {
            const msg = groupSize > 1
                ? `<p style="color:var(--error); font-weight:bold; margin:0;">No slots available where ${groupSize} technicians are free simultaneously. Try a different date or reduce group size.</p>`
                : '<p style="color:var(--error); font-weight:bold; margin:0;">No time slots available for this duration.</p>';
            slotsContainer.innerHTML = msg;
        } else {
            slotsContainer.innerHTML = html;
        }

    } catch(e) { console.error("Availability Error:", e); }
}

window.editAppointment = async function(id) {
    try {
        let doc = await db.collection('Appointments').doc(id).get();
        if(!doc.exists) return;
        let appt = doc.data();

        // Step 1: Switch to Clients main tab
        const clientsTabEl = document.getElementById('nav_clients');
        if (clientsTabEl) { clientsTabEl.checked = true; switchModule('clientsView'); }
        // Step 2: Switch to Book Appointment sub-tab
        const schedTabEl = document.getElementById('tab_toggle_schedule');
        if (schedTabEl) { schedTabEl.checked = true; toggleClientsSubView(); }

        editingApptId = id;

        // Scroll to form after tab renders
        setTimeout(() => {
            const bookingForm = document.getElementById('subView_Schedule');
            if (bookingForm) bookingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 350);

        document.getElementById('sched_phone').value = appt.clientPhone || '';
        document.getElementById('sched_name').value = appt.clientName || '';
        document.getElementById('sched_displayName').innerText = appt.clientName || 'Unknown';
        document.getElementById('sched_displayPhone').innerText = appt.clientPhone || 'Unknown';
        document.getElementById('sched_search').value = '';
        document.getElementById('sched_searchResults').style.display = 'none';
        document.getElementById('sched_selectedClientDisplay').style.display = 'block';

        editingApptId = id;
        document.getElementById('btnConfirmBooking').innerText = "Update Appointment";
        document.getElementById('btnCancelEdit').style.display = 'inline-block';

        clearAllSelections();

        setTimeout(() => {
            let servicesArr = appt.bookedService.split(', ').map(s => s.trim());
            
            document.querySelectorAll('.sched-service-item').forEach(cb => {
                if(servicesArr.includes(cb.getAttribute('data-name'))) {
                    cb.checked = true;
                    cb.closest('.service-card').classList.add('selected');
                }
            });

            document.querySelectorAll('.sched-service-counter').forEach(input => {
                let name = input.getAttribute('data-name');
                let match = servicesArr.find(s => s.startsWith(name + ' (x'));
                if(match) {
                    let matchArr = match.match(/\(x(\d+)\)/);
                    if(matchArr && matchArr[1]) {
                        input.value = parseInt(matchArr[1]);
                    }
                }
            });

            document.getElementById('sched_date').value = appt.dateString;
            document.getElementById('sched_techSelect').value = appt.assignedTechEmail;

            calculateScheduleTotals();

            setTimeout(() => {
                let timeBtns = document.querySelectorAll('.time-slot-btn');
                timeBtns.forEach(btn => {
                    if(btn.getAttribute('data-time') === appt.timeString) {
                        selectTimeSlot(appt.timeString, btn);
                    }
                });
            }, 500); 
        }, 200);

    } catch(e) {
        console.error(e);
        alert("Error loading appointment for edit.");
    }
}

window.clearAdvForm = function() {
    ['adv_name', 'adv_duration', 'adv_price', 'adv_desc', 'adv_section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const defaults = {
        adv_category: 'Hand Therapy',
        adv_pricing_type: 'Fixed',
        adv_status: 'Active',
        adv_applies_to: 'Hand',
        adv_selection: 'Single',
        adv_tag: 'None'
    };
    Object.entries(defaults).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    updateAdvForm();

    // Reset edit state
    _editingServiceId = null;
    const saveBtn = document.getElementById('btnSaveServiceConfig');
    if (saveBtn) {
        saveBtn.innerText = 'Save Service Configuration';
        saveBtn.style.background = '';
    }
    const cancelNote = document.getElementById('cancelEditServiceNote');
    if (cancelNote) cancelNote.remove();
}

window.updateAdvForm = function() {
    const category = document.getElementById('adv_category')?.value || 'Hand Therapy';
    const typeSelect = document.getElementById('adv_type');
    const appliesTo = document.getElementById('adv_applies_to');
    const selection = document.getElementById('adv_selection');

    if (!typeSelect) return;

    if (category === 'Add-On') {
        typeSelect.innerHTML = '<option value="Add-On">Add-On / Upgrade</option>';
        if (appliesTo) appliesTo.value = 'Both';
        if (selection) selection.value = 'Multi';
    } else {
        typeSelect.innerHTML = '<option value="Main Therapy">Main Therapy (Single Select)</option>';
        if (selection && selection.value !== 'Single' && selection.value !== 'Multi') selection.value = 'Single';
    }
}

window.editMenuService = async function(id) {
    try {
        const doc = await db.collection('Menu_Services').doc(id).get();
        if (!doc.exists) { alert('Service not found.'); return; }
        const s = doc.data();

        // Pre-fill every field in the Add New Service form
        const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ''; };
        set('adv_name',         s.name         || '');
        set('adv_duration',     s.duration     || '');
        set('adv_price',        s.price        || '');
        set('adv_desc',         s.desc         || s.description || '');
        // category in Firestore IS the section header — put it in adv_section
        set('adv_section',      s.category     || s.section || '');
        set('adv_status',       s.status       || 'Active');
        set('adv_tag',          s.tag          || 'None');
        set('adv_pricing_type', s.pricingType  || 'Fixed');

        // department → adv_applies_to (options: "Hand", "Foot", "Both")
        const dept = s.department || s.appliesTo || 'Hand';
        set('adv_applies_to', dept);

        // adv_category dropdown — derive from department
        const catDropdown = dept === 'Foot' ? 'Foot Therapy' : dept === 'Both' ? 'Hand Therapy' : 'Hand Therapy';
        set('adv_category', catDropdown);

        // inputType → adv_selection (options: "Single", "Multi")
        const selEl = document.getElementById('adv_selection');
        if (selEl) selEl.value = s.inputType === 'radio' ? 'Single' : 'Multi';

        updateAdvForm();
        const typeEl = document.getElementById('adv_type');
        if (typeEl && s.type) typeEl.value = s.type;

        // Store the id so save knows to update not create
        _editingServiceId = id;

        // Update the save button label and add a cancel edit link
        const saveBtn = document.getElementById('btnSaveServiceConfig');
        if (saveBtn) {
            saveBtn.innerText = 'Update Service';
            saveBtn.style.background = 'var(--manager)';
        }

        // Show a cancel-edit note next to the button if not already there
        let cancelNote = document.getElementById('cancelEditServiceNote');
        if (!cancelNote) {
            cancelNote = document.createElement('button');
            cancelNote.id = 'cancelEditServiceNote';
            cancelNote.className = 'btn btn-secondary btn-auto';
            cancelNote.style.cssText = 'margin-left:10px; font-size:0.8rem;';
            cancelNote.textContent = 'Cancel Edit';
            cancelNote.onclick = () => clearAdvForm();
            saveBtn?.parentNode?.appendChild(cancelNote);
        }

        // Scroll to the form
        document.getElementById('managerMenuControls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        alert(`Editing: "${s.name}" — make your changes above and click Update Service.`);

    } catch (e) { alert('Error loading service: ' + e.message); }
};

window.addNewMenuServiceAdv = async function() {
    const sectionHeader = document.getElementById('adv_section')?.value.trim() || '';
    const payload = {
        // `category` is the display header used by the menu engine to group services
        // It must come from adv_section (the typed header), NOT adv_category (the dropdown)
        category:    sectionHeader || document.getElementById('adv_category')?.value || '',
        type:        document.getElementById('adv_type')?.value        || '',
        name:        document.getElementById('adv_name')?.value.trim() || '',
        duration:    parseInt(document.getElementById('adv_duration')?.value  || '0', 10),
        price:       parseFloat(document.getElementById('adv_price')?.value   || '0'),
        pricingType: document.getElementById('adv_pricing_type')?.value || 'Fixed',
        status:      document.getElementById('adv_status')?.value      || 'Active',
        description: document.getElementById('adv_desc')?.value.trim() || '',
        desc:        document.getElementById('adv_desc')?.value.trim() || '',
        appliesTo:   document.getElementById('adv_applies_to')?.value  || 'Hand',
        selection:   document.getElementById('adv_selection')?.value   || 'Single',
        section:     sectionHeader,
        tag:         document.getElementById('adv_tag')?.value         || 'None',
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
    };

    // Derive inputType and department from selection/appliesTo
    payload.inputType  = payload.selection === 'Single' ? 'radio' : 'checkbox';
    payload.department = payload.appliesTo;

    if (!payload.name)                           { alert('Enter a service name.'); return; }
    if (!payload.duration || payload.duration < 0) { alert('Enter a valid duration.'); return; }
    if (isNaN(payload.price) || payload.price < 0) { alert('Enter a valid price.'); return; }

    try {
        if (_editingServiceId) {
            await db.collection('Menu_Services').doc(_editingServiceId).update(payload);
            alert(`"${payload.name}" updated successfully.`);
        } else {
            // CREATE new document
            await db.collection('Menu_Services').add(payload);
            alert('Service configuration saved.');
        }
        clearAdvForm();
    } catch (e) {
        alert('Error saving service: ' + e.message);
    }
};

window.cancelEditMode = function() {
    editingApptId = null;
    document.getElementById('btnConfirmBooking').innerText = "Confirm & Book Appointment";
    document.getElementById('btnCancelEdit').style.display = 'none';
    // Reset group booking fields
    const groupSizeEl = document.getElementById('sched_groupSize');
    if (groupSizeEl) groupSizeEl.value = '1';
    const groupNote = document.getElementById('groupSizeNote');
    if (groupNote) groupNote.style.display = 'none';
    const groupIdEl = document.getElementById('sched_groupId');
    if (groupIdEl) groupIdEl.value = '';
    window.clearScheduleClient();
    document.getElementById('sched_date').value = '';
    document.getElementById('sched_time').value = '';
    document.getElementById('sched_techSelect').value = '';
    clearAllSelections();
}

// ==========================================
// PHASE 1 — GROUP BOOKING ENGINE
// ==========================================

/** Generate a short unique group ID: "GRP-" + 6 alphanumeric chars */
function generateGroupId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    return 'GRP-' + Array.from(arr, b => chars[b % chars.length]).join('');
}

/** Called when FOH changes the group size selector */
window.onGroupSizeChange = function() {
    const size = parseInt(document.getElementById('sched_groupSize').value) || 1;
    const note = document.getElementById('groupSizeNote');
    const noteCount = document.getElementById('groupSizeNoteCount');
    if (size > 1) {
        if (note) { note.style.display = 'block'; }
        if (noteCount) noteCount.textContent = size;
        // Generate a groupId if not already set
        const groupIdEl = document.getElementById('sched_groupId');
        if (groupIdEl && !groupIdEl.value) groupIdEl.value = generateGroupId();
        // Re-generate slots since slot logic depends on group size
        generateTimeSlots();
    } else {
        if (note) note.style.display = 'none';
        const groupIdEl = document.getElementById('sched_groupId');
        if (groupIdEl) groupIdEl.value = '';
        generateTimeSlots();
    }
};

window.bookAppointment = async function() {
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
    const groupSize  = parseInt(document.getElementById('sched_groupSize').value) || 1;
    const groupId    = document.getElementById('sched_groupId').value || '';

    let services = [];
    document.querySelectorAll('.sched-service-item:checked').forEach(cb => { services.push(cb.getAttribute('data-name')); });
    document.querySelectorAll('.sched-service-counter').forEach(input => {
        let qty = parseInt(input.value) || 0;
        if (qty > 0) services.push(`${input.getAttribute('data-name')} (x${qty})`);
    });

    if (!phone || !name || !date || !time || !techEmail || services.length === 0) {
        alert("Please complete the form: Select a client, at least one service, date, a technician, and an available time slot."); return;
    }

    try {
        let payload = {
            clientPhone: phone, clientName: name, dateString: date, timeString: time,
            assignedTechEmail: techEmail, assignedTechName: techName,
            bookedService: services.join(', '), bookedDuration: duration,
            bookedPrice: subtotal, taxBreakdown: taxData, grandTotal: grandTotal,
            status: 'Scheduled', bookedBy: currentUserEmail,
            // Group fields — present on all bookings, size=1 means individual
            groupSize:      groupSize,
            isGroupBooking: groupSize > 1,
            groupId:        groupSize > 1 ? groupId : '',
            groupRole:      groupSize > 1 ? 'lead'  : '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (editingApptId) {
            await db.collection('Appointments').doc(editingApptId).update(payload);
            alert("Appointment successfully updated!");
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('Appointments').add(payload);
            if (groupSize > 1) {
                alert(`Lead booking confirmed for ${name}.\n\nGroup ID: ${groupId}\n\nNow book each additional group member separately using the same Group ID: ${groupId}\nEach member's appointment will be automatically linked.`);
                // Reset group size to 1 but keep the groupId for subsequent member bookings
                document.getElementById('sched_groupSize').value = '1';
                document.getElementById('groupSizeNote').style.display = 'none';
                // Pre-fill groupId field so next booking in the group links automatically
                // FOH can book member 2, 3 etc. without re-entering the ID
            } else {
                alert("Appointment successfully secured!");
            }
        }
        cancelEditMode();
    } catch(e) { alert("Error booking: " + e.message); }
}

function startScheduleListener() {
    const listDiv = document.getElementById('upcomingScheduleList');
    try {
        scheduleListener = db.collection('Appointments').where('status', 'in', ['Scheduled', 'Action Required']).onSnapshot(snap => {
            if(snap.empty) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No upcoming appointments scheduled.</p>'; return; }
            
            let allAppts = [];
            snap.forEach(doc => {
                let appt = doc.data();
                if(appt.dateString >= todayDateStr || appt.status === 'Action Required') { allAppts.push({id: doc.id, ...appt}); }
            });

            allAppts.sort((a, b) => {
                let dateA = a.dateString || ""; let dateB = b.dateString || "";
                let timeA = a.timeString || ""; let timeB = b.timeString || "";
                if (dateA === dateB) return timeA.localeCompare(timeB);
                return dateA.localeCompare(dateB);
            });

            if(allAppts.length === 0) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No upcoming appointments scheduled.</p>'; return; }

            let html = '';
            allAppts.forEach(appt => {
                const isToday = appt.dateString === todayDateStr ? '<span class="ticket-badge" style="background:#e74c3c;">TODAY</span>' : '';
                let actionReq = appt.status === 'Action Required' ? '<span class="ticket-badge" style="background:var(--error); margin-left:5px;">RESCHEDULE REQUESTED</span>' : '';
                
                let timeParts = (appt.timeString || "00:00").split(':');
                let hr = parseInt(timeParts[0]) || 0; let min = timeParts[1] || "00";
                let ampm = hr >= 12 ? 'PM' : 'AM'; let hr12 = hr % 12; if(hr12 === 0) hr12 = 12;
                let displayAmt = parseFloat(appt.grandTotal || appt.bookedPrice || 0).toFixed(2);

                html += `
                    <div class="ticket" style="border-color: ${appt.status === 'Action Required' ? 'var(--error)' : 'var(--manager)'}; padding: 10px;">
                        <div style="flex-grow:1;">
                            <h4 style="margin:0; font-size:1rem; color:var(--manager);">${appt.clientName || 'Unknown'} ${isToday} ${actionReq}${appt.isGroupBooking ? `<span class="group-badge">👥 GROUP · ${appt.groupSize}</span>` : ''}</h4>
                            <p style="margin:0; font-size:0.8rem; color: var(--primary); font-weight: bold;">💅 ${appt.bookedService} (${appt.bookedDuration} mins | ${displayAmt} GHC)</p>
                            <p style="margin:0; font-size:0.8rem;">📅 ${appt.dateString} at ⏰ ${hr12}:${min} ${ampm} | Tech: ${appt.assignedTechName || 'Unknown'}</p>
                            ${appt.isGroupBooking ? `<div class="group-member-list"><p>🔑 Group ID: <strong>${appt.groupId}</strong></p></div>` : ''}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:5px;">
                            <button class="btn btn-secondary" style="width:100%; padding:5px 10px; font-size:0.75rem;" onclick="editAppointment('${appt.id}')">Edit</button>
                            <button class="btn btn-secondary" style="width:100%; padding:5px 10px; font-size:0.75rem; color:var(--error); border-color:var(--error);" onclick="cancelAppointment('${appt.id}')">Cancel</button>
                        </div>
                    </div>`;
            });
            listDiv.innerHTML = html;
        });
    } catch(e) { console.error(e); }
}

window.cancelAppointment = async function(id) {
    if(confirm("Are you sure you want to cancel this appointment?")) {
        await db.collection('Appointments').doc(id).update({ status: 'Cancelled' });
    }
}

// ==========================================
// FOH PIPELINE: REGISTRATION & SEARCH
// ==========================================
window.selectClientForSchedule = function(clientData) {
    document.getElementById('sched_phone').value = clientData.Tel_Number || '';
    const fullName = `${clientData.Forename || ''} ${clientData.Surname || ''}`.trim() || 'Unknown Client';
    document.getElementById('sched_name').value = fullName;
    document.getElementById('sched_displayName').innerText = fullName;
    document.getElementById('sched_displayPhone').innerText = clientData.Tel_Number || 'No Phone';
    document.getElementById('sched_search').value = '';
    document.getElementById('sched_searchResults').style.display = 'none';
    document.getElementById('sched_selectedClientDisplay').style.display = 'block';
    // Open Client Intelligence Panel
    cip_open(clientData);
}

window.selectClientForFOH = function(clientData) {
    document.getElementById('f_forename').value = clientData.Forename || '';
    document.getElementById('f_surname').value = clientData.Surname || '';
    document.getElementById('f_tel').value = clientData.Tel_Number || '';
    document.getElementById('f_altTel').value = clientData.Tel_Number_Alt || '';
    document.getElementById('f_gender').value = clientData.Gender || '';
    document.getElementById('f_email').value = clientData.Email || '';
    document.getElementById('f_dob').value = clientData.DOB || '';
    
    document.getElementById('fohSearchPhone').value = '';
    document.getElementById('foh_searchResults').style.display = 'none';
    
    const msg = document.getElementById('fohSearchMsg');
    msg.innerText = "Client Loaded. You can update their details and save.";
    msg.style.color = "var(--success)";
    // Open Client Intelligence Panel
    cip_open(clientData);
}

window.liveClientSearchFOH = async function() {
    clearTimeout(fohSearchTimeout);
    fohSearchTimeout = setTimeout(async () => {
        try {
            let val = document.getElementById('fohSearchPhone').value.toLowerCase().trim();
            let resDiv = document.getElementById('foh_searchResults');
            if(val.length < 2) { resDiv.style.display = 'none'; return; }

            if(allClientsCache.length === 0) {
                if (!isFetchingClients) {
                    isFetchingClients = true;
                    resDiv.innerHTML = '<div style="padding:10px; color:#666; font-size:0.85rem;">Loading database...</div>';
                    resDiv.style.display = 'block';
                    const snap = await db.collection('Clients').get();
                    allClientsCache = [];
                    snap.forEach(doc => allClientsCache.push(doc.data()));
                    isFetchingClients = false;
                } else { return; }
            }

            let matches = allClientsCache.filter(c => {
                let phone = c.Tel_Number ? String(c.Tel_Number) : "";
                let fname = c.Forename ? String(c.Forename).toLowerCase() : "";
                let sname = c.Surname ? String(c.Surname).toLowerCase() : "";
                return phone.includes(val) || fname.includes(val) || sname.includes(val);
            });

            resDiv.innerHTML = '';
            if(matches.length > 0) {
                matches.slice(0, 5).forEach(m => {
                    let btn = document.createElement('button');
                    btn.className = 'search-result-item';
                    let phoneDisp = m.Tel_Number ? String(m.Tel_Number) : "No Phone";
                    btn.innerHTML = `<strong>${m.Forename || ''} ${m.Surname || ''}</strong> <br> <small style="color:var(--manager);">${phoneDisp}</small>`;
                    
                    btn.onmousedown = function(e) {
                        e.preventDefault();
                        window.selectClientForFOH(m);
                    };
                    resDiv.appendChild(btn);
                });
                resDiv.style.display = 'block';
            } else {
                resDiv.innerHTML = '<div style="padding:10px; color:#999; font-size:0.85rem;">No client found.</div>';
                resDiv.style.display = 'block';
            }
        } catch(e) { console.error(e); }
    }, 300);
}

window.liveClientSearch = async function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            let val = document.getElementById('sched_search').value.toLowerCase().trim();
            let resDiv = document.getElementById('sched_searchResults');
            if(val.length < 2) { resDiv.style.display = 'none'; return; }

            if(allClientsCache.length === 0) {
                if (!isFetchingClients) {
                    isFetchingClients = true;
                    resDiv.innerHTML = '<div style="padding:10px; color:#666; font-size:0.85rem;">Loading database...</div>';
                    resDiv.style.display = 'block';
                    const snap = await db.collection('Clients').get();
                    allClientsCache = [];
                    snap.forEach(doc => allClientsCache.push(doc.data()));
                    isFetchingClients = false;
                } else { return; }
            }

            let matches = allClientsCache.filter(c => {
                let phone = c.Tel_Number ? String(c.Tel_Number) : "";
                let fname = c.Forename ? String(c.Forename).toLowerCase() : "";
                let sname = c.Surname ? String(c.Surname).toLowerCase() : "";
                return phone.includes(val) || fname.includes(val) || sname.includes(val);
            });

            resDiv.innerHTML = '';
            if(matches.length > 0) {
                matches.slice(0, 5).forEach(m => {
                    let btn = document.createElement('button');
                    btn.className = 'search-result-item';
                    let phoneDisp = m.Tel_Number ? String(m.Tel_Number) : "No Phone";
                    btn.innerHTML = `<strong>${m.Forename || ''} ${m.Surname || ''}</strong> <br> <small style="color:var(--manager);">${phoneDisp}</small>`;
                    
                    btn.onmousedown = function(e) {
                        e.preventDefault();
                        window.selectClientForSchedule(m);
                    };
                    resDiv.appendChild(btn);
                });
                resDiv.style.display = 'block';
            } else {
                resDiv.innerHTML = '<div style="padding:10px; color:#999; font-size:0.85rem;">No client found.</div>';
                resDiv.style.display = 'block';
            }
        } catch(e) { console.error(e); }
    }, 300);
}

window.clearFohForm = function() { 
    ['f_forename', 'f_surname', 'f_tel', 'f_altTel', 'f_gender', 'f_email', 'f_dob'].forEach(id => { 
        if(document.getElementById(id)) document.getElementById(id).value = ''; 
    }); 
}

window.registerClientOnly = async function() {
    const btn = document.getElementById('btnRegisterClient');
    const f_forename = document.getElementById('f_forename').value.trim(); 
    const f_surname = document.getElementById('f_surname').value.trim();
    const f_tel = document.getElementById('f_tel').value.replace(/\D/g, ''); 
    const f_altTel = document.getElementById('f_altTel').value.replace(/\D/g, '');
    const f_gender = document.getElementById('f_gender').value; 

    if(!f_forename || !f_surname || !f_tel || !f_gender) { alert("Please fill in all required fields (*)."); return; }
    if(f_tel.length !== 10) { alert("Primary Telephone must be 10 digits."); return; }
    
    btn.innerText = "Saving..."; btn.disabled = true;

    const clientMasterData = { 
        Forename: f_forename, Surname: f_surname, Tel_Number: f_tel, Tel_Number_Alt: f_altTel, 
        Gender: f_gender, Email: document.getElementById('f_email').value.trim(), 
        DOB: document.getElementById('f_dob').value, Last_Updated: firebase.firestore.FieldValue.serverTimestamp() 
    };

    try {
        await db.collection("Clients").doc(f_tel).set(clientMasterData, { merge: true });
        
        let existingIdx = allClientsCache.findIndex(c => c.Tel_Number === f_tel);
        if(existingIdx >= 0) { allClientsCache[existingIdx] = clientMasterData; }
        else { allClientsCache.push(clientMasterData); }
        
        alert(`Success! ${f_forename} ${f_surname} has been saved to the database. 

Please proceed to the Book Appointment tab to assign them a service and Technician.`);
        window.clearFohForm(); 
        document.getElementById('fohSearchPhone').value = ''; 
        document.getElementById('fohSearchMsg').innerText = '';
    } catch (error) { alert("Error saving client: " + error.message); } finally { btn.innerText = "Save Client Record"; btn.disabled = false; }
}

function startExpectedTodayListener() {
    const listDiv = document.getElementById('expectedTodayList');
    try {
        expectedTodayListener = db.collection('Appointments').where('dateString', '==', todayDateStr).onSnapshot(snap => {
            if(snap.empty) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No appointments scheduled for today.</p>'; return; }
            
            let todaysAppts = [];
            snap.forEach(doc => {
                let appt = doc.data();
                if(appt.status === 'Scheduled') todaysAppts.push({id: doc.id, ...appt});
            });

            todaysAppts.sort((a, b) => {
                let timeA = a.timeString || ""; let timeB = b.timeString || "";
                return timeA.localeCompare(timeB);
            });

            if(todaysAppts.length === 0) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No appointments scheduled for today.</p>'; return; }

            let html = '';
            let now = new Date();
            let currentMins = now.getHours() * 60 + now.getMinutes();
            let validCount = 0;

            todaysAppts.forEach(appt => {
                let timeParts = (appt.timeString || "00:00").split(':');
                let hr = parseInt(timeParts[0]) || 0; let min = timeParts[1] || "00";
                let aStart = hr * 60 + parseInt(min);
                let aEnd = aStart + parseInt(appt.bookedDuration || 0);

                if (currentMins > aEnd + 15) { return; }

                validCount++;
                let ampm = hr >= 12 ? 'PM' : 'AM'; let hr12 = hr % 12; if(hr12 === 0) hr12 = 12;
                let displayMins = parseInt(min) < 10 ? '0' + parseInt(min) : min;
                let displayAmt = parseFloat(appt.grandTotal || appt.bookedPrice || 0).toFixed(2);
                
                html += `
                    <div class="ticket" style="border-color: var(--accent); padding: 10px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex-grow:1;">
                            <h4 style="margin:0; font-size:1rem;">${appt.clientName || 'Unknown'}${appt.isGroupBooking ? `<span class="group-badge">👥 GROUP · ${appt.groupSize}</span>` : ''}</h4>
                            <p style="margin:0; font-size:0.8rem; color: var(--primary);">💅 <strong>${appt.bookedService || 'N/A'}</strong></p>
                            <p style="margin:0; font-size:0.8rem;">⏰ ${hr12}:${displayMins} ${ampm} | Tech: ${appt.assignedTechName || 'Unknown'} | 📞 ${appt.clientPhone || 'N/A'}</p>
                            ${appt.isGroupBooking ? `<div class="group-member-list"><p>🔑 Group ID: <strong>${appt.groupId}</strong></p></div>` : ''}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:5px; width:80px;">
                            <button class="btn" style="width:100%; padding:5px; font-size:0.75rem;" onclick="checkInAppointment('${appt.id}')">Check-In</button>
                            <button class="btn btn-secondary" style="width:100%; padding:5px; font-size:0.75rem;" onclick="editAppointment('${appt.id}')">Edit</button>
                            <button class="btn btn-secondary" style="width:100%; padding:5px; font-size:0.75rem; color:var(--error); border-color:var(--error);" onclick="cancelAppointment('${appt.id}')">Cancel</button>
                        </div>
                    </div>`;
            });
            
            if(validCount === 0) { listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No more appointments expected today.</p>'; } 
            else { listDiv.innerHTML = html; }
        });
    } catch(e) { console.error(e); }
}

window.checkInAppointment = async function(id) {
    try {
        const doc  = await db.collection('Appointments').doc(id).get();
        const appt = doc.data();

        // Check if this is part of a group — offer bulk check-in
        if (appt.groupId && appt.isGroupBooking) {
            const confirmBulk = confirm(
                `${appt.clientName} is part of a group booking (${appt.groupId}, ${appt.groupSize} people).\n\n` +
                `Check in ALL group members at once?\n\n` +
                `OK = Check in entire group\nCancel = Check in this person only`
            );
            if (confirmBulk) {
                await checkInGroupByGroupId(appt.groupId);
                return;
            }
        }

        // Individual check-in
        await _doCheckIn(id, appt);
        alert(`${appt.clientName} checked in and routed to ${appt.assignedTechName}!`);
    } catch(e) { alert("Error checking in: " + e.message); }
}

/** Check in all appointments sharing the same groupId */
async function checkInGroupByGroupId(groupId) {
    try {
        const snap = await db.collection('Appointments')
            .where('groupId', '==', groupId)
            .where('status', '==', 'Scheduled')
            .get();

        if (snap.empty) { alert('No scheduled group members found.'); return; }

        const batch = db.batch();
        const jobPromises = [];

        snap.forEach(doc => {
            // Update appointment status
            batch.update(doc.ref, { status: 'Arrived' });
            // Create Active_Job for each member
            const appt = doc.data();
            jobPromises.push(db.collection('Active_Jobs').add({
                clientPhone:       appt.clientPhone,
                clientName:        appt.clientName,
                assignedTechEmail: appt.assignedTechEmail,
                assignedTechName:  appt.assignedTechName,
                bookedService:     appt.bookedService  || 'N/A',
                bookedDuration:    appt.bookedDuration || '0',
                bookedPrice:       appt.bookedPrice    || '0',
                grandTotal:        appt.grandTotal     || '0',
                taxBreakdown:      appt.taxBreakdown   || '[]',
                groupId:           appt.groupId        || '',
                isGroupBooking:    true,
                groupSize:         appt.groupSize      || 1,
                status:            'Waiting',
                fohCreator:        currentUserEmail,
                createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
                dateString:        todayDateStr
            }));
        });

        await batch.commit();
        await Promise.all(jobPromises);
        alert(`Group ${groupId} checked in — ${snap.size} member(s) routed to the floor.`);
    } catch(e) { alert('Error checking in group: ' + e.message); }
}

/** Single appointment check-in helper */
async function _doCheckIn(id, appt) {
    await db.collection('Appointments').doc(id).update({ status: 'Arrived' });
    await db.collection('Active_Jobs').add({
        clientPhone:       appt.clientPhone,
        clientName:        appt.clientName,
        assignedTechEmail: appt.assignedTechEmail,
        assignedTechName:  appt.assignedTechName,
        bookedService:     appt.bookedService  || 'N/A',
        bookedDuration:    appt.bookedDuration || '0',
        bookedPrice:       appt.bookedPrice    || '0',
        grandTotal:        appt.grandTotal     || '0',
        taxBreakdown:      appt.taxBreakdown   || '[]',
        groupId:           appt.groupId        || '',
        isGroupBooking:    appt.isGroupBooking  || false,
        groupSize:         appt.groupSize       || 1,
        status:            'Waiting',
        fohCreator:        currentUserEmail,
        createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
        dateString:        todayDateStr
    });
    if (GOOGLE_CHAT_WEBHOOK !== "") {
        fetch(GOOGLE_CHAT_WEBHOOK, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `🛎️ *Client Arrived*\n*Client:* ${appt.clientName}\n*Service:* ${appt.bookedService}\n*Assigned Tech:* ${appt.assignedTechName}\n_Please check your Dashboard._` })
        }).catch(err => console.error(err));
    }
}

// ==========================================
// TECH CONSULTATION & UPSELL ENGINE
// ==========================================
window.toggleMedNone = function(checkbox) {
    if(checkbox.checked) {
        document.querySelectorAll('.med-cb').forEach(cb => { cb.checked = false; cb.disabled = true; });
    } else {
        document.querySelectorAll('.med-cb').forEach(cb => { cb.disabled = false; });
    }
}

window.openConsultation = async function(id) {
    try {
        const doc = await db.collection('Active_Jobs').doc(id).get();
        if(!doc.exists) return;
        currentConsultJobData = doc.data();
        currentConsultJobId = id;
        pendingUpsells = [];

        document.getElementById('consultClientName').innerText = currentConsultJobData.clientName;
        document.getElementById('consultCurrentTicket').innerText = currentConsultJobData.bookedService;
        document.getElementById('consultProjectedTotal').innerText = parseFloat(currentConsultJobData.grandTotal || currentConsultJobData.bookedPrice || 0).toFixed(2) + ' GHC';
        document.getElementById('consultAddedUpsells').innerHTML = '';
        document.getElementById('consultUpsellSelect').value = '';
        
        let cr = currentConsultJobData.consultationRecord || {}; 
        let md = cr.medicalHistory || [];
        
        document.querySelectorAll('.med-cb').forEach(cb => { 
            cb.checked = md.includes(cb.value); 
            cb.disabled = false; 
        });
        if(document.getElementById('med_none')){ 
            document.getElementById('med_none').checked = md.includes("None"); 
            if(md.includes("None")) document.querySelectorAll('.med-cb').forEach(c=>c.disabled=true); 
        }

        document.getElementById('med_allergies').value = cr.allergies || '';
        document.getElementById('med_other').value = cr.otherMedical || '';
        document.querySelectorAll('input[name="cond_callus"]').forEach(r => r.checked = (r.value===cr.callusLevel));
        document.querySelectorAll('input[name="cond_skin"]').forEach(r => r.checked = (r.value===cr.skinCondition));
        document.getElementById('cond_notes').value = cr.visualNotes || '';
        
        document.getElementById('consultReassignTech').value = '';

        // DYNAMIC FORM POPULATION
        let cf = cr.customFields || {};
        let dynHtml = '';
        consultTemplate.forEach(q => {
            dynHtml += `<div class="consult-section-title" style="margin-top:20px;font-size:0.95rem;">${q.label}</div><div style="margin-bottom:15px;">`;
            if(q.type === 'text') {
                dynHtml += `<input type="text" id="ans_${q.id}" value="${cf[q.id] || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:4px;">`;
            } else if(q.type === 'checkbox') {
                dynHtml += `<div class="checkbox-grid">`;
                let vArr = cf[q.id] || [];
                q.options.forEach(o => { dynHtml += `<label><input type="checkbox" class="ans_cb_${q.id}" value="${o}" ${vArr.includes(o) ? 'checked' : ''}> ${o}</label>`; });
                dynHtml += `</div>`;
            } else if(q.type === 'radio') {
                dynHtml += `<div class="radio-group">`;
                let vStr = cf[q.id] || '';
                q.options.forEach(o => { dynHtml += `<label><input type="radio" name="ans_rd_${q.id}" value="${o}" ${vStr === o ? 'checked' : ''}> ${o}</label>`; });
                dynHtml += `</div>`;
            }
            dynHtml += `</div>`;
        });
        let dynamicFormDiv = document.getElementById('dynamicConsultForm');
        if (dynamicFormDiv) dynamicFormDiv.innerHTML = dynHtml;

        let btn = document.getElementById('btnConsultSaveStart');
        if(btn) btn.innerText = (currentConsultJobData.status === 'In Progress') ? "Update Record" : "Save & Start Service";

        document.getElementById('consultationModal').style.display = 'block';
    } catch(e) { alert("Error opening consultation: " + e.message); }
}

window.closeConsultation = function() {
    document.getElementById('consultationModal').style.display = 'none';
    currentConsultJobId = null;
    currentConsultJobData = null;
    pendingUpsells = [];
}
window.closeConsult = window.closeConsultation;
window.openConsult = window.openConsultation;

window.addUpsellToTicket = function() {
    const select = document.getElementById('consultUpsellSelect');
    const sId = select.value;
    if(!sId) return;

    const sObj = allMenuServicesCache.find(s => s.id === sId);
    if(!sObj) return;

    pendingUpsells.push(sObj);
    
    let html = '';
    pendingUpsells.forEach(p => { html += `<div>+ ${p.name} (${p.price} GHC)</div>`; });
    document.getElementById('consultAddedUpsells').innerHTML = html;

    let base = parseFloat(currentConsultJobData.bookedPrice || 0);
    pendingUpsells.forEach(p => base += parseFloat(p.price || 0));

    let taxes = 0;
    liveTaxes.forEach(t => { taxes += base * (t.rate / 100); });
    
    let newGrand = base + taxes;
    document.getElementById('consultProjectedTotal').innerText = newGrand.toFixed(2) + ' GHC';
    select.value = '';
}
window.addUpsell = window.addUpsellToTicket;

window.reassignTech = async function() {
    const techEmail = document.getElementById('consultReassignTech').value;
    const selectElement = document.getElementById('consultReassignTech');
    const techName = selectElement.options[selectElement.selectedIndex]?.text;
    if(!techEmail) { alert("Please select a Technician to reassign to."); return; }

    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).update({
            assignedTechEmail: techEmail,
            assignedTechName: techName
        });
        alert(`Ticket successfully reassigned to ${techName}.`);
        closeConsultation();
    } catch(e) { alert("Error reassigning: " + e.message); }
}
window.reassign = window.reassignTech;

window.requestReschedule = async function() {
    if(!confirm("Are you sure you want to cancel this Active Job and send it back to Front of House to Reschedule?")) return;
    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).delete();
        
        const snap = await db.collection('Appointments')
            .where('clientPhone', '==', currentConsultJobData.clientPhone)
            .where('dateString', '==', currentConsultJobData.dateString)
            .get();
            
        if(!snap.empty) {
            await db.collection('Appointments').doc(snap.docs[0].id).update({ status: 'Action Required' });
        }
        alert("Ticket removed. Front of House has been notified.");
        closeConsultation();
    } catch(e) { alert("Error rescheduling: " + e.message); }
}
window.reqReschedule = window.requestReschedule;

window.saveConsultationAndStart = async function() {
    let medChecks = [];
    document.querySelectorAll('.med-cb:checked').forEach(cb => medChecks.push(cb.value));
    if(document.getElementById('med_none').checked) medChecks = ["None"];

    let cust = {}; 
    consultTemplate.forEach(q => { 
        if(q.type === 'text') cust[q.id] = document.getElementById('ans_'+q.id)?.value || ''; 
        else if(q.type === 'checkbox') {
            let a = []; 
            document.querySelectorAll('.ans_cb_'+q.id+':checked').forEach(c => a.push(c.value)); 
            cust[q.id] = a;
        } else if(q.type === 'radio') {
            cust[q.id] = document.querySelector('input[name="ans_rd_'+q.id+'"]:checked')?.value || ''; 
        }
    });

    let consultData = {
        medicalHistory: medChecks,
        allergies: document.getElementById('med_allergies').value.trim(),
        otherMedical: document.getElementById('med_other').value.trim(),
        callusLevel: document.querySelector('input[name="cond_callus"]:checked')?.value || "Not specified",
        skinCondition: document.querySelector('input[name="cond_skin"]:checked')?.value || "Not specified",
        visualNotes: document.getElementById('cond_notes').value.trim(),
        customFields: cust,
        assessedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    let base = parseFloat(currentConsultJobData.bookedPrice || 0);
    let serviceStr = currentConsultJobData.bookedService;
    let dur = parseInt(currentConsultJobData.bookedDuration || 0);

    if(pendingUpsells.length > 0) {
        pendingUpsells.forEach(p => {
            base += parseFloat(p.price || 0);
            dur += parseInt(p.duration || 0);
            serviceStr += `, ${p.name}`;
        });
    }

    let newTaxArr = [];
    let totalTaxes = 0;
    liveTaxes.forEach(t => {
        let tAmt = base * (t.rate / 100);
        totalTaxes += tAmt;
        newTaxArr.push({ name: t.name, rate: t.rate, amount: tAmt });
    });
    
    let newGrand = base + totalTaxes;

    try {
        await db.collection('Active_Jobs').doc(currentConsultJobId).update({
            status: 'In Progress',
            consultationRecord: consultData,
            bookedPrice: base,
            bookedService: serviceStr,
            bookedDuration: dur,
            taxBreakdown: JSON.stringify(newTaxArr),
            grandTotal: newGrand
        });
        closeConsultation();
    } catch(e) { alert("Error saving consultation: " + e.message); }
}
window.saveConsult = window.saveConsultationAndStart;

function startTechQueueListener() {
    const queueDiv = document.getElementById('techLiveQueue');
    try {
        techQueueListener = db.collection('Active_Jobs')
            .where('assignedTechEmail', '==', currentUserEmail)
            .where('status', 'in', ['Waiting', 'In Progress'])
            .onSnapshot(snap => {
                if(snap.empty) { queueDiv.innerHTML = '<p style="color: #999; font-style: italic;">Queue is currently empty.</p>'; return; }
                
                queueDiv.innerHTML = '';
                snap.forEach(doc => {
                    let job = doc.data();
                    
                    let div = document.createElement('div');
                    div.className = 'ticket';
                    div.style.borderColor = job.status === 'Waiting' ? 'var(--accent)' : 'var(--manager)';
                    
                    let infoDiv = document.createElement('div');
                    infoDiv.style.flexGrow = '1';
                    infoDiv.innerHTML = `
                        <h4 style="margin:0; font-size:1.1rem;">${job.clientName}</h4>
                        <span class="ticket-badge" style="background:${job.status === 'Waiting' ? '#f39c12' : '#2980b9'}; margin-bottom:5px;">${job.status.toUpperCase()}</span>
                        <p style="margin:0; font-size:0.85rem; color:var(--primary);">💅 <strong>${job.bookedService}</strong></p>
                    `;
                    
                    let btnWrapper = document.createElement('div');
                    btnWrapper.style.width = '140px';
                    
                    let btn = document.createElement('button');
                    btn.className = 'btn';
                    btn.style.width = '100%';
                    btn.style.padding = '8px';
                    btn.style.fontSize = '0.8rem';
                    
                    if (job.status === 'Waiting') {
                        btn.innerText = 'Consultation';
                        btn.addEventListener('click', () => window.openConsultation(doc.id));
                    } else {
                        btn.innerText = 'Complete Job';
                        btn.style.background = 'var(--success)';
                        btn.addEventListener('click', async () => { 
                            try { await db.collection('Active_Jobs').doc(doc.id).update({ status: 'Ready for Payment' }); }
                            catch(e) { alert("Error: " + e.message); }
                        });
                        
                        let btnEdit = document.createElement('button');
                        btnEdit.className = 'btn btn-secondary';
                        btnEdit.style.width = '100%';
                        btnEdit.style.padding = '5px';
                        btnEdit.style.marginBottom = '5px';
                        btnEdit.style.fontSize = '0.75rem';
                        btnEdit.innerText = 'Edit Record';
                        btnEdit.addEventListener('click', () => window.openConsultation(doc.id));
                        btnWrapper.appendChild(btnEdit);
                    }
                    
                    btnWrapper.appendChild(btn);
                    div.appendChild(infoDiv);
                    div.appendChild(btnWrapper);
                    queueDiv.appendChild(div);
                });
            });
    } catch(e) { console.error(e); }
}

function startFohBillingListener() {
    const listDiv = document.getElementById('fohPendingCheckoutList');
    try {
        fohBillingListener = db.collection('Active_Jobs')
            .where('status', '==', 'Ready for Payment')
            .onSnapshot(snap => {
                if(snap.empty) { 
                    listDiv.innerHTML = '<p style="color: #999; font-style: italic;">No pending checkouts.</p>'; 
                    document.getElementById('checkoutPanel').style.display = 'none';
                    return; 
                }
                listDiv.innerHTML = '';
                snap.forEach(doc => {
                    let job = doc.data();
                    
                    let taxes = [];
                    try { taxes = JSON.parse(job.taxBreakdown || '[]'); } catch(e){}
                    let subtotal = parseFloat(job.bookedPrice || 0).toFixed(2);
                    let grandTotal = parseFloat(job.grandTotal || job.bookedPrice || 0).toFixed(2);

                    let taxHtml = '';
                    taxes.forEach(t => { taxHtml += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#777;"><span>+ ${t.name}</span><span>${parseFloat(t.amount).toFixed(2)} GHC</span></div>`; });

                    let div = document.createElement('div');
                    div.className = 'ticket';
                    div.style.borderColor = 'var(--success)';
                    div.style.padding = '10px';
                    
                    let infoDiv = document.createElement('div');
                    infoDiv.style.flexGrow = '1';
                    infoDiv.innerHTML = `
                        <h4 style="margin:0; font-size:1rem; color:var(--success);">${job.clientName}</h4>
                        <p style="margin:0; font-size:0.8rem; margin-bottom:5px;">💅 ${job.bookedService}</p>
                        <div style="background:#f1f1f1; padding:8px; border-radius:4px; max-width:250px;">
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem;"><span>Subtotal:</span><span>${subtotal} GHC</span></div>
                            ${taxHtml}
                            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:0.9rem; margin-top:3px; border-top:1px solid #ddd; padding-top:3px;"><span>Total:</span><span>${grandTotal} GHC</span></div>
                        </div>
                    `;
                    
                    let btn = document.createElement('button');
                    btn.className = 'btn';
                    btn.style.background = 'var(--success)';
                    btn.style.width = 'auto';
                    btn.style.padding = '5px 15px';
                    btn.style.fontSize = '0.8rem';
                    btn.innerText = 'Checkout';
                    btn.onclick = function() {
                        window.openCheckout(doc.id, job.clientName, job.bookedService, subtotal, taxHtml, grandTotal);
                    };
                    
                    div.appendChild(infoDiv);
                    div.appendChild(btn);
                    listDiv.appendChild(div);
                });
            });
    } catch(e) { console.error(e); }
}

window.openCheckout = function(id, name, services, subtotal, taxHtml, grandTotal) {
    document.getElementById('checkoutJobId').value = id;
    document.getElementById('checkoutClientName').innerText = name;
    document.getElementById('checkoutServices').innerText = services;
    document.getElementById('checkoutSubtotal').innerText = subtotal + ' GHC';
    document.getElementById('checkoutTaxList').innerHTML = taxHtml;
    document.getElementById('checkoutTotal').innerText = grandTotal + ' GHC';
    document.getElementById('checkoutGrandTotalVal').value = grandTotal;
    document.getElementById('checkoutPaymentMethod').value = '';
    document.getElementById('checkoutPanel').style.display = 'block';
    document.getElementById('checkoutPanel').scrollIntoView({behavior: 'smooth'});
}

window.confirmPayment = async function() {
    const id = document.getElementById('checkoutJobId').value;
    const method = document.getElementById('checkoutPaymentMethod').value;
    const price = parseFloat(document.getElementById('checkoutGrandTotalVal').value) || 0; 
    
    if(!method) { alert("Please select a Payment Method."); return; }
    
    try {
        await db.collection('Active_Jobs').doc(id).update({
            status: 'Closed',
            paymentMethod: method,
            totalGHC: price,
            closedAt: firebase.firestore.FieldValue.serverTimestamp(),
            closedBy: currentUserEmail
        });
        alert("Payment processed successfully!");
        document.getElementById('checkoutPanel').style.display = 'none';
    } catch(e) { alert("Error processing payment: " + e.message); }
}

window.generateReport = async function() {
    const start = document.getElementById('reportStart').value;
    const end = document.getElementById('reportEnd').value;
    if(!start || !end) { alert("Please select both a Start Date and End Date."); return; }

    try {
        const snap = await db.collection('Active_Jobs')
            .where('status', '==', 'Closed')
            .where('dateString', '>=', start)
            .where('dateString', '<=', end)
            .get();

        let totalRev = 0; let techStats = {};

        snap.forEach(doc => {
            const job = doc.data(); 
            totalRev += parseFloat(job.totalGHC) || 0;
        });

        document.getElementById('reportTotalRevenue').innerText = totalRev.toFixed(2) + " GHC";
        let tbody = '';
        for(const email in techStats) { tbody += `<tr><td><strong>${techStats[email].name}</strong></td><td style="text-align:center;">${techStats[email].count}</td><td style="text-align:right;">${techStats[email].rev.toFixed(2)} GHC</td></tr>`; }
        if(tbody === '') tbody = '<tr><td colspan="3" style="text-align:center; color: #999;">No completed services found in this date range.</td></tr>';
        
        document.getElementById('reportTechBody').innerHTML = tbody; document.getElementById('reportResults').style.display = 'block';
    } catch (e) { console.error(e); alert("Error generating report: " + e.message); }
}

function startFohFinancialListener() {
    try {
        fohFinancialListener = db.collection('Active_Jobs').where('status', '==', 'Closed').where('dateString', '==', todayDateStr).onSnapshot(snap => {
            let totalRev = 0; let jobCount = 0;
            snap.forEach(doc => { totalRev += parseFloat(doc.data().totalGHC) || 0; jobCount++; });
            document.getElementById('fohDailyRevenue').innerText = totalRev.toFixed(2) + " GHC"; document.getElementById('fohDailyJobs').innerText = jobCount;
        });
    } catch(e) { console.error(e); }
}

function startTechFinancialListener() {
    try {
        techFinancialListener = db.collection('Active_Jobs')
            .where('status', '==', 'Closed')
            .where('dateString', '==', todayDateStr)
            .where('assignedTechEmail', '==', currentUserEmail)
            .onSnapshot(snap => {
                let techRev = 0; let serviceCount = 0;
                snap.forEach(doc => {
                    let job = doc.data();
                    techRev += parseFloat(job.totalGHC) || 0;
                    serviceCount++;
                });
                document.getElementById('techDailyRevenue').innerText = techRev.toFixed(2) + " GHC"; 
                document.getElementById('techServiceCount').innerText = serviceCount;
            });
    } catch(e) { console.error(e); }
}

function startFohRosterListener() {
    const rosterDiv = document.getElementById('fohRosterList');
    try {
        fohRosterListener = db.collection('Attendance').where('date', '==', todayDateStr).onSnapshot(async (attendanceSnap) => {
            
            const activeJobsSnap = await db.collection('Active_Jobs').where('status', 'in', ['Waiting', 'In Progress']).get();
            let busyTechEmails = []; activeJobsSnap.forEach(job => { busyTechEmails.push(job.data().assignedTechEmail); });

            const scheduledSnap = await db.collection('Appointments').where('dateString', '==', todayDateStr).where('status', '==', 'Scheduled').get();
            let now = new Date();
            let currentMins = now.getHours() * 60 + now.getMinutes();

            scheduledSnap.forEach(doc => {
                let appt = doc.data();
                let aStart = timeToMins(appt.timeString);
                let aEnd = aStart + parseInt(appt.bookedDuration || 0);
                if (currentMins >= aStart && currentMins < aEnd) { busyTechEmails.push(appt.assignedTechEmail); }
            });

            let html = '';
            attendanceSnap.forEach(doc => {
                const tech = doc.data(); 
                if(tech.clockOut || !(tech.roleString && (tech.roleString.toLowerCase().includes('tech') || tech.roleString.toLowerCase().includes('test tech')))) return; 
                
                const isBusy = busyTechEmails.includes(tech.email);
                const statusDot = isBusy ? 'status-busy' : 'status-available';
                const statusText = isBusy ? '<span style="color:var(--error); font-size:0.8rem; font-weight:bold;">BUSY</span>' : '<span style="color:var(--success); font-size:0.8rem; font-weight:bold;">AVAILABLE</span>';
                html += `<div class="roster-item"><div><strong>${tech.name}</strong></div><div style="display:flex; align-items:center;"><span class="status-dot ${statusDot}"></span> ${statusText}</div></div>`;
            });
            
            if(html === '') html = '<p style="color: #999; font-style: italic;">No Technicians currently on the floor.</p>';
            rosterDiv.innerHTML = html;
        });
    } catch(e) { console.error(e); }
}

window.loadStaffDirectory = function() {
    const listDiv = document.getElementById('adminStaffList');
    if (!listDiv) return;

    listDiv.innerHTML = '<p style="color: #000; font-weight:bold;">Loading directory... Please wait.</p>';

    db.collection('Users').onSnapshot((snap) => {
        if (snap.empty) { listDiv.innerHTML = '<p style="color: #999;">No staff found.</p>'; return; }

        listDiv.innerHTML = '';
        const table = document.createElement('table');
        table.className = 'breakdown-table'; table.style.marginTop = '0';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Name</th><th>Google Email</th><th>Departments</th><th style="text-align:center;">Client Visible</th><th style="text-align:center;">Action</th></tr>';
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        snap.forEach(doc => {
            try {
                let data = doc.data() || {};
                let name = data.name ? String(data.name).replace(/['"]/g, "") : "Unknown";
                let email = doc.id;

                let rolesArr = [];
                if (data.roles && Array.isArray(data.roles)) { rolesArr = data.roles; } 
                else if (data.roles && typeof data.roles === 'string') { rolesArr = [data.roles]; } 
                else if (data.role && typeof data.role === 'string') { rolesArr = [data.role]; }

                let validRoles = rolesArr.filter(r => r);
                let rolesStr = validRoles.join(',');
                let tagsHtml = validRoles.map(r => {
                    let c = (r.toLowerCase().includes('admin')) ? 'var(--admin)' : (r === 'Manager' ? 'var(--manager)' : (r === 'Supply Chain' ? 'var(--supply)' : (r === 'FOH' ? '#e74c3c' : 'var(--primary)')));
                    return `<span class="ticket-badge" style="background:${c}; margin-right: 5px; display:inline-block; margin-bottom:3px;">${r}</span>`;
                }).join('');

                let tr = document.createElement('tr');
                
                let tdName = document.createElement('td'); tdName.innerHTML = `<strong>${name}</strong>`;
                let tdEmail = document.createElement('td'); tdEmail.style.color = '#666'; tdEmail.innerText = email;
                let tdRoles = document.createElement('td'); tdRoles.innerHTML = tagsHtml;
                
                let tdAction = document.createElement('td');
                tdAction.style.textAlign = 'center'; tdAction.style.display = 'flex'; tdAction.style.gap = '5px'; tdAction.style.justifyContent = 'center';

                // visibleToClients toggle — only relevant for techs
                const isTechRow = validRoles.some(r => r.toLowerCase().includes('tech'));
                const isVisible = data.visibleToClients !== false;
                let tdVisible = document.createElement('td');
                tdVisible.style.textAlign = 'center';
                tdVisible.style.verticalAlign = 'middle';
                if (isTechRow) {
                    tdVisible.innerHTML = `<button onclick="window.toggleClientVisible('${email}', ${isVisible})"
                        style="border:none; background:${isVisible ? 'var(--success)' : '#ccc'}; color:white;
                        padding:4px 12px; border-radius:12px; cursor:pointer; font-size:0.75rem; font-weight:700;">
                        ${isVisible ? '✓ Visible' : '✕ Hidden'}
                    </button>`;
                } else {
                    tdVisible.innerHTML = '<span style="color:#ccc; font-size:0.75rem;">N/A</span>';
                }

                let btnEdit = document.createElement('button');
                btnEdit.className = 'btn'; btnEdit.style.cssText = 'padding:5px 10px; width:auto; font-size:0.75rem; background:var(--primary);';
                btnEdit.innerText = 'Edit'; btnEdit.onclick = function() { window.editStaff(email, name, rolesStr); };

                let btnRevoke = document.createElement('button');
                btnRevoke.className = 'btn btn-secondary'; btnRevoke.style.cssText = 'padding:5px 10px; width:auto; font-size:0.75rem; color:red; border-color:red;';
                btnRevoke.innerText = 'Del'; btnRevoke.onclick = function() { window.removeStaffAccount(email); };

                tdAction.appendChild(btnEdit); tdAction.appendChild(btnRevoke);
                tr.appendChild(tdName); tr.appendChild(tdEmail); tr.appendChild(tdRoles); tr.appendChild(tdVisible); tr.appendChild(tdAction);
                tbody.appendChild(tr);

            } catch(innerErr) { console.log("Skipped corrupted user:", doc.id); }
        });
        table.appendChild(tbody); listDiv.appendChild(table);
    }, (error) => {
        listDiv.innerHTML = `<div style="background:#ffebee; padding:15px; border:1px solid red; border-radius:4px; color:red;"><strong>Database Error!</strong><br>${error.message}</div>`;
    });
}

window.editStaff = function(email, name, rolesStr) {
    document.getElementById('admin_newEmail').value = email;
    document.getElementById('admin_newName').value = name;
    document.getElementById('admin_newPassword').value = '';
    document.getElementById('admin_newPassword').placeholder = "(Leave blank to keep current password)";
    
    const safeRoles = rolesStr.toLowerCase().split(',');
    document.querySelectorAll('.role-checkbox').forEach(cb => { cb.checked = safeRoles.includes(cb.value.toLowerCase()); });
    window.scrollTo(0, 0);
}

window.addStaffAccount = async function() {
    const name = document.getElementById('admin_newName').value.trim();
    const email = document.getElementById('admin_newEmail').value.trim().toLowerCase();
    const password = document.getElementById('admin_newPassword').value;
    const selectedRoles = Array.from(document.querySelectorAll('.role-checkbox:checked')).map(cb => cb.value);
    
    if(!name || !email || selectedRoles.length === 0) { alert("Please fill all required fields and select at least one department."); return; }
    
    if (password) {
        try {
            await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
            await secondaryApp.auth().signOut(); 
        } catch (authError) { 
            if(authError.code !== 'auth/email-already-in-use') { alert(`Failed to create login credential.\n\nError: ${authError.message}`); return; }
        }
    }
    try {
        await db.collection('Users').doc(email).set({ name: name, roles: selectedRoles, updatedBy: currentUserEmail, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        alert(`Success! Staff profile updated in Matrix for ${name}.`);
        document.getElementById('admin_newName').value = ''; document.getElementById('admin_newEmail').value = ''; document.getElementById('admin_newPassword').value = '';
        document.getElementById('admin_newPassword').placeholder = "(Optional) Min 6 chars";
        document.querySelectorAll('.role-checkbox').forEach(cb => cb.checked = false);
        fetchAllTechs();
    } catch(dbError) { alert("Database Error: " + dbError.message); }
}

window.removeStaffAccount = async function(email) {
    if(email === currentUserEmail) { alert("You cannot revoke your own admin access from here."); return; }
    if(confirm(`Are you absolutely sure you want to permanently revoke system access for ${email}?`)) {
        try { await db.collection('Users').doc(email).delete(); alert("Access revoked."); fetchAllTechs(); } 
        catch(e) { alert("Error revoking access: " + e.message); }
    }
}

window.toggleClientVisible = async function(email, currentlyVisible) {
    const newVal = !currentlyVisible;
    const label  = newVal ? 'visible to clients' : 'hidden from clients';
    if (!confirm(`Set ${email} as ${label}?`)) return;
    try {
        await db.collection('Users').doc(email).update({ visibleToClients: newVal });
        fetchAllTechs();
    } catch(e) { alert('Error updating visibility: ' + e.message); }
}

// --- DYNAMIC CONSULTATION BUILDER (Form Engine) ---
function startConsultTemplateListener() {
    db.collection('Settings').doc('consultation').onSnapshot(d => { 
        consultTemplate = d.exists && d.data().fields ? d.data().fields : []; 
        renderFormBuilderUI(); 
    });
}

window.addConsultQuestion = async function() {
    let lbl = document.getElementById('bld_label').value.trim();
    let typ = document.getElementById('bld_type').value;
    let opts = document.getElementById('bld_opts').value.split(',').map(s=>s.trim()).filter(s=>s);
    
    if(!lbl) return alert("Label needed."); 
    if(typ !== 'text' && !opts.length) return alert("Options needed.");
    
    let n = [...consultTemplate, {id: 'q_' + Date.now(), label: lbl, type: typ, options: opts}];
    await db.collection('Settings').doc('consultation').set({fields: n}, {merge: true}); 
    document.getElementById('bld_label').value = ''; 
    document.getElementById('bld_opts').value = '';
}

window.deleteConsultQuestion = async function(id) { 
    if(confirm("Remove?")) {
        await db.collection('Settings').doc('consultation').set({fields: consultTemplate.filter(q => q.id !== id)}, {merge: true}); 
    }
}

function renderFormBuilderUI() {
    let el = document.getElementById('consultBuilderList'); 
    if(!el) return;
    el.innerHTML = consultTemplate.length ? consultTemplate.map(q => `<div style="display:flex;justify-content:space-between;padding:10px;border:1px solid #ccc;margin-bottom:5px;border-radius:4px;background:white;"><div><strong style="color:var(--primary);">${q.label}</strong> <span style="font-size:0.75rem;background:#eee;padding:2px 5px;border-radius:4px;margin-left:5px;">${q.type.toUpperCase()}</span>${q.type !== 'text' ? '<br><small style="color:#666;">Options: ' + q.options.join(', ') + '</small>' : ''}</div><button class="btn" style="background:var(--error);padding:5px 10px;width:auto;font-size:0.75rem;" onclick="deleteConsultQuestion('${q.id}')">Remove</button></div>`).join('') : '<p style="color:#999;font-style:italic;">No custom questions.</p>';
}


// ============================================================
//  CLIENT INTELLIGENCE PANEL
// ============================================================

let _cip_clientData    = null;
let _cip_allVisits     = [];
let _cip_activeTab     = 'visits';

// ── Open panel ────────────────────────────────────────────────
// ── Live search for Client Intel tab ─────────────────────────
window.cip_liveSearch = async function() {
    clearTimeout(window._cip_searchTimeout);
    window._cip_searchTimeout = setTimeout(async () => {
        const val    = document.getElementById('cip_searchInput')?.value?.toLowerCase().trim() || '';
        const resDiv = document.getElementById('cip_searchResults');
        if (val.length < 2) { resDiv.style.display = 'none'; return; }

        // Use cached clients if available
        if (allClientsCache.length === 0) {
            const snap = await db.collection('Clients').get();
            allClientsCache = [];
            snap.forEach(d => allClientsCache.push({ id: d.id, ...d.data() }));
        }

        const matches = allClientsCache.filter(c => {
            const name  = `${c.Forename||''} ${c.Surname||''}`.toLowerCase();
            const phone = (c.Tel_Number||'').toLowerCase();
            return name.includes(val) || phone.includes(val);
        }).slice(0, 8);

        if (!matches.length) { resDiv.style.display = 'none'; return; }

        resDiv.innerHTML = matches.map(m => {
            const name = `${m.Forename||''} ${m.Surname||''}`.trim() || 'Unknown';
            return `<button class="search-result-item" onclick="cip_open(${JSON.stringify(m).replace(/"/g, '&quot;')})">
                <strong>${name}</strong> &nbsp;·&nbsp; <span style="color:#666;">${m.Tel_Number||''}</span>
            </button>`;
        }).join('');
        resDiv.style.display = 'block';
    }, 250);
};

// ── Open panel (now works as tab section) ─────────────────────
window.cip_open = async function(clientData) {
    _cip_clientData = clientData;
    _cip_allVisits  = [];

    // Hide search results
    const resDiv = document.getElementById('cip_searchResults');
    if (resDiv) resDiv.style.display = 'none';
    const searchInput = document.getElementById('cip_searchInput');
    if (searchInput) {
        const name = `${clientData.Forename||''} ${clientData.Surname||''}`.trim();
        searchInput.value = name;
    }

    // Show panel
    const panel = document.getElementById('cip_panel');
    if (panel) panel.style.display = 'block';

    const phone    = clientData.Tel_Number || '';
    const fullName = `${clientData.Forename || ''} ${clientData.Surname || ''}`.trim() || 'Unknown Client';

    // Set header
    const nameEl = document.getElementById('cip_name');
    const subEl  = document.getElementById('cip_sub');
    if (nameEl) nameEl.textContent = fullName;
    if (subEl)  subEl.textContent  = `📞 ${phone}${clientData.Email ? '  ·  ✉ ' + clientData.Email : ''}`;

    // Reset tabs
    document.querySelectorAll('.cip-tab').forEach(t => t.classList.remove('cip-tab--active'));
    const firstTab = document.querySelector('.cip-tab');
    if (firstTab) firstTab.classList.add('cip-tab--active');
    document.querySelectorAll('[id^="cip_tab_"]').forEach(t => t.style.display = 'none');
    const visitsTab = document.getElementById('cip_tab_visits');
    if (visitsTab) visitsTab.style.display = 'block';

    // Reset badges
    ['cip_vipBadge','cip_lapsedBadge','cip_birthdayBadge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Scroll panel into view
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Load data
    await cip_loadData(phone, clientData);
};

// ── Load all data ─────────────────────────────────────────────
async function cip_loadData(phone, clientData) {
    try {
        // Fetch appointments + staff notes in parallel
        const [apptSnap, notesDoc] = await Promise.all([
            db.collection('Appointments')
                .where('clientPhone', '==', phone)
                .get(),
            db.collection('Client_Notes').doc(phone).get()
        ]);

        // Build visits array — closed jobs only
        _cip_allVisits = [];
        apptSnap.forEach(d => {
            const a = d.data();
            if (['Closed','Completed'].includes(a.status)) {
                _cip_allVisits.push({ id: d.id, ...a });
            }
        });
        _cip_allVisits.sort((a, b) => (b.dateString||'').localeCompare(a.dateString||''));

        // ── Compute metrics ───────────────────────────────────
        const totalVisits = _cip_allVisits.length;
        const totalSpend  = _cip_allVisits.reduce((s, a) => s + parseFloat(a.grandTotal || 0), 0);
        const avgSpend    = totalVisits > 0 ? totalSpend / totalVisits : 0;
        const thisYear    = new Date().getFullYear().toString();
        const thisYearSpend = _cip_allVisits
            .filter(a => (a.dateString||'').startsWith(thisYear))
            .reduce((s, a) => s + parseFloat(a.grandTotal || 0), 0);
        const lastVisit   = _cip_allVisits[0]?.dateString || null;

        // Favourite service
        const svcCount = {};
        _cip_allVisits.forEach(a => {
            const s = (a.bookedService || '').split(',')[0].trim();
            if (s) svcCount[s] = (svcCount[s] || 0) + 1;
        });
        const favService = Object.entries(svcCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

        // Favourite technician
        const techCount = {};
        _cip_allVisits.forEach(a => {
            const t = a.assignedTechName || '';
            if (t && t !== 'To be assigned') techCount[t] = (techCount[t] || 0) + 1;
        });
        const favTech = Object.entries(techCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

        // Visit frequency (avg days between visits)
        let frequency = '—';
        if (_cip_allVisits.length >= 2) {
            const dates = _cip_allVisits.map(a => new Date(a.dateString + 'T12:00:00')).filter(d => !isNaN(d));
            if (dates.length >= 2) {
                let totalGap = 0;
                for (let i = 0; i < dates.length - 1; i++) {
                    totalGap += Math.abs(dates[i] - dates[i+1]) / 86400000;
                }
                const avgDays = Math.round(totalGap / (dates.length - 1));
                frequency = avgDays < 30 ? `${avgDays}d` : `${Math.round(avgDays/30)}mo`;
            }
        }

        // ── Update metrics UI ─────────────────────────────────
        document.getElementById('cip_totalVisits').textContent = totalVisits;
        document.getElementById('cip_totalSpend').textContent  = totalSpend.toFixed(0) + ' GHC';
        document.getElementById('cip_avgSpend').textContent    = avgSpend.toFixed(0) + ' GHC';
        document.getElementById('cip_thisYear').textContent    = thisYearSpend.toFixed(0) + ' GHC';
        document.getElementById('cip_lastVisit').textContent   = lastVisit ? cip_fmtDate(lastVisit) : '—';
        document.getElementById('cip_favService').textContent  = favService.length > 12 ? favService.slice(0,12)+'…' : favService;
        document.getElementById('cip_favTech').textContent     = favTech.split(' ')[0] || '—';
        document.getElementById('cip_frequency').textContent   = frequency;

        // ── Badges / flags ────────────────────────────────────
        // VIP: 10+ visits or 2000+ GHC total
        if (totalVisits >= 10 || totalSpend >= 2000) {
            document.getElementById('cip_vipBadge').style.display = 'inline-block';
        }

        // Lapsed: no visit in 60+ days
        if (lastVisit) {
            const daysSince = Math.floor((new Date() - new Date(lastVisit + 'T12:00:00')) / 86400000);
            if (daysSince >= 60) {
                document.getElementById('cip_lapsedBadge').style.display = 'inline-block';
            }
        }

        // Birthday: DOB on file and within 7 days
        if (clientData.DOB) {
            try {
                const dob  = new Date(clientData.DOB);
                const now  = new Date();
                const bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
                const diff = Math.ceil((bday - now) / 86400000);
                if (diff >= 0 && diff <= 7) {
                    document.getElementById('cip_birthdayBadge').style.display = 'inline-block';
                }
            } catch(e) {}
        }

        // ── Year filter ───────────────────────────────────────
        const years = [...new Set(_cip_allVisits.map(a => (a.dateString||'').slice(0,4)).filter(Boolean))];
        const yearSel = document.getElementById('cip_yearFilter');
        yearSel.innerHTML = '<option value="all">All Years</option>';
        years.forEach(y => { yearSel.innerHTML += `<option value="${y}">${y}</option>`; });

        // ── Render visits ─────────────────────────────────────
        cip_filterVisits();

        // ── Staff notes ───────────────────────────────────────
        const notes = notesDoc.exists ? (notesDoc.data().notes || '') : '';
        document.getElementById('cip_notesInput').value = notes;
        document.getElementById('cip_notesSaved').textContent = '';

        // ── Last consultation ─────────────────────────────────
        await cip_loadLastConsultation(phone);

        // ── Alerts ────────────────────────────────────────────
        cip_renderAlerts(clientData, totalVisits, totalSpend, lastVisit);

    } catch(e) {
        console.error('CIP error:', e);
    }
}

// ── Visit list ────────────────────────────────────────────────
window.cip_filterVisits = function() {
    const year  = document.getElementById('cip_yearFilter')?.value || 'all';
    const list  = document.getElementById('cip_visitList');
    const visits = year === 'all'
        ? _cip_allVisits
        : _cip_allVisits.filter(a => (a.dateString||'').startsWith(year));

    if (!visits.length) {
        list.innerHTML = '<p style="color:#999; text-align:center; padding:20px; font-style:italic;">No visits found.</p>';
        return;
    }

    list.innerHTML = visits.map(a => {
        const amt  = parseFloat(a.grandTotal || 0).toFixed(2);
        const tech = a.assignedTechName || 'Unknown';
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f1f1f1; flex-wrap:wrap; gap:6px;">
            <div>
                <strong style="font-size:0.88rem; color:var(--primary);">${cip_fmtDate(a.dateString)}</strong>
                <p style="margin:2px 0; font-size:0.8rem; color:#555;">💅 ${a.bookedService || 'N/A'}</p>
                <p style="margin:0; font-size:0.78rem; color:#999;">👩‍🔧 ${tech} · ${a.bookedDuration || 0} mins</p>
            </div>
            <div style="text-align:right;">
                <strong style="color:var(--success); font-size:0.9rem;">${amt} GHC</strong>
                ${a.isGroupBooking ? '<br><span style="font-size:0.7rem; background:var(--manager); color:white; padding:2px 6px; border-radius:8px;">GROUP</span>' : ''}
            </div>
        </div>`;
    }).join('');
};

// ── Last consultation ─────────────────────────────────────────
async function cip_loadLastConsultation(phone) {
    const el = document.getElementById('cip_consultDisplay');
    try {
        // Find the most recent closed appointment with consultation data
        const snap = await db.collection('Appointments')
            .where('clientPhone', '==', phone)
            .where('status', '==', 'Closed')
            .get();

        let latest = null;
        snap.forEach(d => {
            const a = d.data();
            if (a.consultation && (!latest || a.dateString > latest.dateString)) {
                latest = a;
            }
        });

        if (!latest || !latest.consultation) {
            el.innerHTML = '<p style="color:#999; text-align:center; padding:20px; font-style:italic;">No consultation notes on record.</p>';
            return;
        }

        const c = latest.consultation;
        const flaggedDate = cip_fmtDate(latest.dateString);
        const isOld = (() => {
            try {
                const days = Math.floor((new Date() - new Date(latest.dateString + 'T12:00:00')) / 86400000);
                return days > 180;
            } catch(e) { return false; }
        })();

        el.innerHTML = `
            <div style="background:#fafafa; border:1px solid var(--border); border-radius:6px; padding:16px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                    <p style="font-weight:700; color:var(--primary); margin:0;">Last consultation: ${flaggedDate}</p>
                    ${isOld ? '<span style="background:var(--error); color:white; font-size:0.72rem; padding:2px 8px; border-radius:10px; font-weight:700;">⚠️ OUTDATED — over 6 months ago</span>' : ''}
                </div>
                <div class="grid-2" style="gap:10px;">
                    ${c.callus ? `<div><label style="font-size:0.72rem; text-transform:uppercase; color:#999; letter-spacing:1px;">Callus Level</label><p style="font-weight:600; color:var(--primary); margin:2px 0;">${c.callus}</p></div>` : ''}
                    ${c.skin   ? `<div><label style="font-size:0.72rem; text-transform:uppercase; color:#999; letter-spacing:1px;">Skin Condition</label><p style="font-weight:600; color:var(--primary); margin:2px 0;">${c.skin}</p></div>` : ''}
                    ${c.medical?.length ? `<div><label style="font-size:0.72rem; text-transform:uppercase; color:#999; letter-spacing:1px;">Medical Flags</label><p style="font-weight:600; color:var(--error); margin:2px 0;">⚠️ ${c.medical.join(', ')}</p></div>` : ''}
                    ${c.allergies ? `<div><label style="font-size:0.72rem; text-transform:uppercase; color:#999; letter-spacing:1px;">Allergies</label><p style="font-weight:600; color:var(--primary); margin:2px 0;">${c.allergies}</p></div>` : ''}
                </div>
                ${c.notes ? `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border);"><label style="font-size:0.72rem; text-transform:uppercase; color:#999; letter-spacing:1px;">Visual Mapping Notes</label><p style="color:var(--primary); margin:4px 0; font-size:0.88rem;">${c.notes}</p></div>` : ''}
            </div>`;
    } catch(e) {
        el.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px;">Error loading consultation: ${e.message}</p>`;
    }
}

// ── Alerts ────────────────────────────────────────────────────
function cip_renderAlerts(clientData, totalVisits, totalSpend, lastVisit) {
    const el     = document.getElementById('cip_alertsList');
    const alerts = [];

    // VIP
    if (totalVisits >= 10 || totalSpend >= 2000) {
        alerts.push({ icon:'⭐', color:'var(--accent)', title:'VIP Client', msg:`${totalVisits} visits · ${totalSpend.toFixed(0)} GHC lifetime spend. Give priority treatment.` });
    }

    // Lapsed
    if (lastVisit) {
        const days = Math.floor((new Date() - new Date(lastVisit + 'T12:00:00')) / 86400000);
        if (days >= 60) {
            alerts.push({ icon:'💤', color:'var(--error)', title:'Lapsed Client', msg:`Last visit was ${days} days ago. Consider a re-engagement offer.` });
        }
    }

    // Birthday
    if (clientData.DOB) {
        try {
            const dob  = new Date(clientData.DOB);
            const now  = new Date();
            const bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
            const diff = Math.ceil((bday - now) / 86400000);
            if (diff >= 0 && diff <= 7) {
                alerts.push({ icon:'🎂', color:'#f39c12', title:'Birthday This Week!', msg:`${clientData.Forename || 'Client'}'s birthday is ${diff === 0 ? 'today' : `in ${diff} day${diff>1?'s':''}`}. Consider a complimentary treat.` });
            }
        } catch(e) {}
    }

    // Medical flags from Clients collection
    if (clientData.Medical && clientData.Medical.length) {
        alerts.push({ icon:'⚠️', color:'var(--error)', title:'Medical Conditions on File', msg: clientData.Medical.join(', ') });
    }

    // No visit yet
    if (totalVisits === 0) {
        alerts.push({ icon:'🆕', color:'var(--manager)', title:'First-Time Client', msg:'No completed visits on record. Welcome them warmly!' });
    }

    if (!alerts.length) {
        el.innerHTML = '<p style="color:#999; text-align:center; padding:20px; font-style:italic;">No alerts for this client.</p>';
        return;
    }

    el.innerHTML = alerts.map(a => `
        <div style="display:flex; gap:12px; padding:14px; border-left:4px solid ${a.color}; background:${a.color}11; border-radius:0 6px 6px 0; margin-bottom:10px;">
            <span style="font-size:1.4rem;">${a.icon}</span>
            <div>
                <strong style="color:${a.color}; font-size:0.88rem;">${a.title}</strong>
                <p style="margin:4px 0 0; font-size:0.82rem; color:#555;">${a.msg}</p>
            </div>
        </div>`).join('');
}

// ── Staff notes save ──────────────────────────────────────────
window.cip_saveNotes = async function() {
    const phone = _cip_clientData?.Tel_Number || '';
    const notes = document.getElementById('cip_notesInput')?.value?.trim() || '';
    const msgEl = document.getElementById('cip_notesSaved');
    if (!phone) return;
    try {
        await db.collection('Client_Notes').doc(phone).set({
            notes,
            updatedBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        msgEl.textContent = '✓ Saved';
        msgEl.style.color = 'var(--success)';
        setTimeout(() => { msgEl.textContent = ''; }, 2000);
    } catch(e) {
        msgEl.textContent = 'Error: ' + e.message;
        msgEl.style.color = 'var(--error)';
    }
};

// ── Tab switcher ──────────────────────────────────────────────
window.cip_switchTab = function(tab, btn) {
    document.querySelectorAll('.cip-tab').forEach(t => t.classList.remove('cip-tab--active'));
    btn.classList.add('cip-tab--active');
    document.querySelectorAll('[id^="cip_tab_"]').forEach(t => t.style.display = 'none');
    const target = document.getElementById('cip_tab_' + tab);
    if (target) target.style.display = 'block';
};

// ── Helpers ───────────────────────────────────────────────────
function cip_fmtDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch(e) { return dateStr; }
}

console.log('Thuraya Client Intelligence Panel loaded.');


// ============================================================
//  ACTIVE ATELIER(S) — Manager & Admin supervisory view
// ============================================================

let _aa_listener = null;

window.aa_load = function() {
    const listEl       = document.getElementById('aa_jobList');
    const activeCount  = document.getElementById('aa_activeCount');
    const waitingCount = document.getElementById('aa_waitingCount');
    const overdueCount = document.getElementById('aa_overdueCount');
    const revenueEl    = document.getElementById('aa_revenueInProgress');

    if (!listEl) return;
    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:40px 0;">Loading active floor…</p>';

    // Detach previous listener
    if (_aa_listener) { _aa_listener(); _aa_listener = null; }

    _aa_listener = db.collection('Active_Jobs')
        .where('status', 'in', ['In Progress', 'Waiting'])
        .onSnapshot(snap => {
            if (snap.empty) {
                listEl.innerHTML = '<div style="text-align:center; padding:60px 20px;"><p style="font-size:2rem; margin-bottom:10px;">✅</p><p style="color:#999; font-size:1rem;">Floor is clear — no active or arrived clients.</p></div>';
                if (activeCount)  activeCount.textContent  = '0';
                if (waitingCount) waitingCount.textContent = '0';
                if (overdueCount) overdueCount.textContent = '0';
                if (revenueEl)    revenueEl.textContent    = '0.00 GHC';
                return;
            }

            const now  = new Date();
            const jobs = [];
            snap.forEach(d => jobs.push({ id: d.id, ...d.data() }));

            // Sort: overdue first, then by start time
            jobs.sort((a, b) => {
                const aOver = aa_isOverdue(a, now);
                const bOver = aa_isOverdue(b, now);
                if (aOver && !bOver) return -1;
                if (!aOver && bOver) return 1;
                return (a.timeString||'').localeCompare(b.timeString||'');
            });

            // Summary counts
            const inProgress = jobs.filter(j => j.status === 'In Progress');
            const arrived    = jobs.filter(j => j.status === 'Waiting');
            const overdue    = jobs.filter(j => aa_isOverdue(j, now));
            const revenue    = jobs.reduce((s, j) => s + parseFloat(j.grandTotal || j.bookedPrice || 0), 0);

            if (activeCount)  activeCount.textContent  = inProgress.length;
            if (waitingCount) waitingCount.textContent = arrived.length;
            if (overdueCount) {
                overdueCount.textContent = overdue.length;
                overdueCount.style.color = overdue.length > 0 ? 'var(--error)' : 'var(--success)';
            }
            if (revenueEl) revenueEl.textContent = revenue.toFixed(2) + ' GHC';

            // Render job cards
            listEl.innerHTML = jobs.map(job => {
                const isOverdue   = aa_isOverdue(job, now);
                const elapsed     = aa_elapsedMins(job, now);
                const duration    = parseInt(job.bookedDuration) || 60;
                const progress    = Math.min(100, Math.round((elapsed / duration) * 100));
                const remaining   = duration - elapsed;
                const isGroup     = job.isGroupBooking;
                const isArrived   = job.status === 'Waiting';

                const statusColor = isOverdue   ? 'var(--error)'   :
                                    isArrived   ? 'var(--accent)'  : 'var(--success)';
                const statusLabel = isOverdue   ? '🔴 OVERDUE'     :
                                    isArrived   ? '🟡 WAITING'     : '🟢 IN PROGRESS';
                const borderColor = isOverdue   ? 'var(--error)'   :
                                    isArrived   ? 'var(--accent)'  : 'var(--success)';

                const progressColor = isOverdue ? 'var(--error)' : progress > 80 ? 'var(--accent)' : 'var(--success)';
                const amt = parseFloat(job.grandTotal || job.bookedPrice || 0).toFixed(2);

                return `
                <div style="border:2px solid ${borderColor}; border-radius:8px; padding:16px 18px; margin-bottom:14px; background:white; box-shadow:0 2px 8px rgba(0,0,0,0.06);">

                    <!-- Card header -->
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                        <div>
                            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                                <h4 style="margin:0; font-size:1.05rem; color:var(--primary);">${job.clientName || 'Unknown Client'}</h4>
                                <span style="background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44; font-size:0.72rem; font-weight:700; padding:2px 9px; border-radius:10px;">${statusLabel}</span>
                                ${isGroup ? `<span class="group-badge">👥 GROUP · ${job.groupSize || ''}</span>` : ''}
                            </div>
                            <p style="margin:4px 0 0; font-size:0.82rem; color:#666;">📞 ${job.clientPhone || 'N/A'}</p>
                        </div>
                        <div style="text-align:right;">
                            <p style="font-size:1rem; font-weight:700; color:var(--success); margin:0;">${amt} GHC</p>
                            <p style="font-size:0.78rem; color:#999; margin:2px 0 0;">📅 ${job.dateString} · ⏰ ${aa_fmt12(job.timeString)}</p>
                        </div>
                    </div>

                    <!-- Service + Tech -->
                    <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px;">
                        <div>
                            <p style="font-size:0.72rem; text-transform:uppercase; letter-spacing:1px; color:#999; margin-bottom:2px;">Service</p>
                            <p style="font-size:0.88rem; font-weight:600; color:var(--primary); margin:0;">💅 ${job.bookedService || 'N/A'}</p>
                        </div>
                        <div>
                            <p style="font-size:0.72rem; text-transform:uppercase; letter-spacing:1px; color:#999; margin-bottom:2px;">Technician</p>
                            <p style="font-size:0.88rem; font-weight:600; color:var(--primary); margin:0;">👩‍🔧 ${job.assignedTechName || 'Unassigned'}</p>
                        </div>
                        <div>
                            <p style="font-size:0.72rem; text-transform:uppercase; letter-spacing:1px; color:#999; margin-bottom:2px;">Duration</p>
                            <p style="font-size:0.88rem; font-weight:600; color:var(--primary); margin:0;">⏱ ${duration} mins</p>
                        </div>
                        <div>
                            <p style="font-size:0.72rem; text-transform:uppercase; letter-spacing:1px; color:#999; margin-bottom:2px;">${isOverdue ? 'Overdue by' : 'Remaining'}</p>
                            <p style="font-size:0.88rem; font-weight:700; color:${statusColor}; margin:0;">${isOverdue ? Math.abs(remaining) : remaining} mins</p>
                        </div>
                    </div>

                    <!-- Progress bar (only for In Progress) -->
                    ${!isArrived ? `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:#999; margin-bottom:4px;">
                            <span>Progress</span><span>${progress}%</span>
                        </div>
                        <div style="background:#f1f1f1; border-radius:20px; height:8px; overflow:hidden;">
                            <div style="width:${Math.min(progress,100)}%; background:${progressColor}; height:100%; border-radius:20px; transition:width 0.3s;"></div>
                        </div>
                    </div>` : ''}

                    <!-- Quick actions -->
                    <div style="display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid #f1f1f1; padding-top:10px;">
                        <select onchange="aa_reassign('${job.id}', this)" style="flex:1; min-width:160px; padding:6px 10px; font-size:0.82rem; border:1px solid var(--border); border-radius:4px;">
                            <option value="">🔄 Reassign tech…</option>
                            ${(typeof allTechs !== 'undefined' ? allTechs : []).map(t => `<option value="${t.email}|${t.name}" ${t.email === job.assignedTechEmail ? 'selected' : ''}>${t.name}</option>`).join('')}
                        </select>
                        <button onclick="aa_markReady('${job.id}')" style="background:var(--success); color:white; border:none; padding:6px 14px; border-radius:4px; cursor:pointer; font-size:0.82rem; font-weight:700;">✓ Ready for Payment</button>
                        <button onclick="aa_flag('${job.id}')" style="background:transparent; border:1px solid var(--accent); color:var(--accent); padding:6px 14px; border-radius:4px; cursor:pointer; font-size:0.82rem; font-weight:700;">⚑ Flag</button>
                    </div>

                </div>`;
            }).join('');

        }, err => {
            listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px;">Error: ${err.message}</p>`;
        });
};

// ── Helpers ───────────────────────────────────────────────────
function aa_isOverdue(job, now) {
    if (job.status !== 'In Progress') return false;
    return aa_elapsedMins(job, now) > (parseInt(job.bookedDuration) || 60);
}

function aa_elapsedMins(job, now) {
    if (!job.dateString || !job.timeString) return 0;
    try {
        const start = new Date(`${job.dateString}T${job.timeString}:00`);
        return Math.floor((now - start) / 60000);
    } catch(e) { return 0; }
}

function aa_fmt12(timeStr) {
    if (!timeStr) return '—';
    const [h, m] = timeStr.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── Quick actions ─────────────────────────────────────────────
window.aa_reassign = async function(jobId, select) {
    const val = select.value;
    if (!val) return;
    const [email, name] = val.split('|');
    try {
        await db.collection('Active_Jobs').doc(jobId).update({
            assignedTechEmail: email,
            assignedTechName:  name,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch(e) { alert('Reassign failed: ' + e.message); }
};

window.aa_markReady = async function(jobId) {
    if (!confirm('Mark this job as Ready for Payment?')) return;
    try {
        // Get the appointment to find matching Active_Job by phone + date
        const apptDoc = await db.collection('Appointments').doc(jobId).get();
        if (!apptDoc.exists) { alert('Appointment not found.'); return; }
        const appt = apptDoc.data();

        // Find the matching Active_Job
        const activeSnap = await db.collection('Active_Jobs')
            .where('clientPhone', '==', appt.clientPhone)
            .where('dateString',  '==', appt.dateString || todayDateStr)
            .where('status', 'in', ['Waiting', 'In Progress'])
            .get();

        if (activeSnap.empty) {
            // No Active_Job found — client may not have checked in yet
            // Update Appointments status as fallback
            await db.collection('Appointments').doc(jobId).update({
                status:    'Ready for Payment',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            alert('Job marked ready. Note: client not yet on the active floor — FOH will see this when they check in.');
            return;
        }

        // Update the Active_Job — this triggers FOH billing listener
        const batch = db.batch();
        activeSnap.forEach(d => {
            batch.update(d.ref, {
                status:    'Ready for Payment',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        // Also update Appointments
        batch.update(db.collection('Appointments').doc(jobId), {
            status:    'Ready for Payment',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();

    } catch(e) { alert('Error: ' + e.message); }
};

window.aa_flag = async function(jobId) {
    const note = prompt('Add a follow-up note for this job (optional):') || '';
    try {
        await db.collection('Appointments').doc(jobId).update({
            flagged:   true,
            flagNote:  note,
            flaggedBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('Job flagged for follow-up.');
    } catch(e) { alert('Error: ' + e.message); }
};

console.log('Thuraya Active Atelier(s) module loaded.');


// ============================================================
//  REPORTS MODULE — Full Build
// ============================================================


// ============================================================
//  REPORTS MODULE — Bug-fixed rewrite
// ============================================================

let _rpt_cache     = { upcoming:[], daily:[], monthly:[], tech:[], clients:[], leave:[] };
let _rpt_initiated = false;

// ── Init ──────────────────────────────────────────────────────
function rpt_init() {
    const today = todayDateStr;

    // Set default dates — only if empty
    const setIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && !el.value) el.value = val; };
    setIfEmpty('rpt_dailyDate',   today);
    setIfEmpty('rpt_startDate',   today);
    setIfEmpty('rpt_techMonth',   today.slice(0,7));
    setIfEmpty('rpt_monthlyMonth',today.slice(0,7));
    setIfEmpty('rpt_clientMonth', today.slice(0,7));

    const endEl = document.getElementById('rpt_endDate');
    if (endEl && !endEl.value) {
        const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + 6);
        endEl.value = d.toISOString().slice(0,10);
    }

    // Year selector — only populate once
    const yearSel = document.getElementById('rpt_leaveYear');
    if (yearSel && !yearSel.options.length) {
        const yr = new Date().getFullYear();
        for (let y = yr; y >= yr - 3; y--) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y; yearSel.appendChild(opt);
        }
    }

    // Tech filter — only populate once
    const techSel = document.getElementById('rpt_techFilter');
    if (techSel && techSel.options.length <= 1) {
        (typeof allTechs !== 'undefined' ? allTechs : []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.email; opt.textContent = t.name; techSel.appendChild(opt);
        });
    }

    // Show upcoming sub-tab by default
    rpt_switchSub('rpt_upcoming');
}

// ── Sub-tab switcher ──────────────────────────────────────────
window.rpt_switchSub = function(subId) {
    ['rpt_upcoming','rpt_daily','rpt_monthly','rpt_tech','rpt_clients','rpt_leave'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === subId ? 'block' : 'none';
    });
    // Sync radio button
    const radio = document.querySelector(`input[name="rpt_sub"][value="${subId}"]`);
    if (radio) radio.checked = true;
};

window.rpt_onRangeChange = function() {
    const val = document.getElementById('rpt_dateRange')?.value;
    const el  = document.getElementById('rpt_customRange');
    if (el) el.style.display = val === 'custom' ? 'grid' : 'none';
};

function rpt_getDateRange() {
    const val   = document.getElementById('rpt_dateRange')?.value || 'week';
    const today = new Date(todayDateStr + 'T12:00:00');
    if (val === 'today')    return { start: todayDateStr, end: todayDateStr };
    if (val === 'tomorrow') {
        const t = new Date(today); t.setDate(t.getDate() + 1);
        const s = t.toISOString().slice(0,10); return { start: s, end: s };
    }
    if (val === 'week') {
        const e = new Date(today); e.setDate(e.getDate() + 6);
        return { start: todayDateStr, end: e.toISOString().slice(0,10) };
    }
    return {
        start: document.getElementById('rpt_startDate')?.value || todayDateStr,
        end:   document.getElementById('rpt_endDate')?.value   || todayDateStr
    };
}

// ── Shared helpers ────────────────────────────────────────────
function rpt_fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch(e) { return d; }
}
function rpt_fmt12(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}
function rpt_metricCard(val, lbl, color) {
    return `<div class="cip-metric"><div class="cip-metric-val" style="color:${color||'var(--primary)'};">${val}</div><div class="cip-metric-lbl">${lbl}</div></div>`;
}
function rpt_tableHead(...cols) {
    return `<thead><tr style="background:#f1f1f1;">${cols.map(c =>
        `<th style="padding:9px 8px;text-align:${c.align||'left'};color:var(--primary);white-space:nowrap;">${c.label}</th>`
    ).join('')}</tr></thead>`;
}
function rpt_noData(msg) {
    return `<p style="color:#999;text-align:center;padding:30px 0;font-style:italic;">${msg}</p>`;
}
function rpt_err(e) {
    return `<p style="color:var(--error);text-align:center;padding:20px;">Error: ${e.message}</p>`;
}


// ══════════════════════════════════════════════════════════════
//  1. UPCOMING BOOKINGS
// ══════════════════════════════════════════════════════════════
window.rpt_loadUpcoming = async function() {
    const tableEl   = document.getElementById('rpt_upcomingTable');
    const summaryEl = document.getElementById('rpt_upcomingSummary');
    if (!tableEl) return;
    tableEl.innerHTML = rpt_noData('Loading…');
    summaryEl.style.display = 'none';

    const { start, end } = rpt_getDateRange();
    const techFilter   = document.getElementById('rpt_techFilter')?.value   || 'all';
    const statusFilter = document.getElementById('rpt_statusFilter')?.value || 'all';

    try {
        // Single where on dateString + status to avoid composite index
        const snap = await db.collection('Appointments')
            .where('dateString', '>=', start)
            .where('status', 'in', ['Scheduled','Arrived','In Progress','Action Required'])
            .get();

        let appts = [];
        snap.forEach(d => appts.push({ id: d.id, ...d.data() }));
        // Filter end date + optional filters client-side
        appts = appts.filter(a => a.dateString <= end);
        if (techFilter   !== 'all') appts = appts.filter(a => a.assignedTechEmail === techFilter);
        if (statusFilter !== 'all') appts = appts.filter(a => a.status === statusFilter);
        appts.sort((a,b) => (a.dateString+a.timeString).localeCompare(b.dateString+b.timeString));

        _rpt_cache.upcoming = appts;

        if (!appts.length) { tableEl.innerHTML = rpt_noData('No bookings found for this period.'); return; }

        const totalRev = appts.reduce((s,a) => s + parseFloat(a.grandTotal||a.bookedPrice||0), 0);
        const groups   = appts.filter(a => a.isGroupBooking).length;

        summaryEl.style.display = 'flex';
        summaryEl.innerHTML =
            rpt_metricCard(appts.length, 'Total Bookings') +
            rpt_metricCard(totalRev.toFixed(0)+' GHC', 'Expected Revenue', 'var(--success)') +
            rpt_metricCard(groups, 'Group Bookings', 'var(--manager)') +
            rpt_metricCard(start===end ? rpt_fmtDate(start) : rpt_fmtDate(start)+' → '+rpt_fmtDate(end), 'Period');

        const statusColors = {
            'Scheduled':'var(--primary)','Arrived':'var(--accent)',
            'In Progress':'var(--success)','Action Required':'var(--error)'
        };

        tableEl.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
            ${rpt_tableHead(
                {label:'Date'},{label:'Time'},{label:'Client'},{label:'Service'},
                {label:'Technician'},{label:'Mins',align:'center'},{label:'Amount',align:'right'},{label:'Status',align:'center'}
            )}
            <tbody>${appts.map((a,i) => {
                const amt   = parseFloat(a.grandTotal||a.bookedPrice||0).toFixed(2);
                const color = statusColors[a.status] || '#999';
                const isToday = a.dateString === todayDateStr;
                return `<tr style="background:${i%2===0?'white':'#fafafa'};border-bottom:1px solid #f1f1f1;">
                    <td style="padding:9px 8px;font-weight:${isToday?'700':'400'};color:${isToday?'var(--accent)':'inherit'};">
                        ${rpt_fmtDate(a.dateString)}
                        ${isToday?'<span style="font-size:0.68rem;background:var(--error);color:white;padding:1px 5px;border-radius:3px;margin-left:4px;">TODAY</span>':''}
                    </td>
                    <td style="padding:9px 8px;white-space:nowrap;">${rpt_fmt12(a.timeString)}</td>
                    <td style="padding:9px 8px;">
                        <strong>${a.clientName||'Unknown'}</strong>
                        ${a.isGroupBooking?'<span style="font-size:0.68rem;background:var(--manager);color:white;padding:1px 5px;border-radius:3px;margin-left:4px;">GROUP</span>':''}
                        <br><span style="font-size:0.75rem;color:#999;">${a.clientPhone||''}</span>
                    </td>
                    <td style="padding:9px 8px;">${a.bookedService||'N/A'}</td>
                    <td style="padding:9px 8px;">${a.assignedTechName||'—'}</td>
                    <td style="padding:9px 8px;text-align:center;">${a.bookedDuration||0}</td>
                    <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${amt} GHC</td>
                    <td style="padding:9px 8px;text-align:center;">
                        <span style="background:${color}22;color:${color};border:1px solid ${color}44;font-size:0.7rem;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;">${a.status}</span>
                    </td>
                </tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:#f9f7f4;font-weight:700;border-top:2px solid var(--border);">
                <td colspan="6" style="padding:9px 8px;color:var(--primary);">TOTAL (${appts.length} bookings)</td>
                <td style="padding:9px 8px;text-align:right;color:var(--success);">${totalRev.toFixed(2)} GHC</td>
                <td></td>
            </tr></tfoot>
        </table></div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  2. DAILY OPERATIONS
// ══════════════════════════════════════════════════════════════
window.rpt_loadDaily = async function() {
    const tableEl   = document.getElementById('rpt_dailyTable');
    const metricsEl = document.getElementById('rpt_dailyMetrics');
    if (!tableEl) return;
    const date = document.getElementById('rpt_dailyDate')?.value || todayDateStr;
    tableEl.innerHTML = rpt_noData('Loading…');
    metricsEl.style.display = 'none';

    try {
        // FIX: two separate single-where queries — no composite index needed
        const [closedSnap, cancelSnap] = await Promise.all([
            db.collection('Active_Jobs')
                .where('dateString','==',date)
                .where('status','==','Closed')
                .get(),
            db.collection('Appointments')
                .where('dateString','==',date)
                .where('status','==','Cancelled')
                .get()
        ]);

        const jobs = [];
        closedSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
        _rpt_cache.daily = jobs;

        // FIX: cancelledCount is a number from snap.size
        const cancelledCount = cancelSnap.size;

        if (!jobs.length) {
            tableEl.innerHTML = rpt_noData(`No completed jobs found for ${rpt_fmtDate(date)}.`);
            metricsEl.style.display = 'flex';
            metricsEl.innerHTML =
                rpt_metricCard(0, 'Clients Served', 'var(--success)') +
                rpt_metricCard('0.00 GHC', 'Total Revenue', 'var(--success)') +
                rpt_metricCard('— mins', 'Avg Duration') +
                rpt_metricCard(0, 'Techs Active', 'var(--manager)') +
                rpt_metricCard(cancelledCount, 'Cancellations', cancelledCount>0?'var(--error)':'#999');
            return;
        }

        const totalRev = jobs.reduce((s,j) => s + parseFloat(j.grandTotal||j.bookedPrice||0), 0);
        // FIX: guard against division by zero
        const totalDur = jobs.reduce((s,j) => s + parseInt(j.bookedDuration||0), 0);
        const avgDur   = jobs.length > 0 ? Math.round(totalDur / jobs.length) : 0;

        const techMap = {}, svcMap = {}, payMap = {};

        jobs.forEach(j => {
            const tn = j.assignedTechName || 'Unknown';
            if (!techMap[tn]) techMap[tn] = { count:0, revenue:0, duration:0 };
            techMap[tn].count++;
            techMap[tn].revenue  += parseFloat(j.grandTotal||j.bookedPrice||0);
            techMap[tn].duration += parseInt(j.bookedDuration||0);

            const svc = (j.bookedService||'Unknown').split(',')[0].trim();
            if (!svcMap[svc]) svcMap[svc] = { count:0, revenue:0 };
            svcMap[svc].count++;
            svcMap[svc].revenue += parseFloat(j.grandTotal||j.bookedPrice||0);

            // FIX: paymentMethod lives on Active_Jobs — use fallback gracefully
            const pay = j.paymentMethod || j.payment || 'Cash / Not Recorded';
            if (!payMap[pay]) payMap[pay] = { count:0, revenue:0 };
            payMap[pay].count++;
            payMap[pay].revenue += parseFloat(j.grandTotal||j.bookedPrice||0);
        });

        metricsEl.style.display = 'flex';
        metricsEl.innerHTML =
            rpt_metricCard(jobs.length, 'Clients Served', 'var(--success)') +
            rpt_metricCard(totalRev.toFixed(0)+' GHC', 'Total Revenue', 'var(--success)') +
            rpt_metricCard(jobs.length>0?(totalRev/jobs.length).toFixed(0)+' GHC':'—', 'Avg per Client') +
            rpt_metricCard(avgDur+' mins', 'Avg Duration') +
            rpt_metricCard(Object.keys(techMap).length, 'Techs Active', 'var(--manager)') +
            rpt_metricCard(cancelledCount, 'Cancellations', cancelledCount>0?'var(--error)':'#999');

        const techRows = Object.entries(techMap).sort((a,b)=>b[1].revenue-a[1].revenue).map(([n,d],i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;">👩‍🔧 ${n}</td>
                <td style="padding:9px 8px;text-align:center;">${d.count}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${d.revenue.toFixed(2)} GHC</td>
                <td style="padding:9px 8px;text-align:right;color:#666;">${d.count>0?(d.revenue/d.count).toFixed(2):0} GHC</td>
                <td style="padding:9px 8px;text-align:center;">${Math.round(d.duration/60)||'<1'} hr${Math.round(d.duration/60)!==1?'s':''}</td>
            </tr>`).join('');

        const svcRows = Object.entries(svcMap).sort((a,b)=>b[1].count-a[1].count).map(([n,d],i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;">💅 ${n}</td>
                <td style="padding:9px 8px;text-align:center;">${d.count}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${d.revenue.toFixed(2)} GHC</td>
            </tr>`).join('');

        const payRows = Object.entries(payMap).map(([n,d],i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;">💳 ${n}</td>
                <td style="padding:9px 8px;text-align:center;">${d.count}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${d.revenue.toFixed(2)} GHC</td>
            </tr>`).join('');

        const noRow = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;font-style:italic;">No data</td></tr>';

        tableEl.innerHTML = `
            <div class="grid-2" style="gap:20px;margin-bottom:20px;">
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">By Technician</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Tech'},{label:'Clients',align:'center'},{label:'Revenue',align:'right'},{label:'Avg',align:'right'},{label:'Hours',align:'center'})}
                        <tbody>${techRows||noRow}</tbody>
                    </table>
                </div>
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">By Service (Most Popular)</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Service'},{label:'Count',align:'center'},{label:'Revenue',align:'right'})}
                        <tbody>${svcRows||noRow}</tbody>
                    </table>
                </div>
            </div>
            <div style="max-width:440px;">
                <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">By Payment Method</p>
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                    ${rpt_tableHead({label:'Method'},{label:'Count',align:'center'},{label:'Revenue',align:'right'})}
                    <tbody>${payRows||noRow}</tbody>
                </table>
            </div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  3. WEEKLY / MONTHLY SUMMARY
// ══════════════════════════════════════════════════════════════
window.rpt_loadMonthly = async function() {
    const tableEl   = document.getElementById('rpt_monthlyTable');
    const metricsEl = document.getElementById('rpt_monthlyMetrics');
    if (!tableEl) return;

    const month = document.getElementById('rpt_monthlyMonth')?.value;
    if (!month) { tableEl.innerHTML = rpt_noData('Please select a month.'); return; }
    const [yr, mo] = month.split('-');
    const start = `${yr}-${mo}-01`;
    const end   = `${yr}-${mo}-${String(new Date(parseInt(yr), parseInt(mo), 0).getDate()).padStart(2,'0')}`;

    tableEl.innerHTML = rpt_noData('Loading…');
    metricsEl.style.display = 'none';

    try {
        // FIX: single where queries only — filter end date client-side
        const [jobsSnap, apptSnap] = await Promise.all([
            db.collection('Active_Jobs').where('dateString','>=',start).where('status','==','Closed').get(),
            db.collection('Appointments').where('dateString','>=',start).get()
        ]);

        const jobs = [];
        jobsSnap.forEach(d => { const j = d.data(); if (j.dateString <= end) jobs.push({ id:d.id, ...j }); });
        _rpt_cache.monthly = jobs;

        const cancelledCount = (() => {
            let c = 0;
            apptSnap.forEach(d => { const a = d.data(); if (a.dateString <= end && a.status === 'Cancelled') c++; });
            return c;
        })();

        if (!jobs.length) {
            tableEl.innerHTML = rpt_noData(`No completed jobs found for ${month}.`);
            return;
        }

        const totalRev = jobs.reduce((s,j) => s + parseFloat(j.grandTotal||j.bookedPrice||0), 0);
        const dayMap = {}, hourMap = {}, clientSpend = {}, svcRev = {};

        jobs.forEach(j => {
            const day = j.dateString||'';
            if (!dayMap[day]) dayMap[day] = { count:0, revenue:0 };
            dayMap[day].count++; dayMap[day].revenue += parseFloat(j.grandTotal||j.bookedPrice||0);

            const hr = parseInt((j.timeString||'00:00').split(':')[0]);
            hourMap[hr] = (hourMap[hr]||0) + 1;

            const phone = j.clientPhone||'';
            if (phone) {
                if (!clientSpend[phone]) clientSpend[phone] = { name:j.clientName||'Unknown', spend:0, count:0 };
                clientSpend[phone].spend  += parseFloat(j.grandTotal||j.bookedPrice||0);
                clientSpend[phone].count++;
            }

            const svc = (j.bookedService||'Unknown').split(',')[0].trim();
            if (!svcRev[svc]) svcRev[svc] = { count:0, revenue:0 };
            svcRev[svc].count++; svcRev[svc].revenue += parseFloat(j.grandTotal||j.bookedPrice||0);
        });

        // FIX: new vs returning — use unique client phones from jobs vs all prior jobs
        // Simple approach: unique clients who visited this month
        const uniqueClientsThisMonth = new Set(jobs.map(j => j.clientPhone).filter(Boolean));

        // Get prior jobs (before this month) to determine returning
        const priorSnap = await db.collection('Active_Jobs')
            .where('dateString','<',start)
            .where('status','==','Closed')
            .get();
        const priorClients = new Set();
        priorSnap.forEach(d => { const p = d.data().clientPhone; if(p) priorClients.add(p); });

        const returningCount = [...uniqueClientsThisMonth].filter(p => priorClients.has(p)).length;
        const newCount       = uniqueClientsThisMonth.size - returningCount;

        const busiestDay  = Object.entries(dayMap).sort((a,b)=>b[1].count-a[1].count)[0];
        const busiestHour = Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0];
        const busiestHrFmt = busiestHour ? rpt_fmt12(String(busiestHour[0]).padStart(2,'0')+':00') : '—';

        metricsEl.style.display = 'flex';
        metricsEl.innerHTML =
            rpt_metricCard(jobs.length, 'Total Clients Served') +
            rpt_metricCard(totalRev.toFixed(0)+' GHC', 'Total Revenue', 'var(--success)') +
            rpt_metricCard(newCount, 'New Clients', 'var(--manager)') +
            rpt_metricCard(returningCount, 'Returning Clients') +
            rpt_metricCard(busiestDay ? rpt_fmtDate(busiestDay[0]) : '—', 'Busiest Day') +
            rpt_metricCard(busiestHrFmt, 'Peak Hour') +
            rpt_metricCard(cancelledCount, 'Cancellations', cancelledCount>0?'var(--error)':'#999');

        const top10 = Object.entries(clientSpend).sort((a,b)=>b[1].spend-a[1].spend).slice(0,10);
        const top10Rows = top10.map(([phone,d],i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;font-weight:700;">${i+1}. ${d.name}</td>
                <td style="padding:9px 8px;color:#666;">${phone}</td>
                <td style="padding:9px 8px;text-align:center;">${d.count}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${d.spend.toFixed(2)} GHC</td>
            </tr>`).join('');

        const topSvc = Object.entries(svcRev).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,10);
        const topSvcRows = topSvc.map(([n,d],i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;">${i+1}. ${n}</td>
                <td style="padding:9px 8px;text-align:center;">${d.count}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${d.revenue.toFixed(2)} GHC</td>
            </tr>`).join('');

        const maxRev = Math.max(...Object.values(dayMap).map(x=>x.revenue), 1);
        const trendRows = Object.entries(dayMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([day,d]) =>
            `<tr style="border-bottom:1px solid #f1f1f1;">
                <td style="padding:7px 8px;">${rpt_fmtDate(day)}</td>
                <td style="padding:7px 8px;text-align:center;">${d.count}</td>
                <td style="padding:7px 8px;text-align:right;color:var(--success);">${d.revenue.toFixed(0)} GHC</td>
                <td style="padding:7px 8px;min-width:100px;">
                    <div style="background:#f1f1f1;border-radius:4px;height:10px;">
                        <div style="background:var(--success);height:100%;border-radius:4px;width:${Math.round((d.revenue/maxRev)*100)}%;"></div>
                    </div>
                </td>
            </tr>`).join('');

        const noRow2 = '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;font-style:italic;">No data</td></tr>';
        const noRow3 = '<tr><td colspan="3" style="padding:12px;text-align:center;color:#999;font-style:italic;">No data</td></tr>';

        tableEl.innerHTML = `
            <div class="grid-2" style="gap:20px;margin-bottom:20px;">
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">Top 10 Clients by Spend</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Client'},{label:'Phone'},{label:'Visits',align:'center'},{label:'Total Spend',align:'right'})}
                        <tbody>${top10Rows||noRow2}</tbody>
                    </table>
                </div>
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">Top Services by Revenue</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Service'},{label:'Count',align:'center'},{label:'Revenue',align:'right'})}
                        <tbody>${topSvcRows||noRow3}</tbody>
                    </table>
                </div>
            </div>
            <div>
                <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:8px;">Daily Revenue Trend</p>
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                    ${rpt_tableHead({label:'Date'},{label:'Clients',align:'center'},{label:'Revenue',align:'right'},{label:''})}
                    <tbody>${trendRows||noRow2}</tbody>
                </table>
            </div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  4. TECHNICIAN PERFORMANCE
// ══════════════════════════════════════════════════════════════
window.rpt_loadTechPerf = async function() {
    const tableEl = document.getElementById('rpt_techTable');
    if (!tableEl) return;
    const month = document.getElementById('rpt_techMonth')?.value;
    if (!month) { tableEl.innerHTML = rpt_noData('Please select a month.'); return; }
    const [yr, mo] = month.split('-');
    const start = `${yr}-${mo}-01`;
    const end   = `${yr}-${mo}-${String(new Date(parseInt(yr), parseInt(mo), 0).getDate()).padStart(2,'0')}`;

    tableEl.innerHTML = rpt_noData('Loading…');

    try {
        const [jobsSnap, schedSnap] = await Promise.all([
            db.collection('Active_Jobs').where('dateString','>=',start).where('status','==','Closed').get(),
            db.collection('Staff_Schedules').get()
        ]);

        const techMap = {};
        jobsSnap.forEach(d => {
            const j = d.data();
            if (j.dateString > end) return; // client-side end filter
            const k = j.assignedTechEmail || 'unknown';
            if (!techMap[k]) techMap[k] = { name: j.assignedTechName||'Unknown', count:0, revenue:0, duration:0 };
            techMap[k].count++;
            techMap[k].revenue  += parseFloat(j.grandTotal||j.bookedPrice||0);
            techMap[k].duration += parseInt(j.bookedDuration||0);
        });

        // Approximate available minutes per tech for utilisation
        const daysInMonth = new Date(parseInt(yr), parseInt(mo), 0).getDate();
        const schedMap = {};
        schedSnap.forEach(d => {
            const s = d.data();
            const workDaysPerWeek = (s.workingDays||[]).length;
            const startH = parseInt((s.startTime||'08:00').split(':')[0]);
            const endH   = parseInt((s.endTime||'20:00').split(':')[0]);
            const hoursPerDay = Math.max(0, endH - startH);
            const approxDays  = Math.round((workDaysPerWeek / 7) * daysInMonth);
            schedMap[d.id]    = approxDays * hoursPerDay * 60;
        });

        // FIX: cache correctly for CSV
        _rpt_cache.tech = Object.entries(techMap).map(([email, d]) => ({ email, ...d }));

        if (!_rpt_cache.tech.length) {
            tableEl.innerHTML = rpt_noData('No completed jobs found for this month.');
            return;
        }

        const totalRev     = _rpt_cache.tech.reduce((s,t) => s+t.revenue, 0);
        const totalClients = _rpt_cache.tech.reduce((s,t) => s+t.count, 0);

        const rows = _rpt_cache.tech.sort((a,b)=>b.revenue-a.revenue).map((d,i) => {
            const availMins = schedMap[d.email] || 0;
            const utilisPct = availMins > 0 ? Math.min(100, Math.round((d.duration/availMins)*100)) : null;
            const barColor  = utilisPct >= 80 ? 'var(--success)' : utilisPct >= 50 ? 'var(--accent)' : 'var(--error)';
            return `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:10px 8px;font-weight:700;color:var(--primary);">${d.name}</td>
                <td style="padding:10px 8px;text-align:center;">${d.count}</td>
                <td style="padding:10px 8px;text-align:right;font-weight:700;color:var(--success);">${d.revenue.toFixed(2)} GHC</td>
                <td style="padding:10px 8px;text-align:right;">${d.count>0?(d.revenue/d.count).toFixed(2):0} GHC</td>
                <td style="padding:10px 8px;text-align:center;">${Math.round(d.duration/60)||'<1'} hrs</td>
                <td style="padding:10px 8px;text-align:center;">
                    ${utilisPct !== null
                        ? `<div style="background:#f1f1f1;border-radius:4px;height:8px;margin-bottom:2px;"><div style="background:${barColor};height:100%;border-radius:4px;width:${utilisPct}%;"></div></div>${utilisPct}%`
                        : '<span style="color:#999;font-style:italic;">No schedule</span>'}
                </td>
                <td style="padding:10px 8px;text-align:center;color:#999;font-style:italic;font-size:0.8rem;">Coming soon</td>
            </tr>`;
        }).join('');

        tableEl.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
            ${rpt_tableHead(
                {label:'Technician'},{label:'Clients',align:'center'},{label:'Revenue',align:'right'},
                {label:'Avg/Client',align:'right'},{label:'Hours',align:'center'},
                {label:'Utilisation',align:'center'},{label:'Rating',align:'center'}
            )}
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:#f9f7f4;font-weight:700;border-top:2px solid var(--border);">
                <td style="padding:9px 8px;">TOTAL</td>
                <td style="padding:9px 8px;text-align:center;">${totalClients}</td>
                <td style="padding:9px 8px;text-align:right;color:var(--success);">${totalRev.toFixed(2)} GHC</td>
                <td style="padding:9px 8px;text-align:right;">${totalClients>0?(totalRev/totalClients).toFixed(2):0} GHC</td>
                <td colspan="3"></td>
            </tr></tfoot>
        </table></div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  5. CLIENT INTELLIGENCE REPORT
// ══════════════════════════════════════════════════════════════
window.rpt_loadClients = async function() {
    const tableEl   = document.getElementById('rpt_clientTable');
    const metricsEl = document.getElementById('rpt_clientMetrics');
    if (!tableEl) return;

    const month = document.getElementById('rpt_clientMonth')?.value || todayDateStr.slice(0,7);
    const [yr, mo] = month.split('-');
    const monthStart = `${yr}-${mo}-01`;
    const monthEnd   = `${yr}-${mo}-${String(new Date(parseInt(yr), parseInt(mo), 0).getDate()).padStart(2,'0')}`;

    tableEl.innerHTML = rpt_noData('Loading…');
    metricsEl.style.display = 'none';

    try {
        const [clientsSnap, jobsSnap] = await Promise.all([
            db.collection('Clients').get(),
            db.collection('Active_Jobs').where('status','==','Closed').get()
        ]);

        // Build spend map from ALL jobs
        const spendMap = {};
        jobsSnap.forEach(d => {
            const j = d.data();
            const phone = j.clientPhone||'';
            if (!phone) return;
            if (!spendMap[phone]) spendMap[phone] = { visits:0, spend:0, lastVisit:'', name:j.clientName||'' };
            spendMap[phone].visits++;
            spendMap[phone].spend += parseFloat(j.grandTotal||j.bookedPrice||0);
            if (!spendMap[phone].lastVisit || j.dateString > spendMap[phone].lastVisit) {
                spendMap[phone].lastVisit = j.dateString;
            }
        });

        const clients = [];
        clientsSnap.forEach(d => clients.push({ id: d.id, ...d.data() }));
        _rpt_cache.clients = clients;

        const now = new Date(todayDateStr + 'T12:00:00');
        let newCount = 0;
        const lapsedList = [], vipList = [], birthdayList = [];

        clients.forEach(c => {
            const phone = c.Tel_Number || c.id;
            const spend = spendMap[phone];

            // FIX: handle Firestore Timestamp and plain string dates for createdAt
            let created = null;
            if (c.createdAt) {
                if (typeof c.createdAt.toDate === 'function') {
                    created = c.createdAt.toDate();
                } else if (typeof c.createdAt === 'string') {
                    created = new Date(c.createdAt);
                }
            }
            if (created && !isNaN(created)) {
                const createdStr = created.toISOString().slice(0,10);
                if (createdStr >= monthStart && createdStr <= monthEnd) newCount++;
            }

            // Lapsed — 60+ days since last visit
            if (spend?.lastVisit) {
                const days = Math.floor((now - new Date(spend.lastVisit + 'T12:00:00')) / 86400000);
                if (days >= 60) lapsedList.push({ ...c, phone, days, lastVisit: spend.lastVisit });
            }

            // VIP — 10+ visits OR 2000+ GHC
            if (spend && (spend.visits >= 10 || spend.spend >= 2000)) {
                vipList.push({ ...c, phone, visits: spend.visits, spend: spend.spend, lastVisit: spend.lastVisit });
            }

            // Birthday this month
            if (c.DOB) {
                try {
                    const dob = new Date(c.DOB + 'T12:00:00');
                    if (!isNaN(dob) && (dob.getMonth()+1) === parseInt(mo)) {
                        birthdayList.push({ ...c, phone });
                    }
                } catch(e) {}
            }
        });

        metricsEl.style.display = 'flex';
        metricsEl.innerHTML =
            rpt_metricCard(clients.length, 'Total Clients') +
            rpt_metricCard(newCount, 'New This Month', 'var(--manager)') +
            rpt_metricCard(lapsedList.length, 'Lapsed (60+ days)', lapsedList.length>0?'var(--error)':'#999') +
            rpt_metricCard(vipList.length, 'VIP Clients', 'var(--accent)') +
            rpt_metricCard(birthdayList.length, 'Birthdays This Month', '#f39c12');

        const vipRows = vipList.sort((a,b)=>b.spend-a.spend).map((c,i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;"><strong>${c.Forename||''} ${c.Surname||''}</strong></td>
                <td style="padding:9px 8px;color:#666;">${c.phone}</td>
                <td style="padding:9px 8px;text-align:center;">${c.visits}</td>
                <td style="padding:9px 8px;text-align:right;font-weight:700;color:var(--success);">${c.spend.toFixed(2)} GHC</td>
                <td style="padding:9px 8px;text-align:center;">${rpt_fmtDate(c.lastVisit)}</td>
            </tr>`).join('');

        const lapsedRows = lapsedList.sort((a,b)=>b.days-a.days).slice(0,20).map((c,i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;"><strong>${c.Forename||''} ${c.Surname||''}</strong></td>
                <td style="padding:9px 8px;color:#666;">${c.phone}</td>
                <td style="padding:9px 8px;text-align:center;color:var(--error);font-weight:700;">${c.days} days ago</td>
                <td style="padding:9px 8px;text-align:center;">${rpt_fmtDate(c.lastVisit)}</td>
            </tr>`).join('');

        const bdayRows = birthdayList.map((c,i) =>
            `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;"><strong>${c.Forename||''} ${c.Surname||''}</strong></td>
                <td style="padding:9px 8px;color:#666;">${c.phone}</td>
                <td style="padding:9px 8px;">${rpt_fmtDate(c.DOB)}</td>
            </tr>`).join('');

        const noR5 = '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;font-style:italic;">None found.</td></tr>';
        const noR4 = '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;font-style:italic;">None found.</td></tr>';
        const noR3 = '<tr><td colspan="3" style="padding:12px;text-align:center;color:#999;font-style:italic;">None found.</td></tr>';

        const monthLabel = new Date(monthStart+'T12:00:00').toLocaleDateString('en-GB',{month:'long', year:'numeric'});

        tableEl.innerHTML = `
            <div style="margin-bottom:24px;">
                <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin-bottom:8px;">⭐ VIP Clients</p>
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                    ${rpt_tableHead({label:'Client'},{label:'Phone'},{label:'Visits',align:'center'},{label:'Total Spend',align:'right'},{label:'Last Visit',align:'center'})}
                    <tbody>${vipRows||noR5}</tbody>
                </table>
            </div>
            <div class="grid-2" style="gap:20px;">
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--error);margin-bottom:8px;">💤 Lapsed Clients (top 20)</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Client'},{label:'Phone'},{label:'Last Seen',align:'center'},{label:'Date',align:'center'})}
                        <tbody>${lapsedRows||noR4}</tbody>
                    </table>
                </div>
                <div>
                    <p style="font-size:0.82rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f39c12;margin-bottom:8px;">🎂 Birthdays — ${monthLabel}</p>
                    <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                        ${rpt_tableHead({label:'Client'},{label:'Phone'},{label:'Birthday'})}
                        <tbody>${bdayRows||noR3}</tbody>
                    </table>
                </div>
            </div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  6. LEAVE & ATTENDANCE REPORT
// ══════════════════════════════════════════════════════════════
window.rpt_loadLeave = async function() {
    const tableEl = document.getElementById('rpt_leaveTable');
    if (!tableEl) return;

    const year = document.getElementById('rpt_leaveYear')?.value || String(new Date().getFullYear());
    const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
    tableEl.innerHTML = rpt_noData('Loading…');

    try {
        // FIX: removed schedSnap — it was fetched but never used correctly
        const [leaveSnap, balSnap] = await Promise.all([
            db.collection('Staff_Leave').where('status','==','Approved').get(),
            db.collection('Staff_Leave_Balances').get()
        ]);

        const techLeave = {};
        leaveSnap.forEach(d => {
            const l = d.data();
            // Client-side year filter
            if (!l.startDate || l.startDate < yearStart || l.startDate > yearEnd) return;
            const email = l.techEmail||'';
            if (!email) return;
            if (!techLeave[email]) techLeave[email] = { name: l.techName||email, types:{}, total:0 };
            // FIX: accurate day calculation
            const start = new Date(l.startDate + 'T12:00:00');
            const end   = new Date((l.endDate||l.startDate) + 'T12:00:00');
            const days  = Math.max(1, Math.round((end - start) / 86400000) + 1);
            techLeave[email].types[l.type] = (techLeave[email].types[l.type]||0) + days;
            techLeave[email].total += days;
        });

        const balMap = {};
        balSnap.forEach(d => {
            const data = d.data();
            balMap[d.id] = data[year] || data.annualLeave || 14;
        });

        _rpt_cache.leave = Object.entries(techLeave).map(([email,d]) => ({ email, ...d }));

        if (!_rpt_cache.leave.length) {
            tableEl.innerHTML = rpt_noData('No approved leave records found for ' + year + '.');
            return;
        }

        const leaveTypes = ['Annual Leave','Day Off','Wellness Day','Sick Leave','Leave Without Pay','Public Holiday'];

        const rows = Object.entries(techLeave).sort((a,b)=>b[1].total-a[1].total).map(([email,d],i) => {
            const entitled   = balMap[email] || 14;
            const annualUsed = d.types['Annual Leave'] || 0;
            const remaining  = entitled - annualUsed;
            const remColor   = remaining < 0 ? 'var(--error)' : remaining <= 3 ? 'var(--accent)' : 'var(--success)';
            return `<tr style="background:${i%2?'#fafafa':'white'};border-bottom:1px solid #f1f1f1;">
                <td style="padding:9px 8px;font-weight:700;color:var(--primary);">${d.name}</td>
                ${leaveTypes.map(t => `<td style="padding:9px 8px;text-align:center;">${d.types[t]||0}</td>`).join('')}
                <td style="padding:9px 8px;text-align:center;font-weight:700;">${d.total}</td>
                <td style="padding:9px 8px;text-align:center;">${entitled}</td>
                <td style="padding:9px 8px;text-align:center;font-weight:700;color:${remColor};">${remaining}</td>
            </tr>`;
        }).join('');

        tableEl.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
            ${rpt_tableHead(
                {label:'Staff Member'},
                ...leaveTypes.map(t => ({label:t, align:'center'})),
                {label:'Total Days', align:'center'},
                {label:'Entitlement', align:'center'},
                {label:'Remaining', align:'center'}
            )}
            <tbody>${rows}</tbody>
        </table></div>`;
    } catch(e) { tableEl.innerHTML = rpt_err(e); }
};


// ══════════════════════════════════════════════════════════════
//  CSV EXPORT
// ══════════════════════════════════════════════════════════════
window.rpt_exportCSV = function(type) {
    let rows = [], filename = 'report.csv';

    if (type === 'upcoming') {
        if (!_rpt_cache.upcoming.length) { alert('Load the report first.'); return; }
        rows = [['Date','Time','Client','Phone','Service','Technician','Duration (mins)','Amount (GHC)','Status','Group Booking'],
            ..._rpt_cache.upcoming.map(a => [
                a.dateString, a.timeString, a.clientName||'', a.clientPhone||'',
                a.bookedService||'', a.assignedTechName||'', a.bookedDuration||0,
                parseFloat(a.grandTotal||a.bookedPrice||0).toFixed(2),
                a.status, a.isGroupBooking?'Yes':'No'
            ])];
        filename = `upcoming-bookings-${todayDateStr}.csv`;

    } else if (type === 'daily') {
        if (!_rpt_cache.daily.length) { alert('Load the report first.'); return; }
        rows = [['Client','Phone','Service','Technician','Duration (mins)','Amount (GHC)','Payment Method'],
            ..._rpt_cache.daily.map(j => [
                j.clientName||'', j.clientPhone||'', j.bookedService||'',
                j.assignedTechName||'', j.bookedDuration||0,
                parseFloat(j.grandTotal||j.bookedPrice||0).toFixed(2),
                j.paymentMethod||j.payment||''
            ])];
        filename = `daily-ops-${document.getElementById('rpt_dailyDate')?.value||todayDateStr}.csv`;

    } else if (type === 'monthly') {
        if (!_rpt_cache.monthly.length) { alert('Load the report first.'); return; }
        rows = [['Date','Client','Phone','Service','Technician','Amount (GHC)'],
            ..._rpt_cache.monthly.map(j => [
                j.dateString, j.clientName||'', j.clientPhone||'',
                j.bookedService||'', j.assignedTechName||'',
                parseFloat(j.grandTotal||j.bookedPrice||0).toFixed(2)
            ])];
        filename = `monthly-summary-${document.getElementById('rpt_monthlyMonth')?.value||''}.csv`;

    } else if (type === 'tech') {
        if (!_rpt_cache.tech.length) { alert('Load the report first.'); return; }
        rows = [['Technician','Email','Clients Served','Revenue (GHC)','Avg per Client (GHC)','Hours Worked'],
            ..._rpt_cache.tech.map(t => [
                t.name, t.email, t.count,
                t.revenue.toFixed(2),
                t.count>0?(t.revenue/t.count).toFixed(2):0,
                Math.round(t.duration/60)
            ])];
        filename = `tech-performance-${document.getElementById('rpt_techMonth')?.value||''}.csv`;

    } else if (type === 'clients') {
        if (!_rpt_cache.clients.length) { alert('Load the report first.'); return; }
        rows = [['Name','Phone','Email','Date of Birth'],
            ..._rpt_cache.clients.map(c => [
                `${c.Forename||''} ${c.Surname||''}`.trim(),
                c.Tel_Number||'', c.Email||'', c.DOB||''
            ])];
        filename = `client-intelligence-${todayDateStr}.csv`;

    } else if (type === 'leave') {
        if (!_rpt_cache.leave.length) { alert('Load the report first.'); return; }
        const types = ['Annual Leave','Day Off','Wellness Day','Sick Leave','Leave Without Pay','Public Holiday'];
        rows = [['Staff Member','Email',...types,'Total Days'],
            ..._rpt_cache.leave.map(d => [
                d.name, d.email,
                ...types.map(t => d.types?.[t]||0),
                d.total
            ])];
        filename = `leave-attendance-${document.getElementById('rpt_leaveYear')?.value||''}.csv`;
    }

    if (!rows.length) return;
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

console.log('Thuraya Reports module loaded.');
