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
let curConsultId = null, curConsultData = null, upsls = [];
let consultTemplate = [];

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
    if (moduleId === 'adminView') { loadStaffDirectory(); }
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


// --- SUPER OVERRIDE ---
window.signInWithEmail = function() { 
    // This completely bypasses Firebase Authentication and forces you into the system.
    currentUserEmail = "emergency_admin@thuraya.com";
    currentUserName = "MASTER OVERRIDE";
    currentRoles = ["System Admin"];

    document.getElementById('userNameDisplay').innerText = currentUserName;
    document.getElementById('userRoleDisplay').innerText = currentRoles.join(' | ');
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appDashboard').style.display = 'block';

    document.getElementById('topNavMenu').style.display = 'flex';
    document.querySelectorAll('.nav-tab').forEach(tab => tab.style.display = 'flex'); // Show ALL tabs
    
    // Start listeners (will only pull data if database allows read access, but UI will open)
    try { fetchAllTechs(); } catch(e) {}
    try { startTaxListener(); } catch(e) {}
    try { startConsultTemplateListener(); } catch(e) {}
    try { loadStaffDirectory(); } catch(e) {}
    try { fetchLiveMenu(true); } catch(e) {}

    // Force open Admin tab
    const adminTabInput = document.getElementById('nav_admin');
    if(adminTabInput) adminTabInput.checked = true;
    switchModule('adminView');
}

window.signInWithGoogle = function() { 
    document.getElementById('errorMsg').style.display = 'none'; 
    auth.signInWithPopup(provider).catch(error => showError(error.message)); 
}

window.logOut = async function() { 
    if(currentUserEmail) { try { await db.collection('Attendance').doc(`${currentUserEmail}_${todayDateStr}`).update({ clockOut: firebase.firestore.FieldValue.serverTimestamp() }); } catch(e) {} }
    auth.signOut(); 
    location.reload(); // Force reload to clear override
}

window.showError = function(msg) { 
    const el = document.getElementById('errorMsg'); 
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
                allTechs.push({ email: doc.id, name: data.name || "Unknown", isTest: isTestTech }); 
            }
        });
        
        const select = document.getElementById('sched_techSelect');
        if(select) {
            select.innerHTML = '<option value="" disabled selected>Select Technician...</option>';
            allTechs.forEach(t => { select.innerHTML += `<option value="${t.email}">${t.name}</option>`; });
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
        let controls = document.getElementById('managerMenuControls');
        if (controls) controls.style.display = 'block';
        let seedBtn = document.getElementById('seedMenuBtnContainer');
        if (seedBtn) seedBtn.style.display = 'block';
    }

    db.collection('Menu_Services').onSnapshot(snap => {
        const menuContainer = document.getElementById('sched_serviceMenu');
        const adminList = document.getElementById('menuManagerList');

        if(snap.empty) {
            if(adminList) adminList.innerHTML = '<p style="text-align:center; color:#999;">Menu database is empty. Manager must initialize.</p>';
            if(menuContainer) menuContainer.innerHTML = '<p style="color:#999; font-style:italic; text-align:center;">No services available.</p>';
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
                        <div class="service-card" style="align-items: center; cursor:default;">
                            <div style="flex-grow: 1;">
                                <strong>${safeName} ${tagHtml}</strong> <span style="font-size:0.7rem; background:#eee; padding:2px 5px; border-radius:4px;">${type.toUpperCase()}</span><br>
                                <div style="margin-top:8px; display:flex; gap:10px; align-items:center;">
                                    <input type="number" id="dur_${s.id}" value="${safeDur}" style="width:70px; padding:5px; border:1px solid #ccc; border-radius:4px;"> m
                                    <input type="number" id="prc_${s.id}" value="${safePrc}" style="width:70px; padding:5px; border:1px solid #ccc; border-radius:4px;"> ₵
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:5px;">
                                <button class="btn" style="padding:8px; background:var(--success); font-size:0.75rem;" onclick="updateMenuService('${s.id}')">Save</button>
                                <button class="btn" style="padding:8px; background:var(--error); font-size:0.75rem;" onclick="deleteMenuService('${s.id}')">Del</button>
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
            adminHtml += `</div>`;
        });

        if(adminList) adminList.innerHTML = adminHtml;
        if(menuContainer) menuContainer.innerHTML = bookingHtml;

    }, error => {
        console.error(error);
        let menuContainer = document.getElementById('sched_serviceMenu');
        if(menuContainer) menuContainer.innerHTML = `<p style="color:red;">Error loading menu: ${error.message}</p>`;
    });
}

