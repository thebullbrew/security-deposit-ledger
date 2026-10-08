/* Security Deposit Ledger — local-first app logic */
"use strict";

const LS_KEY = "sdl_state_v1";

/* ---------------- utilities ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const fmtMoney = (n) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const daysBetween = (aISO, bISO) => {
  const a = new Date(aISO + "T12:00:00"), b = new Date(bISO + "T12:00:00");
  return Math.round((b - a) / 86400000);
};

const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------------- state ---------------- */
function demoState() {
  return {
    settings: { ratePct: 1.0, returnDays: 30, landlord: "", propertyAddress: "" },
    tenants: [
      {
        id: uid() + "1",
        name: "Elena Marsh",
        unit: "2B",
        deposit: 2400.00,
        received: "2025-03-01",
        escrow: "First National Escrow — x4821 (separate interest-bearing account)",
        notes: "Two cats approved. Lease renews Mar 2027.",
        moveOut: null,
        returned: null,
        deductions: []
      },
      {
        id: uid() + "2",
        name: "Marcus Webb",
        unit: "1A",
        deposit: 1800.00,
        received: "2024-06-15",
        escrow: "First National Escrow — x4790 (separate interest-bearing account)",
        notes: "",
        moveOut: "2026-09-15",
        returned: { date: "2026-10-08", amount: 1467.12 },
        deductions: [
          { id: "d1", label: "Cleaning", amount: 150.00, notes: "Whole-unit deep clean per turnover invoice" },
          { id: "d2", label: "Repairs", amount: 220.00, notes: "Drywall repair, living room (photos on file)" }
        ]
      }
    ]
  };
}

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tenants) && parsed.settings) return parsed;
    }
  } catch (e) { /* fall through to demo */ }
  const demo = demoState();
  // backfill interest on the returned demo tenant so the ledger is coherent
  const t = demo.tenants[1];
  t.returned.interest = round2(interestAccrued(t, demo.settings.ratePct));
  t.returned.amount = round2(t.deposit + t.returned.interest - dedTotal(t));
  persist(demo);
  return demo;
}

function persist(state) {
  S = state || S;
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
}

const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- domain logic ---------------- */
function interestAccrued(t, ratePct) {
  const endISO = t.moveOut || todayISO();
  const days = Math.max(0, daysBetween(t.received, endISO));
  return t.deposit * (ratePct / 100) * (days / 365);
}

function dedTotal(t) {
  return (t.deductions || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
}

function refundDue(t) {
  return t.deposit + interestAccrued(t, S.settings.ratePct) - dedTotal(t);
}

function tenantStatus(t) {
  if (t.returned) return "returned";
  if (t.moveOut) return "partial";   // moved out, deposit not yet returned
  return "held";
}

function statusChip(status) {
  const map = { held: "Held", partial: "Move-out pending", returned: "Returned" };
  return `<span class="chip ${status}">${map[status]}</span>`;
}

function deadlineInfo(t) {
  // returns {dueISO, daysLeft} or null
  if (!t.moveOut || t.returned) return null;
  const dueISO = addDays(t.moveOut, S.settings.returnDays);
  return { dueISO, daysLeft: daysBetween(todayISO(), dueISO) };
}

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("view-" + btn.dataset.view).classList.add("active");
    if (btn.dataset.view === "moveout") renderMoveOut();
    if (btn.dataset.view === "dashboard") renderDashboard();
    if (btn.dataset.view === "tenants") renderTenants();
    if (btn.dataset.view === "settings") renderSettings();
  });
});

