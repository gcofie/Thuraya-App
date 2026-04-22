import { useState, useMemo } from "react";

// ─── Seed Data ────────────────────────────────────────────────────────────────
const SERVICES = [
  { id: "s1", name: "Full Highlights", duration: 120, color: "#e8b86d" },
  { id: "s2", name: "Balayage", duration: 150, color: "#d4a574" },
  { id: "s3", name: "Cut & Style", duration: 60, color: "#7eb8c9" },
  { id: "s4", name: "Keratin Treatment", duration: 180, color: "#a8c5a0" },
  { id: "s5", name: "Deep Condition", duration: 45, color: "#c9a7d4" },
  { id: "s6", name: "Blowout", duration: 30, color: "#f0c0a0" },
];

const TECHS = [
  { id: "t1", name: "Amara K.", avatar: "AK", color: "#e8b86d", services: ["s1","s2","s3","s6"] },
  { id: "t2", name: "Sofia R.", avatar: "SR", color: "#7eb8c9", services: ["s1","s3","s4","s5"] },
  { id: "t3", name: "Jade M.", avatar: "JM", color: "#a8c5a0", services: ["s2","s3","s5","s6"] },
  { id: "t4", name: "Priya N.", avatar: "PN", color: "#c9a7d4", services: ["s1","s2","s4","s6"] },
];

// Blocked slots per tech [techId]: Set of "YYYY-MM-DD|HH:MM"
const BLOCKED = {
  t1: new Set(["2025-06-14|09:00","2025-06-14|09:30","2025-06-14|10:00","2025-06-14|14:00","2025-06-14|14:30"]),
  t2: new Set(["2025-06-14|10:00","2025-06-14|10:30","2025-06-14|11:00","2025-06-14|15:00"]),
  t3: new Set(["2025-06-14|09:00","2025-06-14|13:00","2025-06-14|13:30","2025-06-14|16:00"]),
  t4: new Set(["2025-06-14|11:00","2025-06-14|11:30","2025-06-14|14:00","2025-06-14|16:30"]),
};

const HOURS = [];
for (let h = 9; h <= 17; h++) {
  HOURS.push(`${String(h).padStart(2,"0")}:00`);
  if (h < 17) HOURS.push(`${String(h).padStart(2,"0")}:30`);
}

const TODAY = "2025-06-14";

function isTechFree(techId, dateKey, time, durationMins) {
  const slots = Math.ceil(durationMins / 30);
  const [hh, mm] = time.split(":").map(Number);
  let minutes = hh * 60 + mm;
  for (let i = 0; i < slots; i++) {
    const slotH = String(Math.floor(minutes / 60)).padStart(2,"0");
    const slotM = String(minutes % 60).padStart(2,"0");
    if (BLOCKED[techId]?.has(`${dateKey}|${slotH}:${slotM}`)) return false;
    minutes += 30;
  }
  return true;
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function Avatar({ tech, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: tech.color + "33", border: `2px solid ${tech.color}`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize: size * 0.35, fontWeight: 700, color: tech.color,
      flexShrink: 0, letterSpacing: "-0.5px"
    }}>{tech.avatar}</div>
  );
}

