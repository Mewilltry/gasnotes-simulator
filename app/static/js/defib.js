// DEFIBRILLATOR MODE
//
// Monitor-local only: nothing here is sent to the sim controller. A shock
// just blanks the local ECG for ~1.5 s so the person running the controller
// can pick the post-shock rhythm and send it as usual.

import { audioIsRunning } from "./audio.js";

const ENERGY_STEPS = [10, 20, 30, 50, 70, 100, 120, 150, 200, 300, 360];
const CHARGE_MS = 4000; // nominal charge time (scaled a little by energy)
const READY_TIMEOUT_MS = 60000; // auto-disarm if a charge is left unused
const FLATLINE_MS = 3000; // ECG blank after a shock (time for the controller
//                           operator to choose the post-shock rhythm)
const SYNC_HOLD_MS = 2000; // in SYNC mode the shock button must be held this long

const els = {
    toggle: document.getElementById("defib-toggle"),
    panel: document.getElementById("defib-panel"),
    timer: document.getElementById("defib-timer"),
    energyValue: document.getElementById("defib-energy-value"),
    energyUp: document.getElementById("defib-energy-up"),
    energyDown: document.getElementById("defib-energy-down"),
    sync: document.getElementById("defib-sync"),
    syncLabel: document.getElementById("defib-sync-label"),
    charge: document.getElementById("defib-charge"),
    shock: document.getElementById("defib-shock"),
    shockText: document.getElementById("defib-shock-text"),
    progressWrap: document.getElementById("defib-progress"),
    progressBar: document.getElementById("defib-progress-bar"),
    status: document.getElementById("defib-status"),
    shockCount: document.getElementById("defib-shock-count"),
};

if (els.toggle && els.panel) {
    initDefib();
}