function gotoView(name) {
  document.querySelector(`.tab[data-view="${name}"]`).click();
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const held = S.tenants.filter((t) => !t.returned);
  const totalHeld = held.reduce((s, t) => s + t.deposit, 0);
  const totalInterest = held.reduce((s, t) => s + interestAccrued(t, S.settings.ratePct), 0);

  const deadlines = S.tenants.map((t) => ({ t, d: deadlineInfo(t) })).filter((x) => x.d);
  const urgent = deadlines.filter((x) => x.d.daysLeft <= 7).length;

  $("dash-stats").innerHTML = `
    <div class="stat-card">
      <div class="label">Deposits held</div>
      <div class="value">${fmtMoney(totalHeld)}</div>
      <div class="sub">${held.length} active ${held.length === 1 ? "tenancy" : "tenancies"}</div>
    </div>
    <div class="stat-card">
      <div class="label">Interest accrued</div>
      <div class="value">${fmtMoney(totalInterest)}</div>
      <div class="sub">at ${S.settings.ratePct}% annual</div>
    </div>
    <div class="stat-card">
      <div class="label">Return deadlines</div>
      <div class="value">${deadlines.length}</div>
      <div class="sub">${urgent} due within 7 days</div>
    </div>
    <div class="stat-card">
      <div class="label">Returned to date</div>
      <div class="value">${S.tenants.filter((t) => t.returned).length}</div>
      <div class="sub">deposits closed out</div>
    </div>`;

  const dl = $("dash-deadlines");
  if (!deadlines.length) {
    dl.innerHTML = `<div class="empty">No pending return deadlines. Every deposit is either held or closed out.</div>`;
  } else {
    deadlines.sort((a, b) => a.d.daysLeft - b.d.daysLeft);
    dl.innerHTML = deadlines.map(({ t, d }) => {
      const cls = d.daysLeft < 0 ? "red" : d.daysLeft <= 7 ? "amber" : "";
      const when = d.daysLeft < 0
        ? `${Math.abs(d.daysLeft)} days OVERDUE`
        : d.daysLeft === 0 ? "Due TODAY"
        : `${d.daysLeft} days left`;
      return `<div class="deadline ${cls}" data-tid="${t.id}">
        <div><div class="d-name">${esc(t.name)} <span style="color:var(--ivory-dim)">· Unit ${esc(t.unit)}</span></div>
        <div class="d-when">${when} — due ${fmtDate(d.dueISO)} · refund due ${fmtMoney(refundDue(t))}</div></div>
        ${statusChip(tenantStatus(t))}
      </div>`;
    }).join("");
    dl.querySelectorAll(".deadline").forEach((el) =>
      el.addEventListener("click", () => openMoveOut(el.dataset.tid)));
  }

  const tl = $("dash-tenants");
  if (!S.tenants.length) {
    tl.innerHTML = `<div class="empty">No tenants yet. Add your first deposit under Tenants.</div>`;
  } else {
    tl.innerHTML = S.tenants.map((t) => `
      <div class="tenant-row" data-tid="${t.id}">
        <div class="avatar">${esc(t.name.trim().charAt(0).toUpperCase() || "?")}</div>
        <div class="who">
          <div class="name">${esc(t.name)}</div>
          <div class="meta">Unit ${esc(t.unit)} · received ${fmtDate(t.received)}${t.moveOut ? " · moved out " + fmtDate(t.moveOut) : ""}</div>
        </div>
        <div class="money">
          <div><div class="amt">${fmtMoney(t.deposit)}</div><div class="lbl">deposit</div></div>
          <div style="margin-top:0.3rem">${statusChip(tenantStatus(t))}</div>
        </div>
      </div>`).join("");
    tl.querySelectorAll(".tenant-row").forEach((el) =>
      el.addEventListener("click", () => showTenantDetail(el.dataset.tid)));
  }
}

/* ---------------- tenants ---------------- */
let editingId = null;
let detailId = null;

function renderTenants() {
  renderTenantList();
  if (detailId) showTenantDetail(detailId, true);
  else $("tenant-detail").innerHTML = "";
}

function renderTenantList() {
  const list = $("tenant-list");
  if (!S.tenants.length) {
    list.innerHTML = `<div class="empty">No tenants on the ledger yet.</div>`;
    return;
  }
  list.innerHTML = S.tenants.map((t) => `
    <div class="tenant-row" data-tid="${t.id}">
      <div class="avatar">${esc(t.name.trim().charAt(0).toUpperCase() || "?")}</div>
      <div class="who">
        <div class="name">${esc(t.name)}</div>
        <div class="meta">Unit ${esc(t.unit)} · ${fmtMoney(t.deposit)} · received ${fmtDate(t.received)}</div>
      </div>
      <div class="money">
        <div><div class="amt">${fmtMoney(interestAccrued(t, S.settings.ratePct))}</div><div class="lbl">interest</div></div>
        <div style="margin-top:0.3rem">${statusChip(tenantStatus(t))}</div>
      </div>
    </div>`).join("");
  list.querySelectorAll(".tenant-row").forEach((el) =>
    el.addEventListener("click", () => showTenantDetail(el.dataset.tid)));
}