function ServicePill({ service, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${selected ? service.color : "#2a2a2a"}`,
      background: selected ? service.color + "22" : "transparent",
      color: selected ? service.color : "#888", fontSize: 12, fontWeight: 600,
      cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
      fontFamily: "inherit"
    }}>{service.name}</button>
  );
}

function PersonCard({ person, index, onUpdate, onRemove, canRemove, selectedDate }) {
  const availableTechs = person.serviceId
    ? TECHS.filter(t => t.services.includes(person.serviceId))
    : TECHS;

  return (
    <div style={{
      background: "#111", border: "1px solid #222", borderRadius: 16,
      padding: "20px 20px 16px", position: "relative",
      boxShadow: "0 4px 24px rgba(0,0,0,0.3)"
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background:"#1e1e1e",
          border:"1.5px solid #333", display:"flex", alignItems:"center",
          justifyContent:"center", fontSize: 11, fontWeight: 700, color: "#666"
        }}>{index + 1}</div>
        <input
          placeholder={`Client name…`}
          value={person.name}
          onChange={e => onUpdate({ name: e.target.value })}
          style={{
            flex: 1, background:"transparent", border:"none", outline:"none",
            color: "#e8e8e8", fontSize: 14, fontWeight: 600, fontFamily:"inherit"
          }}
        />
        {canRemove && (
          <button onClick={onRemove} style={{
            width: 24, height: 24, borderRadius: "50%", border:"1px solid #333",
            background:"transparent", color:"#555", cursor:"pointer", fontSize: 14,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink: 0
          }}>×</button>
        )}
      </div>

      {/* Service selection */}
      <p style={{ fontSize: 10, fontWeight: 700, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom: 8 }}>Service</p>
      <div style={{ display:"flex", flexWrap:"wrap", gap: 6, marginBottom: 16 }}>
        {SERVICES.map(s => (
          <ServicePill key={s.id} service={s} selected={person.serviceId === s.id}
            onClick={() => onUpdate({ serviceId: s.id, techId: "" })} />
        ))}
      </div>

      {/* Tech selection */}
      {person.serviceId && (
        <>
          <p style={{ fontSize: 10, fontWeight: 700, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom: 8 }}>Technician</p>
          <div style={{ display:"flex", gap: 8, flexWrap:"wrap" }}>
            {availableTechs.map(t => {
              const service = SERVICES.find(s => s.id === person.serviceId);
              const free = selectedDate ? isTechFree(t.id, selectedDate, "09:00", service?.duration || 60) : true;
              const sel = person.techId === t.id;
              return (
                <button key={t.id} onClick={() => onUpdate({ techId: t.id })} style={{
                  display:"flex", alignItems:"center", gap: 8, padding:"8px 12px",
                  borderRadius: 10, border: `1.5px solid ${sel ? t.color : "#2a2a2a"}`,
                  background: sel ? t.color + "18" : "#0d0d0d",
                  cursor:"pointer", transition:"all 0.15s", opacity: free ? 1 : 0.4
                }}>
                  <Avatar tech={t} size={26} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: sel ? t.color : "#888", fontFamily:"inherit" }}>{t.name}</span>
                  {!free && <span style={{ fontSize: 10, color:"#ff6b6b" }}>busy</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Time Slot Grid ───────────────────────────────────────────────────────────
function TimeSlotGrid({ people, selectedDate, selectedTime, onSelect }) {
  const assignments = people.filter(p => p.serviceId && p.techId);

  const slotAvailability = useMemo(() => {
    return HOURS.map(time => {
      if (!selectedDate || assignments.length === 0) return { time, free: true, partial: false };
      let allFree = true;
      let anyFree = false;
      for (const p of assignments) {
        const svc = SERVICES.find(s => s.id === p.serviceId);
        const free = isTechFree(p.techId, selectedDate, time, svc?.duration || 60);
        if (free) anyFree = true;
        else allFree = false;
      }
      return { time, free: allFree, partial: !allFree && anyFree };
    });
  }, [assignments, selectedDate]);

  if (assignments.length === 0) return (
    <div style={{ textAlign:"center", padding: "32px 16px", color:"#444", fontSize: 13 }}>
      Add a service &amp; technician to each person to see available times
    </div>
  );

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap: 6 }}>
        {slotAvailability.map(({ time, free, partial }) => {
          const sel = selectedTime === time;
          return (
            <button key={time} disabled={!free} onClick={() => onSelect(time)} style={{
              padding: "10px 4px", borderRadius: 10, textAlign:"center",
              border: sel ? "1.5px solid #e8b86d" : `1.5px solid ${free ? "#252525" : "#1a1a1a"}`,
              background: sel ? "#e8b86d22" : free ? "#111" : "#0a0a0a",
              color: sel ? "#e8b86d" : free ? "#ccc" : "#333",
              fontSize: 12, fontWeight: sel ? 700 : 500,
              cursor: free ? "pointer" : "not-allowed",
              transition:"all 0.12s", fontFamily:"inherit",
              position:"relative", overflow:"hidden"
            }}>
              {time}
              {partial && !sel && (
                <span style={{
                  position:"absolute", top: 3, right: 4,
                  width: 6, height: 6, borderRadius:"50%", background:"#e8a84d"
                }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", gap: 16, marginTop: 12, fontSize: 11, color:"#555" }}>
        <span style={{ display:"flex", alignItems:"center", gap: 5 }}>
          <span style={{ width:8,height:8,borderRadius:"50%",background:"#2a2a2a",display:"inline-block"}} />
          Available
        </span>
        <span style={{ display:"flex", alignItems:"center", gap: 5 }}>
          <span style={{ width:8,height:8,borderRadius:"50%",background:"#e8a84d",display:"inline-block"}} />
          Partial conflict
        </span>
        <span style={{ display:"flex", alignItems:"center", gap: 5 }}>
          <span style={{ width:8,height:8,borderRadius:"50%",background:"#1a1a1a",border:"1px solid #222",display:"inline-block"}} />
          Unavailable
        </span>
      </div>
    </div>
  );
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────
function ConfirmModal({ people, date, time, onConfirm, onClose, loading, done }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", backdropFilter:"blur(6px)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex: 100, padding: 20
    }}>
      <div style={{
        background:"#111", border:"1px solid #222", borderRadius: 20,
        padding: 28, maxWidth: 440, width:"100%",
        boxShadow:"0 24px 80px rgba(0,0,0,0.8)"
      }}>
        {done ? (
          <div style={{ textAlign:"center", padding: "16px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <h3 style={{ color:"#e8b86d", fontFamily:"'Playfair Display',serif", fontSize: 22, marginBottom: 8 }}>
              Booking Confirmed
            </h3>
            <p style={{ color:"#777", fontSize: 13 }}>
              {people.length} appointment{people.length > 1 ? "s" : ""} written to Firestore in a single transaction.
            </p>
            <button onClick={onClose} style={{
              marginTop: 20, padding:"10px 28px", borderRadius: 10,
              background:"#e8b86d22", border:"1.5px solid #e8b86d",
              color:"#e8b86d", fontWeight: 700, cursor:"pointer", fontFamily:"inherit"
            }}>Done</button>
          </div>
        ) : (
          <>
            <h3 style={{ fontFamily:"'Playfair Display',serif", color:"#e8e8e8", fontSize: 20, marginBottom: 4 }}>
              Confirm Group Booking
            </h3>
            <p style={{ color:"#555", fontSize: 12, marginBottom: 20 }}>
              {date} · {time} · {people.length} client{people.length > 1 ? "s" : ""}
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap: 10, marginBottom: 24 }}>
              {people.map((p, i) => {
                const svc = SERVICES.find(s => s.id === p.serviceId);
                const tech = TECHS.find(t => t.id === p.techId);
                return (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap: 12,
                    padding:"12px 14px", background:"#0d0d0d", borderRadius: 12,
                    border:"1px solid #1e1e1e"
                  }}>
                    <div style={{
                      width:28, height:28, borderRadius:"50%", background:"#1e1e1e",
                      border:"1.5px solid #333", display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:11, fontWeight:700, color:"#666"
                    }}>{i+1}</div>
                    <div style={{ flex:1 }}>
                      <p style={{ color:"#ccc", fontSize:13, fontWeight:600, margin:0 }}>{p.name || "Unnamed client"}</p>
                      <p style={{ color:"#555", fontSize:11, margin:0 }}>{svc?.name} · {tech?.name}</p>
                    </div>
                    <span style={{ fontSize:11, color:"#666" }}>{svc?.duration}m</span>
                  </div>
                );
              })}
            </div>
            {/* Firestore batch hint */}
            <div style={{
              padding:"10px 14px", background:"#0d1a0d", border:"1px solid #1a2e1a",
              borderRadius: 10, marginBottom: 20, fontSize: 11, color:"#5a8a5a",
              fontFamily:"'JetBrains Mono',monospace"
            }}>
              <span style={{ color:"#4a7a4a" }}>// Firestore batch write</span><br />
              <span style={{ color:"#6aaa6a" }}>const</span> batch = db.batch();<br />
              {people.map((p,i) => (
                <span key={i} style={{ color:"#888" }}>
                  batch.set(apptRef_{i+1}, {"{"} ...data {"}"}); <br />
                </span>
              ))}
              <span style={{ color:"#6aaa6a" }}>await</span> batch.commit();
            </div>
            <div style={{ display:"flex", gap: 10 }}>
              <button onClick={onClose} style={{
                flex:1, padding:"11px 0", borderRadius:10, border:"1px solid #2a2a2a",
                background:"transparent", color:"#666", cursor:"pointer", fontFamily:"inherit"
              }}>Cancel</button>
              <button onClick={onConfirm} disabled={loading} style={{
                flex:2, padding:"11px 0", borderRadius:10, border:"1.5px solid #e8b86d",
                background:"#e8b86d22", color:"#e8b86d", fontWeight:700,
                cursor: loading ? "wait" : "pointer", fontFamily:"inherit",
                opacity: loading ? 0.6 : 1
              }}>{loading ? "Writing…" : `Confirm ${people.length} Appointments`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GroupBookingForm() {
  const [people, setPeople] = useState([
    { id: 1, name: "", serviceId: "", techId: "" }
  ]);
  const [nextId, setNextId] = useState(2);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [selectedTime, setSelectedTime] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const addPerson = () => {
    setPeople(p => [...p, { id: nextId, name: "", serviceId: "", techId: "" }]);
    setNextId(n => n + 1);
    setSelectedTime(""); // reset time when group changes
  };

  const updatePerson = (id, patch) => {
    setPeople(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
    setSelectedTime("");
  };

  const removePerson = (id) => {
    setPeople(p => p.filter(x => x.id !== id));
    setSelectedTime("");
  };

  const readyPeople = people.filter(p => p.serviceId && p.techId);
  const canBook = readyPeople.length > 0 && selectedDate && selectedTime;

  const handleConfirm = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1800)); // simulate Firestore batch
    setLoading(false);
    setDone(true);
  };

  const handleClose = () => {
    if (done) {
      setPeople([{ id: nextId, name: "", serviceId: "", techId: "" }]);
      setNextId(n => n + 1);
      setSelectedDate(TODAY);
      setSelectedTime("");
      setDone(false);
    }
    setShowConfirm(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080808",
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      color: "#e8e8e8", padding: "28px 16px"
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        input::placeholder { color: #3a3a3a; }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.3); }
      `}</style>

      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display:"flex", alignItems:"center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 6, height: 28, borderRadius: 3, background:"linear-gradient(#e8b86d,#d4944a)"
            }} />
            <h1 style={{
              fontFamily:"'Playfair Display',serif", fontSize: 26, fontWeight:700, color:"#f0e8d8"
            }}>Group Booking</h1>
          </div>
          <p style={{ fontSize:13, color:"#555", paddingLeft:16 }}>Multi-client session · Batch write</p>
        </div>

        {/* Date row */}
        <div style={{
          background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:14,
          padding:"14px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:12
        }}>
          <span style={{ fontSize:18 }}>📅</span>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:10, fontWeight:700, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Date</p>
            <input type="date" value={selectedDate}
              onChange={e => { setSelectedDate(e.target.value); setSelectedTime(""); }}
              style={{
                background:"transparent", border:"none", outline:"none", color:"#e8e8e8",
                fontSize:14, fontWeight:600, fontFamily:"inherit", width:"100%"
              }}
            />
          </div>
          {selectedDate && (
            <span style={{ fontSize:11, color:"#555", background:"#1a1a1a", padding:"4px 10px", borderRadius:20 }}>
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" })}
            </span>
          )}
        </div>

        {/* People cards */}
        <div style={{ display:"flex", flexDirection:"column", gap: 12, marginBottom:16 }}>
          {people.map((p, i) => (
            <PersonCard key={p.id} person={p} index={i}
              onUpdate={patch => updatePerson(p.id, patch)}
              onRemove={() => removePerson(p.id)}
              canRemove={people.length > 1}
              selectedDate={selectedDate}
            />
          ))}
        </div>

        {/* Add person */}
        <button onClick={addPerson} style={{
          width:"100%", padding:"13px 0", borderRadius:14,
          border:"1.5px dashed #2a2a2a", background:"transparent",
          color:"#555", fontSize:13, fontWeight:600, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          transition:"all 0.15s", marginBottom:24, fontFamily:"inherit"
        }}
          onMouseOver={e=>{ e.currentTarget.style.borderColor="#e8b86d55"; e.currentTarget.style.color="#e8b86d88"; }}
          onMouseOut={e=>{ e.currentTarget.style.borderColor="#2a2a2a"; e.currentTarget.style.color="#555"; }}
        >
          <span style={{ fontSize:18, lineHeight:1 }}>+</span> Add person to group
        </button>

        {/* Availability grid */}
        <div style={{
          background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:16,
          padding:"18px 16px", marginBottom:24
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div>
              <p style={{ fontSize:12, fontWeight:700, color:"#e8e8e8" }}>Available Time Slots</p>
              <p style={{ fontSize:11, color:"#555", marginTop:2 }}>
                Showing slots where all {readyPeople.length > 0 ? readyPeople.length : "assigned"} tech{readyPeople.length !== 1 ? "s" : ""} {readyPeople.length !== 1 ? "are" : "is"} free
              </p>
            </div>
            {selectedTime && (
              <span style={{
                fontSize:13, fontWeight:700, color:"#e8b86d",
                background:"#e8b86d18", padding:"5px 12px", borderRadius:20,
                border:"1px solid #e8b86d44"
              }}>{selectedTime}</span>
            )}
          </div>
          <TimeSlotGrid people={people} selectedDate={selectedDate} selectedTime={selectedTime} onSelect={setSelectedTime} />
        </div>

        {/* Summary bar */}
        {readyPeople.length > 0 && (
          <div style={{
            background:"#0f0f0f", border:"1px solid #1e1e1e", borderRadius:14,
            padding:"12px 16px", marginBottom:16
          }}>
            <p style={{ fontSize:10, fontWeight:700, color:"#555", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Session summary</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {readyPeople.map((p,i) => {
                const tech = TECHS.find(t => t.id === p.techId);
                const svc = SERVICES.find(s => s.id === p.serviceId);
                return (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap:6, padding:"5px 10px",
                    background:"#111", border:"1px solid #222", borderRadius:20
                  }}>
                    <Avatar tech={tech} size={18} />
                    <span style={{ fontSize:11, color:"#aaa" }}>{p.name || `Client ${i+1}`}</span>
                    <span style={{ fontSize:10, color:"#555" }}>·</span>
                    <span style={{ fontSize:11, color: svc.color }}>{svc.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Book button */}
        <button disabled={!canBook} onClick={() => setShowConfirm(true)} style={{
          width:"100%", padding:"16px 0", borderRadius:14,
          background: canBook ? "linear-gradient(135deg,#e8b86d,#d4944a)" : "#111",
          border: canBook ? "none" : "1px solid #1e1e1e",
          color: canBook ? "#1a0e00" : "#333",
          fontWeight:800, fontSize:15, cursor: canBook ? "pointer" : "not-allowed",
          letterSpacing:0.3, transition:"all 0.2s", fontFamily:"inherit",
          boxShadow: canBook ? "0 8px 32px rgba(232,184,109,0.25)" : "none"
        }}>
          {canBook ? `Book ${readyPeople.length} Appointment${readyPeople.length > 1 ? "s" : ""} · ${selectedTime}` : "Select services, techs & time"}
        </button>

        <p style={{ textAlign:"center", fontSize:11, color:"#333", marginTop:12 }}>
          Batch Firestore write — all appointments in one transaction
        </p>
      </div>

      {showConfirm && (
        <ConfirmModal
          people={readyPeople} date={selectedDate} time={selectedTime}
          onConfirm={handleConfirm} onClose={handleClose}
          loading={loading} done={done}
        />
      )}
    </div>
  );
}
