// ⚠️ PASTE YOUR GOOGLE CHAT WEBHOOK URL HERE
const GOOGLE_CHAT_WEBHOOK = ""; 

const firebaseConfig = { apiKey: "AIzaSyBTZOVjppINaVyYslRnAkC04EjJyMt40j8", authDomain: "thuraya-client-telling.firebaseapp.com", projectId: "thuraya-client-telling", storageBucket: "thuraya-client-telling.firebasestorage.app", messagingSenderId: "1061064260367", appId: "1:1061064260367:web:ffedb019649bcf1cbadc7a" };

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const auth = firebase.auth(); 
const db = firebase.firestore(); 
const provider = new firebase.auth.GoogleAuthProvider();

let secondaryApp; 
try { secondaryApp = firebase.app("SecondaryApp"); } 
catch(e) { secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp"); }

let currentUserEmail = "";
let currentUserName = "";
let currentRoles = [];

let allTechs = [];
let allClientsCache = [];
let liveTaxes = [];
let allMenuServicesCache = [];
let consultTemplate = [];

let searchTimeout = null;
let fohSearchTimeout = null;
let editingApptId = null;

let curConsultId = null;
let curConsultData = null;
let upsls = [];

let todayDateStr = new Date().toISOString().split('T')[0];

window.appointmentsCache = {};
window.activeJobsCache = {};
window.staffCache = {};

document.addEventListener("DOMContentLoaded", () => { 
    document.getElementById('sched_date').min = todayDateStr; 
});

function timeToMins(t) { 
    if(!t) return 0; 
    let [h,m] = t.split(':'); 
    return parseInt(h) * 60 + parseInt(m); 
}

function switchModule(m) { 
    document.querySelectorAll('.app-module').forEach(x => x.style.display = 'none'); 
    document.getElementById(m).style.display = 'block'; 
    if(m === 'adminView') loadStaffDirectory(); 
}

function toggleClientsSubView() { 
    let v = document.querySelector('input[name="clients_view_toggle"]:checked').value; 
    document.getElementById('subView_Checkin').style.display = (v === 'checkin') ? 'block' : 'none';
    document.getElementById('subView_Schedule').style.display = (v === 'schedule') ? 'block' : 'none';
    document.getElementById('subView_Billing').style.display = (v === 'billing') ? 'block' : 'none';
    document.getElementById('subView_Ops').style.display = (v === 'ops') ? 'block' : 'none';
}

function toggleDeptView() { 
    let v = document.querySelector('input[name="dept_toggle"]:checked').value; 
    document.getElementById('menu_dept_Hand').style.display = (v === 'Hand') ? 'block' : 'none'; 
    document.getElementById('menu_dept_Foot').style.display = (v === 'Foot') ? 'block' : 'none'; 
}

function toggleAdminDeptView() { 
    let v = document.querySelector('input[name="admin_dept_toggle"]:checked').value; 
    document.getElementById('admin_dept_Hand').style.display = (v === 'Hand') ? 'block' : 'none'; 
    document.getElementById('admin_dept_Foot').style.display = (v === 'Foot') ? 'block' : 'none'; 
}

auth.onAuthStateChanged(async (user) => {
    if(user){
        let e = user.email.toLowerCase();
        try { await db.collection('Attendance').doc(`${e}_${todayDateStr}`).set({email:e, name:user.displayName||"Staff", date:todayDateStr, clockIn:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); } catch(x){}
        try {
            let d = await db.collection('Users').doc(e).get();
            if(d.exists) {
                let ud = d.data(); 
                currentUserEmail = e; 
                currentUserName = ud.name||"Staff"; 
                currentRoles = Array.isArray(ud.roles) ? ud.roles : [];
                
                document.getElementById('userNameDisplay').innerText = currentUserName; 
                document.getElementById('userRoleDisplay').innerText = currentRoles.join(' | ');
                document.getElementById('loginScreen').style.display = 'none'; 
                document.getElementById('appDashboard').style.display = 'block';
                
                fetchAllTechs(); 
                startTaxListener(); 
                startConsultTemplateListener();
                
                // --- BULLETPROOF FUZZY ADMIN LOGIC ---
                let sr = currentRoles.map(r => String(r).trim().toLowerCase());
                let isM = sr.some(r => r.includes('manager')), 
                    isA = sr.some(r => r.includes('admin')), 
                    isF = sr.some(r => r.includes('foh') || r.includes('front of house')), 
                    isT = sr.some(r => r.includes('tech')), 
                    isS = sr.some(r => r.includes('supply'));
                
                document.getElementById('topNavMenu').style.display = 'flex';
                
                if(isM||isF||isA) { document.getElementById('tabClients').style.display = 'flex'; document.getElementById('tabClients').classList.add('visible'); startFohRosterListener(); startFohFinancialListener(); startExpectedTodayListener(); startScheduleListener(); startFohBillingListener(); }
                if(isM||isT||isA) { document.getElementById('tabAtelier').style.display = 'flex'; document.getElementById('tabAtelier').classList.add('visible'); startTechFinancialListener(); startTechQueueListener(); }
                if(isM||isF||isT||isA) { document.getElementById('tabMenu').style.display = 'flex'; document.getElementById('tabMenu').classList.add('visible'); fetchLiveMenu(isM||isA); }
                if(isM||isA) { document.getElementById('tabHR').style.display = 'flex'; document.getElementById('tabHR').classList.add('visible'); }
                if(isS||isM||isA) { document.getElementById('tabSupply').style.display = 'flex'; document.getElementById('tabSupply').classList.add('visible'); }
                if(isA) { document.getElementById('tabAdmin').style.display = 'flex'; document.getElementById('tabAdmin').classList.add('visible'); loadStaffDirectory(); }
                
                let fvt = document.querySelector('.nav-tab.visible input'); 
                if(fvt) { fvt.checked = true; switchModule(fvt.value); }
            } else { 
                auth.signOut(); 
                showError("Access Denied."); 
            }
        } catch(x){ showError("DB Error."); }
    } else { 
        document.getElementById('loginScreen').style.display = 'block'; 
        document.getElementById('appDashboard').style.display = 'none'; 
        document.getElementById('topNavMenu').style.display = 'none'; 
    }
});

function signInWithEmail() { 
    let e = document.getElementById('testEmail').value; 
    let p = document.getElementById('testPassword').value; 
    if(e && p) auth.signInWithEmailAndPassword(e,p).catch(err => showError(err.message)); 
}

function signInWithGoogle() { 
    auth.signInWithPopup(provider).catch(e => showError(e.message)); 
}

function logOut() { 
    if(currentUserEmail) {
        db.collection('Attendance').doc(`${currentUserEmail}_${todayDateStr}`).update({clockOut:firebase.firestore.FieldValue.serverTimestamp()}).catch(e=>{}); 
    }
    auth.signOut(); 
}

function showError(m) { 
    let el = document.getElementById('errorMsg'); 
    el.innerText = m; 
    el.style.display = 'block'; 
}

async function fetchAllTechs() {
    let s = await db.collection('Users').get(); 
    allTechs = [];
    s.forEach(d => { 
        let dt = d.data();
        let r = (Array.isArray(dt.roles) ? dt.roles : []).map(x => x.toLowerCase()); 
        if(r.some(x => x.includes('tech'))) allTechs.push({email: d.id, name: dt.name || "Unknown"}); 
    });
    
    let html = '<option value="">Select Technician...</option>' + allTechs.map(t => `<option value="${t.email}">${t.name}</option>`).join('');
    
    let ts = document.getElementById('sched_techSelect'); 
    if(ts) ts.innerHTML = html;
    
    let cr = document.getElementById('consultReassign'); 
    if(cr) cr.innerHTML = '<option value="">Reassign to...</option>' + html;
}

// --- TAX ENGINE ---
function startTaxListener() {
    db.collection('Tax_Settings').doc('current_taxes').onSnapshot(d => { 
        liveTaxes = d.exists && d.data().rates ? d.data().rates : []; 
        renderTaxConfigUI(); 
        updatePreviewToggles(); 
        calculateScheduleTotals(); 
    });
}

function addTax() {
    let n = document.getElementById('cfgTaxName').value.trim(); 
    let r = parseFloat(document.getElementById('cfgTaxRate').value);
    if(!n || isNaN(r)) { alert("Fill Tax fields correctly."); return; }
    
    let c = [...liveTaxes];
    let idx = c.findIndex(t => t.name.toLowerCase() === n.toLowerCase());
    if(idx >= 0) c[idx].rate = r; else c.push({name: n, rate: r});
    
    db.collection('Tax_Settings').doc('current_taxes').set({rates: c}, {merge: true}).then(() => {
        document.getElementById('cfgTaxName').value = ''; 
        document.getElementById('cfgTaxRate').value = '';
    });
}

function deleteTax(n) { 
    if(confirm("Remove?")) {
        db.collection('Tax_Settings').doc('current_taxes').set({rates: liveTaxes.filter(t => t.name !== n)}, {merge: true}); 
    }
}

function editTax(n, r) { 
    document.getElementById('cfgTaxName').value = n; 
    document.getElementById('cfgTaxRate').value = r; 
    window.scrollTo(0,0); 
}

function renderTaxConfigUI() {
    let el = document.getElementById('taxConfigList'); 
    if(!el) return;
    el.innerHTML = liveTaxes.length ? liveTaxes.map(t => `<div style="display:flex;justify-content:space-between;padding:10px;border:1px solid #ccc;margin-bottom:5px;background:#fff;border-radius:4px;"><strong>${t.name}</strong><span style="display:flex;align-items:center;gap:10px;">${t.rate}% <button class="btn" style="width:auto;padding:5px 10px;font-size:0.75rem;" onclick="editTax('${t.name}',${t.rate})">Edit</button> <button class="btn btn-secondary" style="width:auto;padding:5px 10px;font-size:0.75rem;color:red;border-color:red;" onclick="deleteTax('${t.name}')">Del</button></span></div>`).join('') : '<p style="color:#999;font-style:italic;">No taxes configured.</p>';
}

function updatePreviewToggles() {
    let el = document.getElementById('previewTaxToggles'); 
    if(!el) return;
    el.innerHTML = liveTaxes.map((t,i) => `<label style="font-weight:normal;display:flex;align-items:center;gap:8px;margin-bottom:5px;"><input type="checkbox" class="prev-cb" value="${i}" checked onchange="calculatePreview()" style="width:16px;height:16px;"> ${t.name} (${t.rate}%)</label>`).join('');
    calculatePreview();
}

window.calculatePreview = function() {
    let inp = parseFloat(document.getElementById('previewBasePrice').value) || 0;
    
    let incToggle = document.querySelector('input[name="tax_inclusive_toggle"]:checked');
    let inc = incToggle ? incToggle.value === 'inclusive' : false;
    
    let tr = 0, html = '';
    
    document.querySelectorAll('.prev-cb:checked').forEach(c => { 
        tr += liveTaxes[c.value].rate; 
    });
    
    let b = inc ? inp / (1 + (tr/100)) : inp;
    let gt = inc ? inp : inp * (1 + (tr/100));
    
    document.querySelectorAll('.prev-cb:checked').forEach(c => { 
        let t = liveTaxes[c.value];
        let a = b * (t.rate/100); 
        html += `<div style="display:flex;justify-content:space-between;color:#777;font-size:0.85rem;margin-bottom:3px;"><span>+ ${t.name} (${t.rate}%)</span><span>${a.toFixed(2)} GHC</span></div>`; 
    });
    
    let pbo = document.getElementById('prevBaseOut'); if(pbo) pbo.innerText = `${b.toFixed(2)} GHC`;
    let ptb = document.getElementById('prevTaxBreakdown'); if(ptb) ptb.innerHTML = html;
    let pto = document.getElementById('prevTotalOut'); if(pto) pto.innerText = `${gt.toFixed(2)} GHC`;
}

// --- MENU ENGINE ---
function fetchLiveMenu(hasEditAccess) {
    if(hasEditAccess){
        document.getElementById('managerMenuControls').style.display='block'; 
        document.getElementById('seedMenuBtnContainer').style.display='block';
    }
    db.collection('Menu_Services').onSnapshot(sn => {
        let s = []; 
        sn.forEach(d => s.push({id:d.id,...d.data()}));
        allMenuServicesCache = s.sort((a,b) => a.category.localeCompare(b.category));
        
        let uSel = document.getElementById('consultUpsellSelect'); 
        if(uSel) {
            uSel.innerHTML = '<option value="">Select service or add-on...</option>' + allMenuServicesCache.filter(x => x.status === 'Active').map(x => `<option value="${x.id}">${x.name} (${x.price} GHC)</option>`).join('');
        }
        
        let dt = {Hand:{}, Foot:{}};
        s.forEach(x => { 
            let c = x.category || "Uncat"; 
            if(x.department === "Both") { 
                (dt.Hand[c] = dt.Hand[c] || []).push(x); 
                (dt.Foot[c] = dt.Foot[c] || []).push(x); 
            } else { 
                (dt[x.department || "Hand"][c] = dt[x.department || "Hand"][c] || []).push(x); 
            }
        });
        
        let bH = '', aH = '';
        ['Hand','Foot'].forEach(dp => {
            bH += `<div id="menu_dept_${dp}" style="display:${dp==='Hand'?'block':'none'}"><div class="grid-2">`;
            aH += `<div id="admin_dept_${dp}" style="display:${dp==='Hand'?'block':'none'}">`;
            
            let cats = Object.keys(dt[dp]).sort((a,b) => { 
                let r = /^(\d+|I{1,3}|IV|V|VI)\./;
                let na = r.test(a.trim());
                let nb = r.test(b.trim()); 
                if(na && !nb) return -1; 
                if(!na && nb) return 1; 
                return a.localeCompare(b, undefined, {numeric: true});
            });
            
            cats.forEach(c => {
                bH += `<div class="menu-col"><div class="menu-section-title">${c}</div>`; 
                aH += `<div class="menu-section-title">${c}</div><div class="grid-2">`;
                dt[dp][c].forEach(m => {
                    if(m.inputType === 'counter') {
                        bH += `<div class="service-card" style="align-items:center;"><div style="flex-grow:1;"><strong style="font-size:1.05rem;">${m.name}</strong><br><span style="color:var(--accent);font-weight:bold;font-size:0.8rem;">${m.duration}m | ${m.price} GHC/ea</span></div><div class="counter-box"><button class="btn btn-secondary" style="padding:2px 10px;width:auto;" onclick="updateCounter('${m.id}',-1)">-</button><input type="number" id="sched_qty_${m.id}" class="sched-counter" data-name="${m.name}" data-dur="${m.duration}" data-prc="${m.price}" value="0" readonly><button class="btn btn-secondary" style="padding:2px 10px;width:auto;" onclick="updateCounter('${m.id}',1)">+</button></div></div>`;
                    } else {
                        bH += `<div class="service-card" onclick="toggleCard(this,'${m.id}','${m.inputType}','grp_${dp}')"><input type="${m.inputType}" name="grp_${dp}" class="sched-item" id="sched_cb_${m.id}" data-name="${m.name}" data-dur="${m.duration}" data-prc="${m.price}"><div style="flex-grow:1; pointer-events:none;"><strong style="font-size:1.05rem; color:#222;">${m.name}</strong><br><span style="display:inline-block;background:#eef5f9;color:#555;padding:3px 8px;border-radius:4px;font-size:0.75rem;font-weight:bold;margin-top:5px;">${m.duration}m | ${m.price} GHC</span></div></div>`;
                    }
                    if(hasEditAccess) {
                        aH += `<div class="service-card"><div style="flex-grow:1;"><strong>${m.name}</strong><br><div style="display:flex;gap:10px;margin-top:8px;align-items:center;"><input type="number" id="ad_d_${m.id}" value="${m.duration}" style="width:60px;padding:5px;">m <input type="number" id="ad_p_${m.id}" value="${m.price}" style="width:60px;padding:5px;">₵</div></div><div style="display:flex;flex-direction:column;gap:5px;"><button class="btn" style="padding:8px;font-size:0.75rem;background:var(--success);" onclick="updateMenuService('${m.id}')">Save</button><button class="btn" style="padding:8px;font-size:0.75rem;background:var(--error);" onclick="deleteMenuService('${m.id}')">Del</button></div></div>`;
                    }
                });
                bH += `</div>`; 
                aH += `</div>`;
            });
            bH += `</div></div>`; 
            aH += `</div>`;
        });
        let sm = document.getElementById('sched_serviceMenu'); if(sm) sm.innerHTML = bH; 
        let ml = document.getElementById('menuManagerList'); if(ml) ml.innerHTML = aH;
    });
}

function toggleCard(el, id, t, grp) {
    let i = document.getElementById('sched_cb_'+id); 
    if(!i) return;
    if(t === 'radio') { 
        document.querySelectorAll(`input[name="${grp}"]`).forEach(x => {
            x.checked = false; 
            let c = x.closest('.service-card'); 
            if(c) c.classList.remove('selected');
        }); 
        i.checked = true; 
        el.classList.add('selected'); 
    } else { 
        i.checked = !i.checked; 
        if(i.checked) el.classList.add('selected'); else el.classList.remove('selected'); 
    }
    calculateScheduleTotals();
}

function updateCounter(id, v) { 
    let i = document.getElementById('sched_qty_'+id); 
    let n = parseInt(i.value) + v; 
    i.value = n < 0 ? 0 : n; 
    calculateScheduleTotals(); 
}

function clearAllSelections() { 
    document.querySelectorAll('.sched-item').forEach(c => {
        c.checked = false; 
        let p = c.closest('.service-card'); 
        if(p) p.classList.remove('selected');
    }); 
    document.querySelectorAll('.sched-counter').forEach(c => c.value = 0); 
    calculateScheduleTotals(); 
}

function calculateScheduleTotals() {
    let m = 0, b = 0, h = '';
    
    document.querySelectorAll('.sched-item:checked').forEach(c => { 
        m += parseInt(c.getAttribute('data-dur')); 
        let p = parseFloat(c.getAttribute('data-prc')); 
        b += p; 
        h += `<div class="breakdown-row"><span>${c.getAttribute('data-name')}</span><span>${p.toFixed(2)} GHC</span></div>`; 
    });
    
    document.querySelectorAll('.sched-counter').forEach(c => { 
        let q = parseInt(c.value); 
        if(q > 0) { 
            m += parseInt(c.getAttribute('data-dur')); 
            let p = parseFloat(c.getAttribute('data-prc')) * q; 
            b += p; 
            h += `<div class="breakdown-row"><span>${c.getAttribute('data-name')}(x${q})</span><span>${p.toFixed(2)} GHC</span></div>`; 
        }
    });
    
    let tx = 0, txH = '', txD = [];
    if(b > 0 && liveTaxes.length > 0) {
        txH += `<div style="display:flex;justify-content:space-between;margin-bottom:5px;font-weight:bold;color:#555;"><span>Subtotal:</span><span>${b.toFixed(2)} GHC</span></div>`;
        liveTaxes.forEach(t => { 
            let a = b * (t.rate/100); 
            tx += a; 
            txD.push({name: t.name, rate: t.rate, amount: a}); 
            txH += `<div style="display:flex;justify-content:space-between;font-size:0.85rem;color:#777;margin-bottom:3px;"><span>+ ${t.name} (${t.rate}%)</span><span>${a.toFixed(2)} GHC</span></div>`; 
        });
    }
    
    let sbl = document.getElementById('sched_breakdownList'); if(sbl) sbl.innerHTML = h; 
    let stb = document.getElementById('sched_taxBreakdown'); if(stb) { stb.innerHTML = txH; stb.style.display = tx > 0 ? 'block' : 'none'; }
    let std = document.getElementById('sched_totalDuration'); if(std) std.innerText = m; 
    let gt = b + tx; 
    let stc = document.getElementById('sched_totalCost'); if(stc) stc.innerText = gt.toFixed(2);
    
    let ssv = document.getElementById('sched_subtotalVal'); if(ssv) ssv.value = b; 
    let stdv = document.getElementById('sched_taxData'); if(stdv) stdv.value = JSON.stringify(txD); 
    let sgtv = document.getElementById('sched_grandTotalVal'); if(sgtv) sgtv.value = gt;
    
    let sbk = document.getElementById('sched_breakdown'); if(sbk) sbk.style.display = (b > 0 || m > 0) ? 'block' : 'none';
    generateTimeSlots();
}

async function generateTimeSlots() {
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

function selectTimeSlot(timeStr, btn) {
    document.getElementById('sched_time').value = timeStr;
    document.querySelectorAll('.time-slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

// --- FOH SEARCH ---
function selectSClient(id) { 
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

function selectFClient(id) { 
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

function liveClientSearch() { 
    clearTimeout(searchTimeout); 
    searchTimeout = setTimeout(async () => { 
        let v = document.getElementById('sched_search').value.toLowerCase().trim();
        let r = document.getElementById('sched_searchResults'); 
        if(v.length < 2) { r.style.display = 'none'; return; }
        if(!allClientsCache.length) {
            let s = await db.collection('Clients').get(); 
            s.forEach(d => allClientsCache.push(d.data()));
        } 
        let m = allClientsCache.filter(c => (c.Tel_Number||'').includes(v) || (c.Forename||'').toLowerCase().includes(v)); 
        r.innerHTML = m.slice(0,5).map(x => `<div class="search-result-item" onclick="selectSClient('${x.Tel_Number}')"><strong>${x.Forename||''} ${x.Surname||''}</strong><br><small style="color:var(--manager);">${x.Tel_Number}</small></div>`).join(''); 
        if(m.length > 5) r.innerHTML += `<div style="padding:10px;text-align:center;color:#999;font-size:0.8rem;">+ ${m.length-5} more... keep typing</div>`; 
        r.style.display = m.length ? 'block' : 'none'; 
    }, 300); 
}

function liveClientSearchFOH() { 
    clearTimeout(fohSearchTimeout); 
    fohSearchTimeout = setTimeout(async () => { 
        let v = document.getElementById('fohSearchPhone').value.toLowerCase().trim();
        let r = document.getElementById('foh_searchResults'); 
        if(v.length < 2) { r.style.display = 'none'; return; }
        if(!allClientsCache.length) {
            let s = await db.collection('Clients').get(); 
            s.forEach(d => allClientsCache.push(d.data()));
        } 
        let m = allClientsCache.filter(c => (c.Tel_Number||'').includes(v) || (c.Forename||'').toLowerCase().includes(v)); 
        r.innerHTML = m.slice(0,5).map(x => `<div class="search-result-item" onclick="selectFClient('${x.Tel_Number}')"><strong>${x.Forename||''} ${x.Surname||''}</strong><br><small style="color:var(--manager);">${x.Tel_Number}</small></div>`).join(''); 
        if(m.length > 5) r.innerHTML += `<div style="padding:10px;text-align:center;color:#999;font-size:0.8rem;">+ ${m.length-5} more... keep typing</div>`; 
        r.style.display = m.length ? 'block' : 'none'; 
    }, 300); 
}

window.clearScheduleClient = function() { 
    document.getElementById('sched_phone').value = ''; 
    document.getElementById('sched_name').value = ''; 
    document.getElementById('sched_selectedClientDisplay').style.display = 'none'; 
}

window.registerClientOnly = async function() {
    let f = document.getElementById('f_forename').value.trim();
    let s = document.getElementById('f_surname').value.trim();
    let t = document.getElementById('f_tel').value.replace(/\D/g,'');
    let g = document.getElementById('f_gender').value;
    
    if(!f || !s || !t || !g || t.length !== 10) return alert("Fill all required fields (*). Phone must be 10 digits.");
    
    let d = {
        Forename: f, Surname: s, Tel_Number: t, 
        Tel_Number_Alt: document.getElementById('f_altTel').value.replace(/\D/g,''), 
        Gender: g, Email: document.getElementById('f_email').value.trim(), 
        DOB: document.getElementById('f_dob').value
    };
    
    await db.collection("Clients").doc(t).set(d, {merge: true}); 
    alert("Saved Client Record!"); 
    
    let idx = allClientsCache.findIndex(c => c.Tel_Number === t); 
    if(idx >= 0) allClientsCache[idx] = d; else allClientsCache.push(d);
    
    document.getElementById('f_tel').value = ''; 
    document.getElementById('f_forename').value = ''; 
    document.getElementById('f_surname').value = ''; 
    document.getElementById('fohSearchPhone').value = ''; 
    document.getElementById('fohSearchMsg').innerText = '';
}

window.bookAppointment = async function() {
    let ph = document.getElementById('sched_phone').value;
    let nm = document.getElementById('sched_name').value;
    let dt = document.getElementById('sched_date').value;
    let tm = document.getElementById('sched_time').value;
    let dr = document.getElementById('sched_totalDuration').innerText;
    let st = document.getElementById('sched_subtotalVal').value;
    let tx = document.getElementById('sched_taxData').value;
    let gt = document.getElementById('sched_grandTotalVal').value;
    let te = document.getElementById('sched_techSelect').value;
    
    if(!ph || !dt || !tm || !te || dr === '0') return alert("Fill all required booking fields and select a valid time slot.");
    
    let s = []; 
    document.querySelectorAll('.sched-item:checked').forEach(c => s.push(c.getAttribute('data-name'))); 
    document.querySelectorAll('.sched-counter').forEach(c => {
        let q = parseInt(c.value);
        if(q > 0) s.push(c.getAttribute('data-name') + '(x' + q + ')');
    });
    
    let sel = document.getElementById('sched_techSelect');
    let techName = sel.options[sel.selectedIndex].text;
    
    let p = {
        clientPhone: ph, clientName: nm, dateString: dt, timeString: tm, 
        assignedTechEmail: te, assignedTechName: techName, 
        bookedService: s.join(', '), bookedDuration: dr, 
        bookedPrice: st, taxBreakdown: tx, grandTotal: gt, status: 'Scheduled'
    };
    
    if(editingApptId) { 
        await db.collection('Appointments').doc(editingApptId).update(p); 
        alert("Appointment Updated!"); 
        editingApptId = null; 
        document.getElementById('btnConfirmBooking').innerText = "Confirm & Book Appointment"; 
        document.getElementById('btnCancelEdit').style.display = 'none'; 
    } else { 
        await db.collection('Appointments').add(p); 
        alert("Appointment Secured!"); 
    }
    
    clearScheduleClient(); 
    clearAllSelections(); 
    document.getElementById('sched_date').value = ''; 
    document.getElementById('sched_time').value = '';
}

window.editAppointment = async function(id) {
    let d = await db.collection('Appointments').doc(id).get();
    let a = d.data(); 
    window.appointmentsCache[id] = a; 
    document.getElementById('tab_toggle_schedule').click(); 
    document.getElementById('sched_phone').value = a.clientPhone; 
    document.getElementById('sched_name').value = a.clientName; 
    document.getElementById('sched_displayName').innerText = a.clientName; 
    document.getElementById('sched_displayPhone').innerText = a.clientPhone; 
    document.getElementById('sched_selectedClientDisplay').style.display = 'block'; 
    editingApptId = id; 
    document.getElementById('btnConfirmBooking').innerText = "Update Appointment"; 
    document.getElementById('btnCancelEdit').style.display = 'inline-block'; 
    clearAllSelections();
    
    setTimeout(() => { 
        let sr = a.bookedService.split(',').map(s => s.trim()); 
        document.querySelectorAll('.sched-item').forEach(c => {
            if(sr.includes(c.getAttribute('data-name'))){
                c.checked = true;
                c.closest('.service-card').classList.add('selected');
            }
        }); 
        document.querySelectorAll('.sched-counter').forEach(i => {
            let m = sr.find(s => s.startsWith(i.getAttribute('data-name')+' (x')); 
            if(m) i.value = parseInt(m.match(/\(x(\d+)\)/)[1]);
        }); 
        document.getElementById('sched_date').value = a.dateString; 
        document.getElementById('sched_techSelect').value = a.assignedTechEmail; 
        calculateScheduleTotals(); 
        
        setTimeout(() => { 
            document.querySelectorAll('.time-slot-btn').forEach(b => {
                if(b.innerText.includes(a.timeString)) selectTimeSlot(a.timeString, b);
            }); 
        }, 500); 
    }, 200);
}

window.cancelEditMode = function() { 
    editingApptId = null; 
    document.getElementById('btnConfirmBooking').innerText = "Confirm & Book Appointment"; 
    document.getElementById('btnCancelEdit').style.display = 'none'; 
    clearScheduleClient(); 
    document.getElementById('sched_date').value = ''; 
    document.getElementById('sched_time').value = ''; 
    document.getElementById('sched_techSelect').value = ''; 
    clearAllSelections(); 
}

function startExpectedTodayListener() { 
    db.collection('Appointments').where('dateString','==',todayDateStr).onSnapshot(s => { 
        let d = document.getElementById('expectedTodayList'); 
        if(!d) return; 
        if(s.empty) return d.innerHTML = '<p style="color:#999;font-style:italic;">No appointments today.</p>'; 
        let h = ''; 
        s.forEach(x => {
            let a = x.data(); 
            window.appointmentsCache[x.id] = a; 
            if(a.status === 'Scheduled') {
                h += `<div class="ticket"><div><h4 style="margin:0;font-size:1rem;">${a.clientName}</h4><p style="margin:0;font-size:0.8rem;color:var(--primary);">💅 <strong>${a.bookedService}</strong></p><p style="margin:0;font-size:0.8rem;">⏰ ${a.timeString} | Tech: ${a.assignedTechName}</p></div><div><button class="btn" style="padding:5px 15px;width:auto;" onclick="checkIn('${x.id}')">Check-In</button></div></div>`;
            }
        }); 
        d.innerHTML = h || '<p style="color:#999;font-style:italic;">No more expected today.</p>'; 
    }); 
}

function startScheduleListener() { 
    db.collection('Appointments').where('status','in',['Scheduled','Action Required']).onSnapshot(s => { 
        let d = document.getElementById('upcomingScheduleList'); 
        if(!d) return; 
        if(s.empty) return d.innerHTML = '<p style="color:#999;font-style:italic;">No upcoming.</p>'; 
        let h = ''; 
        s.forEach(x => {
            let a = x.data(); 
            window.appointmentsCache[x.id] = a; 
            if(a.dateString >= todayDateStr || a.status === 'Action Required') {
                h += `<div class="ticket" style="border-color:${a.status==='Action Required'?'var(--error)':'var(--manager)'}"><div><h4 style="margin:0;font-size:1rem;color:var(--manager);">${a.clientName} ${a.status==='Action Required'?'<span class="ticket-badge" style="background:var(--error);margin-left:5px;">RESCHEDULE REQ</span>':''}</h4><p style="margin:0;font-size:0.8rem;color:var(--primary);font-weight:bold;">💅 ${a.bookedService}</p><p style="margin:0;font-size:0.8rem;">📅 ${a.dateString} at ⏰ ${a.timeString}</p></div><div style="display:flex;flex-direction:column;gap:5px;"><button class="btn btn-secondary" style="padding:5px 10px;font-size:0.75rem;" onclick="editAppointment('${x.id}')">Edit</button> <button class="btn btn-secondary" style="padding:5px 10px;font-size:0.75rem;color:var(--error);border-color:var(--error);" onclick="if(confirm('Cancel Appt?'))db.collection('Appointments').doc('${x.id}').update({status:'Cancelled'})">Cancel</button></div></div>`;
            }
        }); 
        d.innerHTML = h || '<p style="color:#999;font-style:italic;">No upcoming.</p>'; 
    }); 
}

window.checkIn = async function(id) {
    let a = window.appointmentsCache[id]; 
    if(!a) return;
    await db.collection('Appointments').doc(id).update({status:'Arrived'});
    await db.collection("Active_Jobs").add({
        clientPhone: a.clientPhone, clientName: a.clientName, 
        assignedTechEmail: a.assignedTechEmail, assignedTechName: a.assignedTechName, 
        bookedService: a.bookedService, bookedDuration: a.bookedDuration, 
        bookedPrice: a.bookedPrice, grandTotal: a.grandTotal, 
        taxBreakdown: a.taxBreakdown, status: "Waiting", dateString: todayDateStr
    }); 
    alert(`${a.clientName} routed to ${a.assignedTechName}!`);
}

// --- TECH CONSULTATION ENGINE ---
window.toggleMedNone = function(checkbox) {
    if(checkbox.checked) {
        document.querySelectorAll('.med-cb').forEach(cb => { cb.checked = false; cb.disabled = true; });
    } else {
        document.querySelectorAll('.med-cb').forEach(cb => { cb.disabled = false; });
    }
}

window.openConsult = async function(id) {
    try {
        let doc = await db.collection('Active_Jobs').doc(id).get(); 
        if(!doc.exists) return;
        curConsultData = doc.data(); 
        curConsultId = id; 
        upsls = [];

        document.getElementById('consultName').innerText = curConsultData.clientName;
        document.getElementById('consultTicket').innerText = curConsultData.bookedService;
        document.getElementById('consultProjTotal').innerText = parseFloat(curConsultData.grandTotal || curConsultData.bookedPrice || 0).toFixed(2) + ' GHC';
        document.getElementById('consultAddedUpsells').innerHTML = ''; 
        document.getElementById('consultUpsellSelect').value = '';
        document.getElementById('consultReassign').value = '';

        let cr = curConsultData.consultationRecord || {}; 
        let md = cr.medicalHistory || [];
        
        document.querySelectorAll('.med-cb').forEach(c => {
            c.checked = md.includes(c.value); 
            c.disabled = false;
        });
        
        if(document.getElementById('med_none')){ 
            document.getElementById('med_none').checked = md.includes("None"); 
            if(md.includes("None")) document.querySelectorAll('.med-cb').forEach(c => c.disabled = true); 
        }
        
        document.getElementById('med_allergies').value = cr.allergies || ''; 
        document.getElementById('med_other').value = cr.otherMedical || '';
        document.querySelectorAll('input[name="cond_callus"]').forEach(r => r.checked = (r.value === cr.callusLevel)); 
        document.querySelectorAll('input[name="cond_skin"]').forEach(r => r.checked = (r.value === cr.skinCondition));
        document.getElementById('cond_notes').value = cr.visualNotes || '';

        // DYNAMIC FORM POPULATION
        let cf = cr.customFields || {};
        let dynHtml = '';
        consultTemplate.forEach(q => {
            dynHtml += `<div class="consult-title" style="margin-top:20px;font-size:0.95rem;">${q.label}</div><div style="margin-bottom:15px;">`;
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

        let btn = document.getElementById('btnConsultSave');
        btn.innerText = (curConsultData.status === 'In Progress') ? "Update Record" : "Save & Start";
        document.getElementById('consultModal').style.display = 'block';
    } catch(e) { alert(e.message); }
}

window.closeConsult = function() { 
    document.getElementById('consultModal').style.display = 'none'; 
}

window.addUpsell = function() {
    let sel = document.getElementById('consultUpsellSelect');
    let obj = allMenuServicesCache.find(s => s.id === sel.value); 
    if(!obj) return;
    
    upsls.push(obj); 
    document.getElementById('consultAddedUpsells').innerHTML = upsls.map(p => `<div>+ ${p.name} (${p.price} GHC)</div>`).join('');
    
    let b = parseFloat(curConsultData.bookedPrice||0) + upsls.reduce((a,c) => a + parseFloat(c.price||0), 0);
    let t = liveTaxes.reduce((a,x) => a + (b * (x.rate/100)), 0);
    
    document.getElementById('consultProjTotal').innerText = (b+t).toFixed(2) + ' GHC'; 
    sel.value = '';
}

window.reassign = async function() {
    let sel = document.getElementById('consultReassign'); 
    if(!sel.value) return;
    await db.collection('Active_Jobs').doc(curConsultId).update({
        assignedTechEmail: sel.value, 
        assignedTechName: sel.options[sel.selectedIndex].text
    }); 
    closeConsult(); 
    alert("Reassigned.");
}

window.reqReschedule = async function() {
    if(!confirm("Send ticket back to FOH?")) return; 
    await db.collection('Active_Jobs').doc(curConsultId).delete();
    let q = await db.collection('Appointments').where('clientPhone','==',curConsultData.clientPhone).where('dateString','==',curConsultData.dateString).get();
    if(!q.empty) {
        await db.collection('Appointments').doc(q.docs[0].id).update({status:'Action Required'}); 
    }
    closeConsult(); 
    alert("Sent to FOH.");
}

window.saveConsult = async function() {
    let m = [];
    document.querySelectorAll('.med-cb:checked').forEach(cb => m.push(cb.value)); 
    if(document.getElementById('med_none').checked) m = ["None"];
    
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

    let b = parseFloat(curConsultData.bookedPrice||0);
    let d = parseInt(curConsultData.bookedDuration||0);
    let s = curConsultData.bookedService;
    
    upsls.forEach(p => {
        b += parseFloat(p.price||0); 
        d += parseInt(p.duration||0); 
        s += `, ${p.name}`;
    });
    
    let tx = liveTaxes.map(x => { return {name: x.name, rate: x.rate, amount: b * (x.rate/100)} });
    let g = b + tx.reduce((a,c) => a + c.amount, 0);
    
    await db.collection('Active_Jobs').doc(curConsultId).update({
        status: 'In Progress', 
        bookedPrice: b, 
        bookedDuration: d, 
        bookedService: s, 
        taxBreakdown: JSON.stringify(tx), 
        grandTotal: g, 
        consultationRecord: {
            medicalHistory: m, 
            allergies: document.getElementById('med_allergies').value.trim(), 
            otherMedical: document.getElementById('med_other').value.trim(), 
            callusLevel: document.querySelector('input[name="cond_callus"]:checked')?.value || "Not specified", 
            skinCondition: document.querySelector('input[name="cond_skin"]:checked')?.value || "Not specified", 
            visualNotes: document.getElementById('cond_notes').value.trim(),
            customFields: cust
        }
    }); 
    closeConsult();
}

function startTechQueueListener() {
    db.collection('Active_Jobs').where('assignedTechEmail','==',currentUserEmail).where('status','in',['Waiting','In Progress']).onSnapshot(s => {
        let d = document.getElementById('techLiveQueue'); 
        if(s.empty) return d.innerHTML = '<p style="color:#999;font-style:italic;">Queue is currently empty.</p>'; 
        let h = '';
        s.forEach(x => {
            let j = x.data(); 
            h += `<div class="ticket">
                    <div style="flex-grow:1;">
                        <h4 style="margin:0; font-size:1.1rem;">${j.clientName}</h4>
                        <span class="ticket-badge" style="background:${j.status==='Waiting'?'#f39c12':'#2980b9'};margin-bottom:5px;">${j.status.toUpperCase()}</span>
                        <p style="margin:0; font-size:0.85rem; color:var(--primary);">💅 <strong>${j.bookedService}</strong></p>
                    </div>`;
            if (j.status === 'Waiting') {
                h += `<div style="width:140px;"><button class="btn" style="width:100%; padding:8px; font-size:0.8rem;" onclick="openConsult('${x.id}')">Consultation</button></div>`;
            } else {
                h += `<div style="width:140px;">
                        <button class="btn btn-secondary" style="width:100%; padding:5px; margin-bottom:5px; font-size:0.75rem;" onclick="openConsult('${x.id}')">Edit Record</button>
                        <button class="btn" style="width:100%; padding:5px; font-size:0.75rem; background:var(--success);" onclick="db.collection('Active_Jobs').doc('${x.id}').update({status:'Ready for Payment'})">Complete Job</button>
                    </div>`;
            }
            h += `</div>`;
        });
        d.innerHTML = h;
    });
}

// --- FOH BILLING ---
function startFohBillingListener() {
    db.collection('Active_Jobs').where('status','==','Ready for Payment').onSnapshot(s => {
        let d = document.getElementById('fohPendingCheckoutList'); 
        if(!d) return; 
        if(s.empty) {
            d.innerHTML = '<p style="color:#999;font-style:italic;">No pending checkouts.</p>'; 
            document.getElementById('checkoutPanel').style.display = 'none'; 
            return;
        } 
        let h = '';
        s.forEach(x => {
            let j = x.data(); 
            window.activeJobsCache[x.id] = j; 
            let taxes = []; try { taxes = JSON.parse(j.taxBreakdown || '[]'); } catch(e){}
            let subtotal = parseFloat(j.bookedPrice || 0).toFixed(2); 
            let grandTotal = parseFloat(j.grandTotal || j.bookedPrice || 0).toFixed(2);
            let taxHtml = ''; 
            taxes.forEach(t => { taxHtml += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#777;"><span>+ ${t.name}</span><span>${parseFloat(t.amount).toFixed(2)} GHC</span></div>`; });
            
            h += `<div class="ticket" style="border-color:var(--success);padding:10px;">
                    <div style="flex-grow:1;">
                        <h4 style="margin:0; font-size:1rem; color:var(--success);">${j.clientName}</h4>
                        <p style="margin:0; font-size:0.8rem; margin-bottom:5px;">💅 ${j.bookedService}</p>
                        <div style="background:#f1f1f1; padding:8px; border-radius:4px; max-width:250px;">
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem;"><span>Subtotal:</span><span>${subtotal} GHC</span></div>
                            ${taxHtml}
                            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:0.9rem; margin-top:3px; border-top:1px solid #ddd; padding-top:3px;"><span>Total:</span><span>${grandTotal} GHC</span></div>
                        </div>
                    </div>
                    <button class="btn" style="background:var(--success);width:auto;padding:5px 15px;font-size:0.8rem;align-self:center;" onclick="openCheckout('${x.id}')">Checkout</button>
                  </div>`;
        }); 
        d.innerHTML = h;
    });
}

window.openCheckout = function(id) {
    let j = window.activeJobsCache[id]; 
    if(!j) return;
    document.getElementById('checkoutJobId').value = id; 
    document.getElementById('checkoutClientName').innerText = j.clientName; 
    document.getElementById('checkoutServices').innerText = j.bookedService; 
    document.getElementById('checkoutSubtotal').innerText = parseFloat(j.bookedPrice||0).toFixed(2) + ' GHC'; 
    document.getElementById('checkoutTotal').innerText = parseFloat(j.grandTotal||j.bookedPrice||0).toFixed(2) + ' GHC'; 
    document.getElementById('checkoutGrandTotalVal').value = j.grandTotal||j.bookedPrice||0;
    
    let txa = JSON.parse(j.taxBreakdown || '[]'); 
    document.getElementById('checkoutTaxList').innerHTML = txa.map(t => `<div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#777;"><span>+ ${t.name}</span><span>${parseFloat(t.amount).toFixed(2)} GHC</span></div>`).join('');
    
    document.getElementById('checkoutPanel').style.display = 'block'; 
    document.getElementById('checkoutPanel').scrollIntoView({behavior:'smooth'});
}

window.confirmPayment = async function() {
    let id = document.getElementById('checkoutJobId').value;
    let m = document.getElementById('checkoutPaymentMethod').value;
    let gt = parseFloat(document.getElementById('checkoutGrandTotalVal').value);
    if(!m) return alert("Select method.");
    
    await db.collection('Active_Jobs').doc(id).update({status:'Closed', paymentMethod:m, totalGHC:gt, closedAt:firebase.firestore.FieldValue.serverTimestamp()}); 
    alert("Payment processed successfully!"); 
    document.getElementById('checkoutPanel').style.display = 'none';
}

// --- REPORTING ---
window.generateReport = async function() {
    let s = document.getElementById('reportStart').value;
    let e = document.getElementById('reportEnd').value; 
    if(!s || !e) return alert("Dates needed.");
    
    let q = await db.collection('Active_Jobs').where('status','==','Closed').where('dateString','>=',s).where('dateString','<=',e).get();
    let tr = 0;
    q.forEach(d => { tr += parseFloat(d.data().totalGHC || 0); }); 
    
    document.getElementById('reportTotalRevenue').innerText = tr.toFixed(2) + " GHC"; 
    document.getElementById('reportResults').style.display = 'block';
}

function startFohFinancialListener() { 
    db.collection('Active_Jobs').where('status','==','Closed').where('dateString','==',todayDateStr).onSnapshot(s => {
        let tr=0, c=0; 
        s.forEach(d => { tr += parseFloat(d.data().totalGHC || 0); c++; }); 
        let er = document.getElementById('fohDailyRevenue'); if(er) er.innerText = tr.toFixed(2) + ' GHC'; 
        let ec = document.getElementById('fohDailyJobs'); if(ec) ec.innerText = c; 
    }); 
}

function startTechFinancialListener() { 
    db.collection('Active_Jobs').where('status','==','Closed').where('dateString','==',todayDateStr).where('assignedTechEmail','==',currentUserEmail).onSnapshot(s => {
        let tr=0, c=0; 
        s.forEach(d => { tr += parseFloat(d.data().totalGHC || 0); c++; }); 
        let er = document.getElementById('techDailyRevenue'); if(er) er.innerText = tr.toFixed(2) + ' GHC'; 
        let ec = document.getElementById('techServiceCount'); if(ec) ec.innerText = c; 
    }); 
}

function startFohRosterListener() {
    let el = document.getElementById('fohRosterList'); 
    if(!el) return;
    db.collection('Attendance').where('date','==',todayDateStr).onSnapshot(async(aS) => {
        let aj = await db.collection('Active_Jobs').where('status','in',['Waiting','In Progress']).get();
        let bs = []; 
        aj.forEach(j => bs.push(j.data().assignedTechEmail));
        
        let nw = new Date();
        let cm = nw.getHours() * 60 + nw.getMinutes(); 
        
        let scheduled = await db.collection('Appointments').where('dateString','==',todayDateStr).where('status','==','Scheduled').get();
        scheduled.forEach(d => {
            let a = d.data();
            let s = timeToMins(a.timeString); 
            if(cm >= s && cm < s + parseInt(a.bookedDuration || 0)) bs.push(a.assignedTechEmail);
        });
        
        let h = ''; 
        aS.forEach(d => {
            let t = d.data(); 
            if(t.clockOut || !t.roleString.toLowerCase().includes('tech')) return; 
            let b = bs.includes(t.email); 
            h += `<div class="roster-item"><div>${t.name}</div><div><span class="status-dot ${b?'status-busy':'status-available'}"></span><b style="color:${b?'var(--error)':'var(--success)'}">${b?'BUSY':'FREE'}</b></div></div>`;
        }); 
        el.innerHTML = h || '<p style="color:#999;font-style:italic;">No Techs Clocked In.</p>';
    });
}

// --- ADMIN DIRECTORY ---
function loadStaffDirectory() {
    let el = document.getElementById('adminStaffList'); 
    if(!el) return; 
    el.innerHTML = 'Loading...';
    db.collection('Users').onSnapshot(s => {
        if(s.empty) return el.innerHTML = '<p style="color:#999;font-style:italic;">No staff found.</p>';
        el.innerHTML = ''; 
        let tb = document.createElement('table'); 
        tb.className = 'breakdown-table'; 
        tb.innerHTML = '<thead><tr><th>Name</th><th>Google Email</th><th>Departments</th><th style="text-align:center;">Action</th></tr></thead>'; 
        let bd = document.createElement('tbody');
        s.forEach(d => {
            try { 
                let dt = d.data();
                let nm = String(dt.name || "").replace(/['"]/g,"");
                let em = d.id;
                let rArr = Array.isArray(dt.roles) ? dt.roles : []; 
                window.staffCache[em] = {name: nm, roles: rArr}; 
                
                let tg = rArr.map(x => {
                    let c = (x.toLowerCase().includes('admin')) ? 'var(--admin)' : (x === 'Manager' ? 'var(--manager)' : (x === 'Supply Chain' ? 'var(--supply)' : (x === 'FOH' ? '#e74c3c' : 'var(--primary)'))); 
                    return `<span class="ticket-badge" style="background:${c};margin:2px;">${x}</span>`
                }).join('');
                
                let tr = document.createElement('tr'); 
                tr.innerHTML = `<td><strong>${nm}</strong></td><td style="color:#666;">${em}</td><td>${tg}</td><td style="text-align:center;display:flex;gap:5px;justify-content:center;"><button class="btn" style="padding:5px 10px;width:auto;font-size:0.75rem;background:var(--primary);" onclick="editStaff('${em}')">Edit</button> <button class="btn btn-secondary" style="padding:5px 10px;width:auto;font-size:0.75rem;color:red;border-color:red;" onclick="deleteStaff('${em}')">Del</button></td>`; 
                bd.appendChild(tr);
            } catch(e) {}
        }); 
        tb.appendChild(bd); 
        el.appendChild(tb);
    }, e => { el.innerHTML = `<b style="color:red">DB Error: ${e.message}</b>`; });
}

window.editStaff = function(em) { 
    let user = window.staffCache[em]; 
    if(!user) return; 
    document.getElementById('admin_newEmail').value = em; 
    document.getElementById('admin_newName').value = user.name; 
    document.getElementById('admin_newPassword').value = ''; 
    document.getElementById('admin_newPassword').placeholder = "(Leave blank to keep)";
    let rs = user.roles.map(r => r.toLowerCase()); 
    document.querySelectorAll('.role-checkbox').forEach(c => c.checked = rs.includes(c.value.toLowerCase())); 
    window.scrollTo(0,0);
}

window.deleteStaff = async function(em) {
    if(confirm(`Are you sure you want to permanently delete ${em}?`)) {
        try { 
            await db.collection('Users').doc(em).delete(); 
            alert("Staff deleted."); 
        } catch(e) { alert("Error: " + e.message); }
    }
}

window.addStaffAccount = async function() {
    let n = document.getElementById('admin_newName').value.trim();
    let e = document.getElementById('admin_newEmail').value.trim().toLowerCase();
    let p = document.getElementById('admin_newPassword').value;
    let r = Array.from(document.querySelectorAll('.role-checkbox:checked')).map(c => c.value);
    
    if(!n || !e || !r.length) return alert("Fill all fields and select roles.");
    if(p) { 
        try { 
            await secondaryApp.auth().createUserWithEmailAndPassword(e, p); 
            await secondaryApp.auth().signOut(); 
        } catch(x) { 
            if(x.code !== 'auth/email-already-in-use') return alert(x.message);
        } 
    }
    await db.collection('Users').doc(e).set({name: n, roles: r}, {merge: true}); 
    alert("Saved Matrix."); 
    
    document.getElementById('admin_newName').value = ''; 
    document.getElementById('admin_newEmail').value = ''; 
    document.getElementById('admin_newPassword').value = ''; 
    document.querySelectorAll('.role-checkbox').forEach(c => c.checked = false);
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
