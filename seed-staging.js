// ============================================================
//  THURAYA STAGING — Seed Script
//  Run this ONCE from the browser console while logged into
//  the staging staff app to populate the staging database
//  with realistic test data.
//
//  HOW TO USE:
//  1. Open your staging staff app URL
//  2. Log in as Admin
//  3. Open DevTools Console (F12)
//  4. Type: allow pasting
//  5. Paste this entire script and press Enter
//  6. Wait for "✅ Seed complete!" message
// ============================================================

async function seedStagingData() {
    console.log('🌱 Starting seed...');

    const batch1 = db.batch();
    const now    = firebase.firestore.FieldValue.serverTimestamp();
    const today  = new Date();
    const toDateStr = (d) => d.toISOString().slice(0,10);
    const addDays   = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
    const todayStr  = toDateStr(today);

    // ── 1. STAFF USERS ────────────────────────────────────────
    console.log('👤 Seeding staff users...');
    const staff = [
        { email: 'admin@staging.test',   name: 'Admin User',    roles: ['Admin'] },
        { email: 'manager@staging.test', name: 'Sarah Manager', roles: ['Manager'] },
        { email: 'tech1@staging.test',   name: 'Hannah FT',     roles: ['Tech'], visibleToClients: true },
        { email: 'tech2@staging.test',   name: 'Janet HT',      roles: ['Tech'], visibleToClients: true },
        { email: 'tech3@staging.test',   name: 'Salam FT',      roles: ['Tech'], visibleToClients: false },
        { email: 'foh@staging.test',     name: 'FOH Agent',     roles: ['FOH'] },
        { email: 'supply@staging.test',  name: 'Supply Staff',  roles: ['Supply Chain'] },
    ];
    staff.forEach(s => {
        batch1.set(db.collection('Users').doc(s.email), {
            name: s.name, roles: s.roles,
            visibleToClients: s.visibleToClients !== undefined ? s.visibleToClients : true,
            updatedAt: now
        });
    });

    // ── 2. STAFF SCHEDULES ────────────────────────────────────
    console.log('📅 Seeding staff schedules...');
    const schedules = [
        { email: 'tech1@staging.test', workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], startTime: '09:00', endTime: '18:00' },
        { email: 'tech2@staging.test', workingDays: ['Mon','Tue','Wed','Thu','Fri'],       startTime: '10:00', endTime: '19:00' },
        { email: 'tech3@staging.test', workingDays: ['Tue','Wed','Thu','Fri','Sat'],       startTime: '09:00', endTime: '17:00' },
    ];
    schedules.forEach(s => {
        batch1.set(db.collection('Staff_Schedules').doc(s.email), {
            workingDays: s.workingDays, startTime: s.startTime, endTime: s.endTime,
            effectiveFrom: todayStr, updatedAt: now
        });
    });

    // ── 3. LEAVE BALANCES ─────────────────────────────────────
    const year = today.getFullYear();
    staff.filter(s => s.roles.includes('Tech')).forEach(s => {
        batch1.set(db.collection('Staff_Leave_Balances').doc(s.email), {
            [year]: 14, annualLeave: 14, updatedAt: now
        });
    });

    await batch1.commit();
    console.log('✅ Staff seeded');

    // ── 4. CLIENTS ────────────────────────────────────────────
    console.log('👥 Seeding clients...');
    const clients = [
        { Forename: 'Ama',     Surname: 'Asante',   Tel_Number: '0241234001', Email: 'ama@test.com',     Gender: 'Female', DOB: '1990-04-15' },
        { Forename: 'Kofi',    Surname: 'Mensah',   Tel_Number: '0241234002', Email: 'kofi@test.com',    Gender: 'Male',   DOB: '1985-07-22' },
        { Forename: 'Abena',   Surname: 'Owusu',    Tel_Number: '0241234003', Email: 'abena@test.com',   Gender: 'Female', DOB: '1995-01-30' },
        { Forename: 'Kwame',   Surname: 'Boateng',  Tel_Number: '0241234004', Email: 'kwame@test.com',   Gender: 'Male',   DOB: '1988-11-05' },
        { Forename: 'Adwoa',   Surname: 'Darko',    Tel_Number: '0241234005', Email: 'adwoa@test.com',   Gender: 'Female', DOB: '1992-' + String(today.getMonth()+1).padStart(2,'0') + '-10' }, // birthday this month
        { Forename: 'Yaa',     Surname: 'Gyamfi',   Tel_Number: '0241234006', Email: 'yaa@test.com',     Gender: 'Female', DOB: '1993-03-18' },
        { Forename: 'Nana',    Surname: 'Acheampong',Tel_Number:'0241234007', Email: 'nana@test.com',    Gender: 'Female', DOB: '1997-09-25' },
        { Forename: 'Efua',    Surname: 'Quartey',  Tel_Number: '0241234008', Email: 'efua@test.com',    Gender: 'Female', DOB: '1991-06-14' },
        { Forename: 'Akosua',  Surname: 'Frimpong', Tel_Number: '0241234009', Email: 'akosua@test.com',  Gender: 'Female', DOB: '1994-02-28' },
        { Forename: 'Maame',   Surname: 'Sarpong',  Tel_Number: '0241234010', Email: 'maame@test.com',   Gender: 'Female', DOB: '1989-08-03' },
    ];

    const batch2 = db.batch();
    clients.forEach(c => {
        batch2.set(db.collection('Clients').doc(c.Tel_Number), {
            ...c, createdAt: now, updatedAt: now
        });
    });
    await batch2.commit();
    console.log('✅ Clients seeded');

    // ── 5. PAST APPOINTMENTS & ACTIVE JOBS ───────────────────
    console.log('📋 Seeding past appointments...');

    const services = [
        { name: 'Classic Mani & Pedi', duration: 90,  price: 180 },
        { name: 'Gel Polish Manicure', duration: 60,  price: 120 },
        { name: 'Luxury Pedicure',     duration: 75,  price: 150 },
        { name: 'Youthful Touch',      duration: 120, price: 220 },
        { name: 'Nail Art (2 nails)',   duration: 30,  price: 60  },
        { name: 'Balayage Treatment',  duration: 150, price: 350 },
    ];

    const techs = [
        { email: 'tech1@staging.test', name: 'Hannah FT' },
        { email: 'tech2@staging.test', name: 'Janet HT' },
    ];

    // Generate 30 past closed jobs across last 3 months
    const batch3 = db.batch();
    let jobCount = 0;

    for (let i = 0; i < 30; i++) {
        const client  = clients[i % clients.length];
        const svc     = services[i % services.length];
        const tech    = techs[i % techs.length];
        const daysAgo = Math.floor(Math.random() * 90) + 1;
        const jobDate = toDateStr(addDays(today, -daysAgo));
        const hour    = 9 + (i % 8);
        const timeStr = `${String(hour).padStart(2,'0')}:00`;
        const tax     = parseFloat((svc.price * 0.15).toFixed(2));
        const grand   = svc.price + tax;
        const pays    = ['Cash', 'Mobile Money', 'Card'];

        const apptRef = db.collection('Appointments').doc();
        batch3.set(apptRef, {
            clientName:        `${client.Forename} ${client.Surname}`,
            clientPhone:       client.Tel_Number,
            assignedTechEmail: tech.email,
            assignedTechName:  tech.name,
            bookedService:     svc.name,
            bookedDuration:    String(svc.duration),
            bookedPrice:       String(svc.price),
            grandTotal:        String(grand),
            taxBreakdown:      JSON.stringify([{ name:'VAT 15%', amount: tax }]),
            dateString:        jobDate,
            timeString:        timeStr,
            status:            'Closed',
            isGroupBooking:    false,
            createdAt:         now
        });

        const jobRef = db.collection('Active_Jobs').doc();
        batch3.set(jobRef, {
            clientName:        `${client.Forename} ${client.Surname}`,
            clientPhone:       client.Tel_Number,
            assignedTechEmail: tech.email,
            assignedTechName:  tech.name,
            bookedService:     svc.name,
            bookedDuration:    String(svc.duration),
            bookedPrice:       String(svc.price),
            grandTotal:        String(grand),
            taxBreakdown:      JSON.stringify([{ name:'VAT 15%', amount: tax }]),
            dateString:        jobDate,
            timeString:        timeStr,
            status:            'Closed',
            paymentMethod:     pays[i % pays.length],
            fohCreator:        'foh@staging.test',
            createdAt:         now
        });
        jobCount++;
    }
    await batch3.commit();
    console.log(`✅ ${jobCount} past jobs seeded`);

    // ── 6. TODAY'S APPOINTMENTS ───────────────────────────────
    console.log('📅 Seeding today\'s appointments...');
    const batch4 = db.batch();

    const todayAppts = [
        { client: clients[0], svc: services[0], tech: techs[0], time: '09:30', status: 'Scheduled' },
        { client: clients[1], svc: services[1], tech: techs[1], time: '10:00', status: 'Arrived' },
        { client: clients[2], svc: services[2], tech: techs[0], time: '11:00', status: 'In Progress' },
        { client: clients[3], svc: services[3], tech: techs[1], time: '14:00', status: 'Scheduled' },
        { client: clients[4], svc: services[4], tech: techs[0], time: '15:30', status: 'Scheduled' },
    ];

    todayAppts.forEach(a => {
        const tax   = parseFloat((a.svc.price * 0.15).toFixed(2));
        const grand = a.svc.price + tax;
        const ref   = db.collection('Appointments').doc();
        batch4.set(ref, {
            clientName:        `${a.client.Forename} ${a.client.Surname}`,
            clientPhone:       a.client.Tel_Number,
            assignedTechEmail: a.tech.email,
            assignedTechName:  a.tech.name,
            bookedService:     a.svc.name,
            bookedDuration:    String(a.svc.duration),
            bookedPrice:       String(a.svc.price),
            grandTotal:        String(grand),
            taxBreakdown:      JSON.stringify([{ name:'VAT 15%', amount: tax }]),
            dateString:        todayStr,
            timeString:        a.time,
            status:            a.status,
            isGroupBooking:    false,
            createdAt:         now
        });

        // Create Active_Job for arrived/in-progress
        if (a.status === 'Arrived' || a.status === 'In Progress') {
            const jobRef = db.collection('Active_Jobs').doc();
            batch4.set(jobRef, {
                clientName:        `${a.client.Forename} ${a.client.Surname}`,
                clientPhone:       a.client.Tel_Number,
                assignedTechEmail: a.tech.email,
                assignedTechName:  a.tech.name,
                bookedService:     a.svc.name,
                bookedDuration:    String(a.svc.duration),
                bookedPrice:       String(a.svc.price),
                grandTotal:        String(grand),
                taxBreakdown:      JSON.stringify([{ name:'VAT 15%', amount: tax }]),
                dateString:        todayStr,
                timeString:        a.time,
                status:            a.status,
                paymentMethod:     '',
                fohCreator:        'foh@staging.test',
                createdAt:         now
            });
        }
    });

    await batch4.commit();
    console.log('✅ Today\'s appointments seeded');

    // ── 7. FUTURE APPOINTMENTS ────────────────────────────────
    console.log('🔮 Seeding future appointments...');
    const batch5 = db.batch();

    for (let i = 1; i <= 14; i++) {
        const client  = clients[i % clients.length];
        const svc     = services[i % services.length];
        const tech    = techs[i % techs.length];
        const futDate = toDateStr(addDays(today, i));
        const tax     = parseFloat((svc.price * 0.15).toFixed(2));
        const grand   = svc.price + tax;
        const ref     = db.collection('Appointments').doc();
        batch5.set(ref, {
            clientName:        `${client.Forename} ${client.Surname}`,
            clientPhone:       client.Tel_Number,
            assignedTechEmail: tech.email,
            assignedTechName:  tech.name,
            bookedService:     svc.name,
            bookedDuration:    String(svc.duration),
            bookedPrice:       String(svc.price),
            grandTotal:        String(grand),
            taxBreakdown:      JSON.stringify([{ name:'VAT 15%', amount: tax }]),
            dateString:        futDate,
            timeString:        `${String(9 + (i%8)).padStart(2,'0')}:00`,
            status:            'Scheduled',
            isGroupBooking:    false,
            createdAt:         now
        });
    }
    await batch5.commit();
    console.log('✅ Future appointments seeded');

    // ── 8. LEAVE RECORDS ──────────────────────────────────────
    console.log('🌿 Seeding leave records...');
    const batch6 = db.batch();

    const leaveRecords = [
        { techEmail: 'tech1@staging.test', techName: 'Hannah FT', type: 'Annual Leave', startDate: toDateStr(addDays(today, 7)), endDate: toDateStr(addDays(today, 9)), status: 'Approved', note: 'Family trip' },
        { techEmail: 'tech2@staging.test', techName: 'Janet HT',  type: 'Sick Leave',   startDate: toDateStr(addDays(today,-5)), endDate: toDateStr(addDays(today,-4)), status: 'Approved', note: 'Medical' },
        { techEmail: 'tech3@staging.test', techName: 'Salam FT',  type: 'Annual Leave', startDate: toDateStr(addDays(today, 3)), endDate: toDateStr(addDays(today, 3)), status: 'Pending',  note: 'Personal' },
        { techEmail: 'tech1@staging.test', techName: 'Hannah FT', type: 'Day Off',       startDate: toDateStr(addDays(today,-15)),endDate: toDateStr(addDays(today,-15)),status: 'Approved', note: '' },
    ];

    leaveRecords.forEach(l => {
        batch6.set(db.collection('Staff_Leave').doc(), {
            ...l, approvedBy: 'manager@staging.test', createdAt: now
        });
    });

    await batch6.commit();
    console.log('✅ Leave records seeded');

    // ── 9. SERVICE MENU ───────────────────────────────────────
    console.log('💅 Seeding service menu...');
    const batch7 = db.batch();

    const menuServices = [
        { name: 'Classic Mani & Pedi', duration: 90,  price: 180, category: 'Hands & Feet', dept: 'Both',  popular: true },
        { name: 'Gel Polish Manicure', duration: 60,  price: 120, category: 'Hands',         dept: 'Hand',  popular: true },
        { name: 'Luxury Pedicure',     duration: 75,  price: 150, category: 'Feet',          dept: 'Foot',  popular: true },
        { name: 'Youthful Touch',      duration: 120, price: 220, category: 'Premium',       dept: 'Both',  popular: true },
        { name: 'Nail Art (2 nails)',  duration: 30,  price: 60,  category: 'Add-ons',       dept: 'Hand',  popular: false },
        { name: 'French Tips',         duration: 45,  price: 90,  category: 'Hands',         dept: 'Hand',  popular: false },
        { name: 'Callus Treatment',    duration: 30,  price: 70,  category: 'Feet',          dept: 'Foot',  popular: false },
        { name: 'Paraffin Wax Dip',   duration: 20,  price: 50,  category: 'Add-ons',       dept: 'Both',  popular: false },
    ];

    menuServices.forEach((s, i) => {
        batch7.set(db.collection('Services').doc(), {
            ...s, order: i, active: true, createdAt: now
        });
    });

    await batch7.commit();
    console.log('✅ Service menu seeded');

    // ── 10. CLIENT NOTES ──────────────────────────────────────
    const batch8 = db.batch();
    batch8.set(db.collection('Client_Notes').doc('0241234001'), {
        notes: 'Ama prefers Hannah. Always books Classic Mani & Pedi. Sensitive skin on left foot.',
        updatedBy: 'manager@staging.test', updatedAt: now
    });
    batch8.set(db.collection('Client_Notes').doc('0241234005'), {
        notes: 'Adwoa — VIP client. Always give complimentary tea. Birthday this month.',
        updatedBy: 'manager@staging.test', updatedAt: now
    });
    await batch8.commit();
    console.log('✅ Client notes seeded');

    console.log('');
    console.log('🎉 ═══════════════════════════════════════');
    console.log('✅  SEED COMPLETE — Staging data ready!');
    console.log('');
    console.log('   Staff accounts created:');
    staff.forEach(s => console.log(`   • ${s.name} (${s.email}) — ${s.roles[0]}`));
    console.log('');
    console.log('   Test data summary:');
    console.log('   • 10 clients');
    console.log('   • 30 past closed jobs (last 3 months)');
    console.log('   • 5 today\'s appointments (mix of statuses)');
    console.log('   • 14 future appointments (next 2 weeks)');
    console.log('   • 4 leave records');
    console.log('   • 8 service menu items');
    console.log('   • 2 client notes');
    console.log('');
    console.log('   ⚠️  Note: Staff cannot log in via Google');
    console.log('   until you create auth accounts in Firebase');
    console.log('   Console → Authentication → Add User');
    console.log('═══════════════════════════════════════ 🎉');
}

// Run it
seedStagingData().catch(e => {
    console.error('❌ Seed failed:', e.message);
});