function initDefib() {
    const ecg = document.getElementById("ecg");

    let energyIndex = ENERGY_STEPS.indexOf(200);
    if (energyIndex < 0) energyIndex = ENERGY_STEPS.length - 1;

    let state = "idle"; // idle | charging | armed
    let shocksDelivered = 0;
    let chargeTimer = null;
    let readyTimer = null;
    let modeTimerInterval = null;
    let modeStartTime = 0;
    let chargeSound = null;
    let readySound = null;

    const energy = () => ENERGY_STEPS[energyIndex];

    function renderEnergy() {
        els.energyValue.textContent = energy();
        els.energyUp.disabled = energyIndex >= ENERGY_STEPS.length - 1;
        els.energyDown.disabled = energyIndex <= 0;
        if (state === "armed") setStatusText();
    }

    function setStatusText() {
        if (state === "idle") els.status.textContent = "Disarmed";
        else if (state === "charging") els.status.textContent = "Charging …";
        else if (state === "armed") {
            els.status.textContent =
                (els.sync.checked
                    ? "SYNC · hold to shock · "
                    : "") +
                energy() +
                "J — PUSH SHOCK";
        }
    }

    function renderShockButton() {
        els.shockText.textContent =
            state === "armed" && els.sync.checked ? "Hold to Shock" : "Shock";
    }

    function setState(next) {
        state = next;
        els.panel.dataset.defibState = next;
        cancelShockHold();
        setStatusText();
        renderShockButton();
        if (next === "idle") {
            els.shock.disabled = true;
            els.charge.textContent = "Charge";
            els.progressWrap.hidden = true;
        } else if (next === "charging") {
            els.shock.disabled = true;
            els.charge.textContent = "Cancel";
            els.progressWrap.hidden = false;
        } else if (next === "armed") {
            els.shock.disabled = false;
            els.charge.textContent = "Disarm";
            els.progressWrap.hidden = true;
        }
    }

    // --- elapsed-time clock (counts up from when Defib mode is switched on) ---
    function renderModeTimer() {
        let secs = Math.floor((Date.now() - modeStartTime) / 1000);
        secs = Math.max(0, Math.min(secs, 99 * 60 + 59));
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        els.timer.textContent =
            "+" +
            String(m).padStart(2, "0") +
            ":" +
            String(s).padStart(2, "0");
    }
    function startModeTimer() {
        modeStartTime = Date.now();
        renderModeTimer();
        clearInterval(modeTimerInterval);
        modeTimerInterval = setInterval(renderModeTimer, 1000);
    }
    function stopModeTimer() {
        clearInterval(modeTimerInterval);
        modeTimerInterval = null;
        els.timer.textContent = "+00:00";
    }

    // --- charging ---
    function beginCharge() {
        setState("charging");
        const dur =
            CHARGE_MS *
            (0.6 + 0.4 * (energyIndex / (ENERGY_STEPS.length - 1)));

        els.progressBar.style.transition = "none";
        els.progressBar.style.width = "0%";
        void els.progressBar.offsetWidth; // reflow so the animation restarts
        els.progressBar.style.transition = "width " + dur + "ms linear";
        els.progressBar.style.width = "100%";

        startChargeSound(dur);

        clearTimeout(chargeTimer);
        chargeTimer = setTimeout(() => {
            stopChargeSound();
            startReadySound();
            setState("armed");
            clearTimeout(readyTimer);
            readyTimer = setTimeout(disarm, READY_TIMEOUT_MS);
        }, dur);
    }

    function disarm() {
        clearTimeout(chargeTimer);
        clearTimeout(readyTimer);
        stopChargeSound();
        stopReadySound();
        els.progressBar.style.transition = "none";
        els.progressBar.style.width = "0%";
        setState("idle");
    }

    // --- shock delivery ---
    function deliverShock() {
        if (state !== "armed") return;
        shocksDelivered += 1;
        els.shockCount.textContent =
            shocksDelivered === 1
                ? "1 shock delivered"
                : shocksDelivered + " shocks delivered";
        stopReadySound();
        playShockSound();
        flatlineEcg(FLATLINE_MS);
        disarm();
    }

    // In SYNC mode the shock button must be held for SYNC_HOLD_MS; a normal
    // tap does nothing. Without SYNC a tap delivers immediately.
    let shockHoldTimer = null;

    function cancelShockHold() {
        clearTimeout(shockHoldTimer);
        shockHoldTimer = null;
        delete els.panel.dataset.shockHolding;
    }

    function beginShockHold() {
        if (state !== "armed" || !els.sync.checked) return;
        cancelShockHold();
        els.panel.dataset.shockHolding = "true";
        shockHoldTimer = setTimeout(() => {
            cancelShockHold();
            deliverShock();
        }, SYNC_HOLD_MS);
    }

    function handleShockClick() {
        if (state !== "armed") return;
        if (els.sync.checked) return; // SYNC: only the timed hold delivers
        deliverShock();
    }

    // --- ECG flatline (purely a local visual; the renderer's own
    //     "flatline" morphology is borrowed for ~1.5 s) ---
    let flatlineActive = false;
    let savedMorphology = null;
    let morphObserver = null;
    let flatlineTimer = null;

    function flatlineEcg(ms) {
        if (!ecg) return;
        if (!flatlineActive) {
            savedMorphology = ecg.getAttribute("morphology") || "sinus";
            // A rhythm the controller sends during the blank is remembered
            // and applied when the blank ends, but the trace stays flat for
            // the full duration.
            morphObserver = new MutationObserver(() => {
                const v = ecg.getAttribute("morphology");
                if (v && v !== "flatline") {
                    savedMorphology = v;
                    ecg.setAttribute("morphology", "flatline");
                }
            });
            morphObserver.observe(ecg, {
                attributes: true,
                attributeFilter: ["morphology"],
            });
        }
        flatlineActive = true;
        ecg.setAttribute("morphology", "flatline");
        try {
            ecg.forceNewline();
        } catch (e) {}

        clearTimeout(flatlineTimer);
        flatlineTimer = setTimeout(() => {
            flatlineActive = false;
            if (morphObserver) {
                morphObserver.disconnect();
                morphObserver = null;
            }
            ecg.setAttribute("morphology", savedMorphology || "sinus");
            try {
                ecg.forceNewline();
            } catch (e) {}
        }, ms);
    }

    // --- sound (Web Audio synthesis through the shared bus) ---
    const actx = () => window.simAudioControlObjects?.audioContext;
    const bus = () => window.simAudioControlObjects?.commonGainNode;

    function startChargeSound(durMs) {
        stopChargeSound();
        if (!audioIsRunning()) return;
        const ctx = actx();
        if (!ctx || !bus()) return;
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g).connect(bus());
        const t0 = ctx.currentTime;
        // rising whine that ends on the "ready" pitch so the two blend
        osc.frequency.setValueAtTime(220, t0);
        osc.frequency.exponentialRampToValueAtTime(
            2000,
            t0 + Math.max(0.2, durMs / 1000),
        );
        g.gain.linearRampToValueAtTime(0.42, t0 + 0.06);
        osc.start(t0);
        chargeSound = { oscs: [osc], g };
    }
    function stopChargeSound() {
        if (!chargeSound) return;
        try {
            const t = actx().currentTime;
            chargeSound.g.gain.cancelScheduledValues(t);
            chargeSound.g.gain.setValueAtTime(chargeSound.g.gain.value, t);
            chargeSound.g.gain.linearRampToValueAtTime(0, t + 0.05);
            chargeSound.oscs.forEach((o) => o.stop(t + 0.07));
        } catch (e) {}
        chargeSound = null;
    }

    // Sustained "charge ready / push shock" alarm: a loud, steady ~2 kHz
    // tone with a bright octave on top, held until shock/disarm/timeout.
    function startReadySound() {
        stopReadySound();
        if (!audioIsRunning()) return;
        const ctx = actx();
        if (!ctx || !bus()) return;
        const t0 = ctx.currentTime;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.6, t0 + 0.015);
        g.connect(bus());

        const body = ctx.createOscillator();
        body.type = "sine";
        body.frequency.value = 2000;
        const bodyGain = ctx.createGain();
        bodyGain.gain.value = 0.75;
        body.connect(bodyGain).connect(g);

        const edge = ctx.createOscillator();
        edge.type = "sawtooth";
        edge.frequency.value = 2000;
        const edgeGain = ctx.createGain();
        edgeGain.gain.value = 0.3;
        edge.connect(edgeGain).connect(g);

        const shimmer = ctx.createOscillator();
        shimmer.type = "sine";
        shimmer.frequency.value = 4000;
        const shimmerGain = ctx.createGain();
        shimmerGain.gain.value = 0.12;
        shimmer.connect(shimmerGain).connect(g);

        body.start(t0);
        edge.start(t0);
        shimmer.start(t0);
        readySound = { oscs: [body, edge, shimmer], g };
    }
    function stopReadySound() {
        if (!readySound) return;
        try {
            const t = actx().currentTime;
            readySound.g.gain.cancelScheduledValues(t);
            readySound.g.gain.setValueAtTime(readySound.g.gain.value, t);
            readySound.g.gain.linearRampToValueAtTime(0, t + 0.04);
            readySound.oscs.forEach((o) => o.stop(t + 0.06));
        } catch (e) {}
        readySound = null;
    }

    function playShockSound() {
        if (!audioIsRunning()) return;
        const ctx = actx();
        if (!ctx || !bus()) return;
        const t0 = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, t0);
        osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.7, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
        osc.connect(g).connect(bus());
        osc.start(t0);
        osc.stop(t0 + 0.32);
    }

    // --- wiring ---
    els.toggle.addEventListener("change", () => {
        if (els.toggle.checked) {
            startModeTimer();
        } else {
            disarm();
            stopModeTimer();
            shocksDelivered = 0;
            els.shockCount.textContent = "";
        }
    });

    els.energyUp.addEventListener("click", () => {
        if (energyIndex < ENERGY_STEPS.length - 1) energyIndex += 1;
        if (state !== "idle") disarm();
        renderEnergy();
    });
    els.energyDown.addEventListener("click", () => {
        if (energyIndex > 0) energyIndex -= 1;
        if (state !== "idle") disarm();
        renderEnergy();
    });

    els.sync.addEventListener("change", () => {
        els.syncLabel.textContent = els.sync.checked ? "SYNC ON" : "SYNC OFF";
        cancelShockHold();
        setStatusText();
        renderShockButton();
    });

    els.charge.addEventListener("click", () => {
        if (state === "idle") beginCharge();
        else disarm();
    });

    els.shock.addEventListener("click", handleShockClick);
    els.shock.addEventListener("pointerdown", beginShockHold);
    els.shock.addEventListener("pointerup", cancelShockHold);
    els.shock.addEventListener("pointerleave", cancelShockHold);
    els.shock.addEventListener("pointercancel", cancelShockHold);

    renderEnergy();
    setState("idle");
    els.syncLabel.textContent = "SYNC OFF";
}