function showTenantDetail(tid, keepScroll) {
  const t = S.tenants.find((x) => x.id === tid);
  if (!t) return;
  detailId = tid;
  const st = tenantStatus(t);
  const interest = interestAccrued(t, S.settings.ratePct);
  const dInfo = deadlineInfo(t);
  const box = $("tenant-detail");
  box.innerHTML = `
    <div class="card" style="border-color:var(--gold)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem">
        <h3 style="margin:0">${esc(t.name)} <span style="color:var(--ivory-dim);font-size:1rem">· Unit ${esc(t.unit)}</span></h3>
        ${statusChip(st)}
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="k">Deposit</div><div class="v">${fmtMoney(t.deposit)}</div></div>
        <div class="detail-item"><div class="k">Interest accrued</div><div class="v">${fmtMoney(interest)}</div></div>
        <div class="detail-item"><div class="k">Deductions</div><div class="v">${fmtMoney(dedTotal(t))}</div></div>
        <div class="detail-item"><div class="k">Refund due</div><div class="v" style="color:var(--gold-bright)">${fmtMoney(refundDue(t))}</div></div>
        <div class="detail-item"><div class="k">Received</div><div class="v" style="font-size:1.05rem">${fmtDate(t.received)}</div></div>
        <div class="detail-item"><div class="k">Move-out</div><div class="v" style="font-size:1.05rem">${fmtDate(t.moveOut)}</div></div>
      </div>
      <div style="font-size:0.9rem;color:var(--ivory-dim);margin-bottom:0.4rem"><strong style="color:var(--ivory)">Escrow:</strong> ${esc(t.escrow) || "—"}</div>
      ${t.notes ? `<div style="font-size:0.9rem;color:var(--ivory-dim)"><strong style="color:var(--ivory)">Notes:</strong> ${esc(t.notes)}</div>` : ""}
      ${t.returned ? `<div class="notice" style="margin-bottom:0"><strong>Returned</strong> ${fmtDate(t.returned.date)} — ${fmtMoney(t.returned.amount)} (incl. ${fmtMoney(t.returned.interest || 0)} interest).</div>` : ""}
      ${dInfo ? `<div class="notice" style="margin-bottom:0"><strong>Return deadline:</strong> ${fmtDate(dInfo.dueISO)} (${dInfo.daysLeft < 0 ? Math.abs(dInfo.daysLeft) + " days overdue" : dInfo.daysLeft + " days left"}).</div>` : ""}
      <div class="btn-row">
        <button class="btn btn-ghost" id="btn-edit-t">Edit</button>
        ${!t.moveOut ? `<button class="btn btn-ghost" id="btn-mo-t">Record Move-Out</button>` : ""}
        ${t.moveOut && !t.returned ? `<button class="btn btn-primary" id="btn-finish-t">Finish in Move-Out</button>` : ""}
        <button class="btn btn-danger" id="btn-del-t">Delete</button>
      </div>
    </div>`;
  $("btn-edit-t").addEventListener("click", () => openTenantModal(tid));
  const moBtn = $("btn-mo-t");
  if (moBtn) moBtn.addEventListener("click", () => {
    const d = prompt("Move-out date (YYYY-MM-DD):", todayISO());
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      t.moveOut = d; t.deductions = t.deductions || [];
      persist(); renderTenants(); renderDashboard();
      toast("Move-out recorded. Finish deductions under Move-Out.");
    }
  });
  const finBtn = $("btn-finish-t");
  if (finBtn) finBtn.addEventListener("click", () => openMoveOut(tid));
  $("btn-del-t").addEventListener("click", () => {
    if (confirm(`Delete ${t.name}'s record? This cannot be undone.`)) {
      S.tenants = S.tenants.filter((x) => x.id !== tid);
      detailId = null; persist(); renderTenants(); renderDashboard();
      toast("Record deleted.");
    }
  });
  if (!keepScroll) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openTenantModal(tid) {
  editingId = tid || null;
  $("tenant-modal-title").textContent = tid ? "Edit Tenant" : "Add Tenant";
  const t = tid ? S.tenants.find((x) => x.id === tid) : null;
  $("t-name").value = t ? t.name : "";
  $("t-unit").value = t ? t.unit : "";
  $("t-amount").value = t ? t.deposit : "";
  $("t-received").value = t ? t.received : todayISO();
  $("t-escrow").value = t ? t.escrow : "";
  $("t-notes").value = t ? (t.notes || "") : "";
  $("tenant-modal").classList.add("open");
}