window.updateMenuService = async function(id) {
    let dur = parseInt(document.getElementById('dur_' + id).value) || 0;
    let prc = parseFloat(document.getElementById('prc_' + id).value) || 0;
    try {
        await db.collection('Menu_Services').doc(id).update({ duration: dur, price: prc });
        alert("Service updated successfully!");
    } catch(e) { alert("Error updating: " + e.message); }
};

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

window.calculateScheduleTotals = function() {
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

window.generateTimeSlots = async function() {
    let dtEl = document.getElementById('sched_date');
    let drEl = document.getElementById('sched_totalDuration');
    let teEl = document.getElementById('sched_techSelect');
    let c = document.getElementById('sched_timeSlots');
    
    if(!dtEl || !drEl || !teEl || !c) return;
    
    let dt = dtEl.value;
    let dr = parseInt(drEl.innerText) || 0;
    let te = teEl.value; 
    document.getElementById('sched_time').value = '';
    
    if(!dt || !te || dr === 0) { 
        c.innerHTML = '<p style="color:#999;font-size:0.85rem;margin:0;font-style:italic;">⚠️ Select Service, Date, and Tech.</p>'; 
        return; 
    }
    
    c.innerHTML = 'Loading...';
    let bb = []; 
    let querySnap = await db.collection('Appointments').where('dateString','==',dt).get();
    querySnap.forEach(d => {
        let a = d.data(); 
        if(a.assignedTechEmail === te && (a.status === 'Scheduled' || a.status === 'Arrived') && d.id !== editingApptId) {
            bb.push({s: timeToMins(a.timeString), e: timeToMins(a.timeString) + parseInt(a.bookedDuration)});
        }
    });
    
    let h = '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
    let f = false;
    let nw = new Date();
    let isT = (dt === todayDateStr);
    let cm = nw.getHours() * 60 + nw.getMinutes();
    
    for(let t = 8*60; t + dr <= 20*60; t += 30) {
        if(isT && t <= cm) continue;
        let av = true; 
        for(let i=0; i<bb.length; i++) { 
            if(t < bb[i].e && t + dr > bb[i].s) { av = false; break; } 
        }
        if(av) { 
            f = true; 
            let hr = Math.floor(t/60);
            let mn = t % 60;
            let mD = mn < 10 ? '0'+mn : mn;
            let hd = hr % 12 || 12; 
            let timeVal = `${hr < 10 ? '0'+hr : hr}:${mD}`;
            h += `<button type="button" class="time-slot-btn" onclick="selectTimeSlot('${timeVal}', this)">${hd}:${mD} ${hr>=12?'PM':'AM'}</button> `;
        }
    }
    c.innerHTML = f ? h + '</div>' : '<p style="color:var(--error);font-weight:bold;margin:0;">No slots available.</p>';
}

// --- FOH SEARCH ---
window.selectSClient = function(id) { 
    let m = allClientsCache.find(c => c.Tel_Number === id); 
    if(!m) return;
    document.getElementById('sched_phone').value = m.Tel_Number; 
    document.getElementById('sched_name').value = `${m.Forename||''} ${m.Surname||''}`.trim(); 
    document.getElementById('sched_displayName').innerText = document.getElementById('sched_name').value; 
    document.getElementById('sched_displayPhone').innerText = m.Tel_Number; 
    document.getElementById('sched_search').value = ''; 
    document.getElementById('sched_searchResults').style.display = 'none'; 
    document.getElementById('sched_selectedClientDisplay').style.display = 'block'; 
}

window.selectFClient = function(id) { 
    let m = allClientsCache.find(c => c.Tel_Number === id); 
    if(!m) return;
    document.getElementById('f_forename').value = m.Forename || ''; 
    document.getElementById('f_surname').value = m.Surname || ''; 
    document.getElementById('f_tel').value = m.Tel_Number || ''; 
    document.getElementById('f_altTel').value = m.Tel_Number_Alt || ''; 
    document.getElementById('f_gender').value = m.Gender || ''; 
    document.getElementById('f_email').value = m.Email || ''; 
    document.getElementById('f_dob').value = m.DOB || ''; 
    document.getElementById('fohSearchPhone').value = ''; 
    document.getElementById('foh_searchResults').style.display = 'none'; 
    document.getElementById('fohSearchMsg').innerText = 'Client Loaded. You can update and save.'; 
    document.getElementById('fohSearchMsg').style.color = "var(--success)";
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
                            <h4 style="margin:0; font-size:1rem;">${appt.clientName || 'Unknown'}</h4>
                            <p style="margin:0; font-size:0.8rem; color: var(--primary);">💅 <strong>${appt.bookedService || 'N/A'}</strong></p>
                            <p style="margin:0; font-size:0.8rem;">⏰ ${hr12}:${displayMins} ${ampm} | Tech: ${appt.assignedTechName || 'Unknown'} | 📞 ${appt.clientPhone || 'N/A'}</p>
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
        const doc = await db.collection('Appointments').doc(id).get();
        const appt = doc.data();
        await db.collection('Appointments').doc(id).update({ status: 'Arrived' });

        const activeJobData = { 
            clientPhone: appt.clientPhone, clientName: appt.clientName, 
            assignedTechEmail: appt.assignedTechEmail, assignedTechName: appt.assignedTechName, 
            bookedService: appt.bookedService || "N/A", bookedDuration: appt.bookedDuration || "0", 
            bookedPrice: appt.bookedPrice || "0", grandTotal: appt.grandTotal || "0", taxBreakdown: appt.taxBreakdown || "[]",
            status: "Waiting", fohCreator: currentUserEmail, 
            createdAt: firebase.firestore.FieldValue.serverTimestamp(), dateString: todayDateStr 
        };
        await db.collection("Active_Jobs").add(activeJobData);

        if (GOOGLE_CHAT_WEBHOOK !== "") {
            fetch(GOOGLE_CHAT_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `🛎️ *Client Arrived*
*Client:* ${appt.clientName}
*Service:* ${appt.bookedService}
*Assigned Tech:* ${appt.assignedTechName}
_Please check your Dashboard._` }) }).catch(err => console.error(err));
        }
        alert(`${appt.clientName} checked in and routed to ${appt.assignedTechName}!`);
    } catch(e) { alert("Error checking in: " + e.message); }
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
    window.openConsult = window.openConsultation;
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
                        btn.onclick = function() { window.openConsultation(doc.id); };
                    } else {
                        btn.innerText = 'Complete Job';
                        btn.style.background = 'var(--success)';
                        btn.onclick = async function() { 
                            try { await db.collection('Active_Jobs').doc(doc.id).update({ status: 'Ready for Payment' }); }
                            catch(e) { alert("Error: " + e.message); }
                        };
                        
                        let btnEdit = document.createElement('button');
                        btnEdit.className = 'btn btn-secondary';
                        btnEdit.style.width = '100%';
                        btnEdit.style.padding = '5px';
                        btnEdit.style.marginBottom = '5px';
                        btnEdit.style.fontSize = '0.75rem';
                        btnEdit.innerText = 'Edit Record';
                        btnEdit.onclick = function() { window.openConsultation(doc.id); };
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
        thead.innerHTML = '<tr><th>Name</th><th>Google Email</th><th>Departments</th><th style="text-align:center;">Action</th></tr>';
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

                let btnEdit = document.createElement('button');
                btnEdit.className = 'btn'; btnEdit.style.cssText = 'padding:5px 10px; width:auto; font-size:0.75rem; background:var(--primary);';
                btnEdit.innerText = 'Edit'; btnEdit.onclick = function() { window.editStaff(email, name, rolesStr); };

                let btnRevoke = document.createElement('button');
                btnRevoke.className = 'btn btn-secondary'; btnRevoke.style.cssText = 'padding:5px 10px; width:auto; font-size:0.75rem; color:red; border-color:red;';
                btnRevoke.innerText = 'Del'; btnRevoke.onclick = function() { window.removeStaffAccount(email); };

                tdAction.appendChild(btnEdit); tdAction.appendChild(btnRevoke);
                tr.appendChild(tdName); tr.appendChild(tdEmail); tr.appendChild(tdRoles); tr.appendChild(tdAction);
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
            if(authError.code !== 'auth/email-already-in-use') { alert("Failed to create login credential.

Error: " + authError.message); return; }
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
