// ============================================================
// THURAYA REPORTS V2 — ENTERPRISE FILTER UI PATCH
// UI upgrade only (NO LOGIC CHANGES)
// ============================================================

console.log("✅ Reports V2 Enterprise UI loaded");

(function () {

    function injectEnterpriseStyles() {
        if (document.getElementById("rptv2EnterpriseStyles")) return;

        const style = document.createElement("style");
        style.id = "rptv2EnterpriseStyles";

        style.innerHTML = `
        /* ===== FILTER BAR ===== */
        .rptv2-filter-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
            align-items: flex-end;
            background: #fff;
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 16px;
        }

        .rptv2-filter-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 160px;
        }

        .rptv2-filter-item label {
            font-size: 0.75rem;
            font-weight: 700;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        /* ===== SEGMENTED RANGE ===== */
        .rptv2-range-group {
            display: inline-flex;
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
        }

        .rptv2-range-btn {
            border: none;
            padding: 8px 14px;
            font-size: 0.75rem;
            font-weight: 800;
            letter-spacing: 0.05em;
            cursor: pointer;
            background: transparent;
            color: var(--primary);
            transition: all 0.15s ease;
        }

        .rptv2-range-btn:not(:last-child) {
            border-right: 1px solid var(--border);
        }

        .rptv2-range-btn:hover {
            background: #f5f7fa;
        }

        .rptv2-range-btn.active {
            background: var(--primary);
            color: #fff;
        }
        `;

        document.head.appendChild(style);
    }

    function setRangeUI(type) {
        rptv2_setRange(type);

        document.querySelectorAll(".rptv2-range-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.range === type);
        });
    }

    function upgradeFilterUI() {
        const container = document.querySelector(".grid-3");
        if (!container) return;

        const items = Array.from(container.children);

        const wrapper = document.createElement("div");
        wrapper.className = "rptv2-filter-bar";

        items.forEach(el => {
            const box = document.createElement("div");
            box.className = "rptv2-filter-item";
            box.appendChild(el);
            wrapper.appendChild(box);
        });

        container.replaceWith(wrapper);

        // Upgrade Quick Range buttons
        const quickRange = document.querySelector("label + div");
        if (quickRange && quickRange.querySelector("button")) {
            quickRange.className = "rptv2-range-group";

            quickRange.innerHTML = `
                <button class="rptv2-range-btn" data-range="today">Today</button>
                <button class="rptv2-range-btn" data-range="week">Week</button>
                <button class="rptv2-range-btn" data-range="month">Month</button>
            `;

            quickRange.querySelectorAll("button").forEach(btn => {
                btn.onclick = () => setRangeUI(btn.dataset.range);
            });
        }

        // Set default active
        setTimeout(() => setRangeUI("week"), 50);
    }

    function initEnterpriseUI() {
        injectEnterpriseStyles();
        setTimeout(upgradeFilterUI, 200);
    }

    // Hook into your existing Reports init
    const oldInit = window.rpt_init;

    window.rpt_init = function () {
        if (oldInit) oldInit();
        initEnterpriseUI();
    };

})();