$("btn-add-tenant").addEventListener("click", () => openTenantModal(null));
$("btn-cancel-tenant").addEventListener("click", () => $("tenant-modal").classList.remove("open"));
$("tenant-modal").addEventListener("click", (e) => {
  if (e.target.id === "tenant-modal") $("tenant-modal").classList.remove("open");
});

$("btn-save-tenant").addEventListener("click", () => {
  const name = $("t-name").value.trim();
  const amount = parseFloat($("t-amount").value);
  if (!name) return toast("Tenant name is required.");
  if (!(amount > 0)) return toast("Enter a deposit amount greater than zero.");
  const data = {
    name,
    unit: $("t-unit").value.trim(),
    deposit: round2(amount),
    received: $("t-received").value || todayISO(),
    escrow: $("t-escrow").value.trim(),
    notes: $("t-notes").value.trim()
  };
  if (editingId) {
    Object.assign(S.tenants.find((x) => x.id === editingId), data);
    toast("Tenant updated.");
  } else {
    S.tenants.push(Object.assign({ id: uid(), moveOut: null, returned: null, deductions: [] }, data));
    toast("Tenant added to the ledger.");
  }
  $("tenant-modal").classList.remove("open");
  persist(); renderTenants(); renderDashboard();
});

/* ---------------- move-out ---------------- */
let moTenantId = null;

function openMoveOut(tid) {
  gotoView("moveout");
  if (tid) { moTenantId = tid; $("mo-tenant").value = tid; }
  renderMoveOut();
}

function renderMoveOut() {
  const sel = $("mo-tenant");
  const eligible = S.tenants.filter((t) => !t.returned);
  sel.innerHTML = eligible.length
    ? eligible.map((t) => `<option value="${t.id}">${esc(t.name)} · Unit ${esc(t.unit)}</option>`).join("")
    : `<option value="">No open tenancies</option>`;
  if (moTenantId && eligible.some((t) => t.id === moTenantId)) sel.value = moTenantId;
  else if (eligible.length) moTenantId = eligible[0].id;
  else moTenantId = null;

  const t = S.tenants.find((x) => x.id === moTenantId);
  if (!t) {
    $("mo-deadline-box").innerHTML = "";
    $("ded-card").style.display = "none";
    $("letter-card").style.display = "none";
    $("letter-preview").innerHTML = "";
    return;
  }
  if (!t.moveOut) $("mo-date").value = todayISO();
  else $("mo-date").value = t.moveOut;

  // deadline box
  const box = $("mo-deadline-box");
  const d = deadlineInfo(t);
  if (!t.moveOut) {
    box.innerHTML = `<div class="notice">Set the move-out date to start the <strong>${S.settings.returnDays}-day</strong> return clock.</div>`;
  } else {
    const cls = d.daysLeft < 0 ? "red" : d.daysLeft <= 7 ? "amber" : "";
    const when = d.daysLeft < 0 ? `<strong style="color:#e08a78">${Math.abs(d.daysLeft)} days OVERDUE</strong>`
      : d.daysLeft === 0 ? `<strong style="color:#e8c877">Due TODAY</strong>`
      : `<strong>${d.daysLeft} days left</strong>`;
    box.innerHTML = `<div class="notice ${cls}" style="margin-bottom:0">
      Moved out <strong>${fmtDate(t.moveOut)}</strong> — deposit of ${fmtMoney(refundDue(t))} due back by
      <strong>${fmtDate(d.dueISO)}</strong>. ${when}.</div>`;
  }

  // deductions card
  $("ded-card").style.display = "block";
  renderDeductions(t);
  $("letter-card").style.display = "block";
  if (!$("lt-landlord").value) $("lt-landlord").value = S.settings.landlord || "";
  if (!$("lt-address").value) $("lt-address").value = S.settings.propertyAddress || "";
}

$("mo-tenant").addEventListener("change", (e) => { moTenantId = e.target.value; renderMoveOut(); });

