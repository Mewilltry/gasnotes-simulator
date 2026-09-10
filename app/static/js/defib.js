// DEFIBRILLATOR MODE
//
// Monitor-local only: nothing here is sent to the sim controller. A shock
// just blanks the local ECG for ~1.5 s so the person running the controller
// can pick the post-shock rhythm and send it as usual.

import { audioIsRunning } from "./audio.js";

const ENERGY_STEPS = [10, 20, 30, 50, 70, 100, 120, 150, 200, 300, 360];
const CHARGE_MS = 4000; // nominal charge time (scaled a little by energy)
const READY_TIMEOUT_MS = 60000; // auto-disarm if a charge is left unused
const FLATLINE_MS = 1500; // ECG blank after a shock

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
                (els.sync.checked ? "SYNC · " : "") +
                energy() +
                "J — PUSH SHOCK";
        }
    }

    function setState(next) {
        state = next;
        els.panel.dataset.defibState = next;
        setStatusText();
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
        osc.frequency.setValueAtTime(180, t0);
        osc.frequency.exponentialRampToValueAtTime(
            1600,
            t0 + Math.max(0.2, durMs / 1000),
        );
        g.gain.linearRampToValueAtTime(0.16, t0 + 0.05);
        osc.start(t0);
        chargeSound = { osc, g };
    }
    function stopChargeSound() {
        if (!chargeSound) return;
        try {
            const t = actx().currentTime;
            chargeSound.g.gain.cancelScheduledValues(t);
            chargeSound.g.gain.setValueAtTime(chargeSound.g.gain.value, t);
            chargeSound.g.gain.linearRampToValueAtTime(0, t + 0.05);
            chargeSound.osc.stop(t + 0.07);
        } catch (e) {}
        chargeSound = null;
    }

    function startReadySound() {
        stopReadySound();
        if (!audioIsRunning()) return;
        const ctx = actx();
        if (!ctx || !bus()) return;
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = 2000;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        osc.connect(g).connect(bus());
        osc.start();
        readySound = { osc, g };
    }
    function stopReadySound() {
        if (!readySound) return;
        try {
            const t = actx().currentTime;
            readySound.g.gain.linearRampToValueAtTime(0, t + 0.03);
            readySound.osc.stop(t + 0.05);
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
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.18);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
        osc.connect(g).connect(bus());
        osc.start(t0);
        osc.stop(t0 + 0.3);
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
        setStatusText();
    });

    els.charge.addEventListener("click", () => {
        if (state === "idle") beginCharge();
        else disarm();
    });

    els.shock.addEventListener("click", deliverShock);

    renderEnergy();
    setState("idle");
    els.syncLabel.textContent = "SYNC OFF";
}