$("btn-set-moveout").addEventListener("click", () => {
  const t = S.tenants.find((x) => x.id === moTenantId);
  if (!t) return;
  const d = $("mo-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast("Pick a valid move-out date.");
  t.moveOut = d; t.deductions = t.deductions || [];
  persist(); renderMoveOut(); renderDashboard();
  toast("Move-out date set. The return clock is running.");
});

const DED_PRESETS = ["Cleaning", "Repairs", "Unpaid rent", "Trash removal", "Re-keying", "Landscaping", "Other"];

function renderDeductions(t) {
  const list = $("ded-list");
  t.deductions = t.deductions || [];
  if (!t.deductions.length) {
    list.innerHTML = `<div class="empty" style="padding:1.2rem">No deductions — the full deposit goes back. Add line items only for real, documented costs.</div>`;
  } else {
    list.innerHTML = t.deductions.map((dd) => `
      <div class="ded-row" data-did="${dd.id}">
        <div class="field">
          <label>Description</label>
          <input type="text" class="ded-label" value="${esc(dd.label)}" list="ded-presets" placeholder="e.g. Cleaning">
        </div>
        <div class="field">
          <label>Amount ($)</label>
          <input type="number" class="ded-amount" step="0.01" min="0" value="${dd.amount}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn btn-danger ded-del" style="padding:0.55rem 0.7rem">✕</button>
        </div>
        <div class="field" style="grid-column:1/-1">
          <input type="text" class="ded-notes" value="${esc(dd.notes || "")}" placeholder="Notes / invoice reference (optional)">
        </div>
      </div>
      <datalist id="ded-presets">${DED_PRESETS.map((p) => `<option value="${p}">`).join("")}</datalist>
    `).join("");
    list.querySelectorAll(".ded-row").forEach((row) => {
      const did = row.dataset.did;
      const dd = t.deductions.find((x) => x.id === did);
      row.querySelector(".ded-label").addEventListener("input", (e) => { dd.label = e.target.value; persist(); });
      row.querySelector(".ded-notes").addEventListener("input", (e) => { dd.notes = e.target.value; persist(); });
      row.querySelector(".ded-amount").addEventListener("input", (e) => {
        dd.amount = round2(parseFloat(e.target.value) || 0);
        persist(); updateSettlement(t);
      });
      row.querySelector(".ded-del").addEventListener("click", () => {
        t.deductions = t.deductions.filter((x) => x.id !== did);
        persist(); renderDeductions(t);
      });
    });
  }
  updateSettlement(t);
}

$("btn-add-ded").addEventListener("click", () => {
  const t = S.tenants.find((x) => x.id === moTenantId);
  if (!t) return;
  if (!t.moveOut) return toast("Set the move-out date first.");
  t.deductions.push({ id: uid(), label: "", amount: 0, notes: "" });
  persist(); renderDeductions(t);
});

function updateSettlement(t) {
  const interest = interestAccrued(t, S.settings.ratePct);
  const deds = dedTotal(t);
  const refund = t.deposit + interest - deds;
  $("ded-total-amt").textContent = fmtMoney(deds);
  $("settlement").innerHTML = `
    <div class="s-row"><span>Deposit held</span><span>${fmtMoney(t.deposit)}</span></div>
    <div class="s-row"><span>Interest accrued (${S.settings.ratePct}%)</span><span>+ ${fmtMoney(interest)}</span></div>
    <div class="s-row"><span>Deductions</span><span>− ${fmtMoney(deds)}</span></div>
    <div class="s-row grand"><span>Refund due</span><span>${fmtMoney(refund)}</span></div>`;
  return { interest, deds, refund };
}

/* ---------------- letter ---------------- */
$("btn-preview-letter").addEventListener("click", () => {
  const t = S.tenants.find((x) => x.id === moTenantId);
  if (!t) return;
  if (!t.moveOut) return toast("Set the move-out date first.");
  const landlord = $("lt-landlord").value.trim();
  const address = $("lt-address").value.trim();
  S.settings.landlord = landlord;
  S.settings.propertyAddress = address;
  persist();

  const interest = round2(interestAccrued(t, S.settings.ratePct));
  const deds = t.deductions || [];
  const dedTotalAmt = round2(deds.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0));
  const refund = round2(t.deposit + interest - dedTotalAmt);
  const d = deadlineInfo(t);

  const dedRows = deds.length
    ? deds.map((dd, i) => `<tr><td>${i + 1}. ${esc(dd.label || "Deduction")}${dd.notes ? `<br><span style="font-size:0.85em;color:#555">${esc(dd.notes)}</span>` : ""}</td><td class="num">${fmtMoney(dd.amount)}</td></tr>`).join("")
    : `<tr><td colspan="2" style="text-align:center;font-style:italic">No deductions — full deposit returned.</td></tr>`;

  $("letter-preview").innerHTML = `
    <div class="letter" id="print-letter">
      <h2>Security Deposit Statement</h2>
      <p><strong>From:</strong> ${esc(landlord) || "[Landlord name]"}<br>
      <strong>Property:</strong> ${esc(address) || "[Property address]"}</p>
      <p><strong>To:</strong> ${esc(t.name)}<br>
      <strong>Unit:</strong> ${esc(t.unit)}<br>
      <strong>Date:</strong> ${fmtDate(todayISO())}</p>
      <p>Dear ${esc(t.name)},</p>
      <p>Following your move-out on <strong>${fmtDate(t.moveOut)}</strong>, here is the itemized
      accounting of your security deposit of <strong>${fmtMoney(t.deposit)}</strong>, received
      ${fmtDate(t.received)} and held in ${esc(t.escrow) || "a separate interest-bearing escrow account"}.</p>
      <table>
        <tr><th>Deduction</th><th class="num">Amount</th></tr>
        ${dedRows}
        <tr><td style="text-align:right"><strong>Total deductions</strong></td><td class="num"><strong>${fmtMoney(dedTotalAmt)}</strong></td></tr>
      </table>
      <table>
        <tr><td>Security deposit</td><td class="num">${fmtMoney(t.deposit)}</td></tr>
        <tr><td>Interest accrued (${S.settings.ratePct}% annual)</td><td class="num">+ ${fmtMoney(interest)}</td></tr>
        <tr><td>Less deductions</td><td class="num">− ${fmtMoney(dedTotalAmt)}</td></tr>
        <tr><td><strong>Refund enclosed / sent</strong></td><td class="num"><strong>${fmtMoney(refund)}</strong></td></tr>
      </table>
      <p>Please direct any questions about this statement to the landlord at the address above
      within the time allowed by your state's law.</p>
      <div class="sig">Sincerely,
        <div class="sig-line">${esc(landlord) || "Landlord signature"} · Date</div>
      </div>
    </div>`;
  $("btn-print-letter").style.display = "";
  $("btn-mark-returned").style.display = "";
  $("letter-preview").scrollIntoView({ behavior: "smooth" });
});

$("btn-print-letter").addEventListener("click", () => window.print());

$("btn-mark-returned").addEventListener("click", () => {
  const t = S.tenants.find((x) => x.id === moTenantId);
  if (!t || !t.moveOut) return;
  const refund = round2(refundDue(t));
  const interest = round2(interestAccrued(t, S.settings.ratePct));
  if (!confirm(`Mark ${fmtMoney(refund)} as returned to ${t.name}?`)) return;
  t.returned = { date: todayISO(), amount: refund, interest };
  persist();
  renderMoveOut(); renderDashboard(); renderTenants();
  $("btn-mark-returned").style.display = "none";
  toast("Deposit marked returned. Ledger updated.");
});

/* ---------------- settings ---------------- */
function renderSettings() {
  $("set-rate").value = S.settings.ratePct;
  $("set-days").value = S.settings.returnDays;
}

$("btn-save-settings").addEventListener("click", () => {
  const rate = parseFloat($("set-rate").value);
  const days = parseInt($("set-days").value, 10);
  if (!(rate >= 0 && rate <= 25)) return toast("Enter a rate between 0 and 25%.");
  if (!(days >= 1 && days <= 120)) return toast("Enter 1–120 days.");
  S.settings.ratePct = round2(rate);
  S.settings.returnDays = days;
  persist(); renderDashboard();
  toast("Settings saved.");
});

$("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "security-deposit-ledger-" + todayISO() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Ledger exported.");
});

$("btn-import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data || !Array.isArray(data.tenants) || !data.settings) throw new Error("bad file");
      persist(data);
      detailId = null;
      renderDashboard(); renderTenants(); renderSettings();
      toast("Ledger imported.");
    } catch (err) { toast("That file is not a valid ledger export."); }
  };
  r.readAsText(f);
  e.target.value = "";
});

$("btn-reset").addEventListener("click", () => {
  if (!confirm("Reset to the demo data? Your current ledger will be replaced.")) return;
  localStorage.removeItem(LS_KEY);
  S = load();
  detailId = null;
  renderDashboard(); renderTenants(); renderSettings(); renderMoveOut();
  toast("Demo data restored.");
});

/* ---------------- init ---------------- */
renderDashboard();
renderTenants();
renderSettings();
