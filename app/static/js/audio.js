// AUDIO SETUP

export function createSimAudioContext() {
    let audioContext = new window.AudioContext();

    // master bus (headroom + limiter)
    let commonGainNode = audioContext.createGain();
    commonGainNode.gain.value = 0.2; // headroom: start ~0.25–0.5 and adjust

    // "Limiter-ish" settings
    let limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -10; // dB
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003; // seconds
    limiter.release.value = 0.08; // seconds

    commonGainNode.connect(limiter);
    limiter.connect(audioContext.destination);

    return {
        audioContext: audioContext,
        commonGainNode: commonGainNode,
    };
}

export function enableAudioAutoPlayOnFirstUserInteraction(
    simAudioControlObjects,
) {
    document.addEventListener(
        "pointerdown",
        () => {
            if (simAudioControlObjects.audioContext?.state !== "running") {
                simAudioControlObjects.audioContext.resume();
                // document.getElementById("sound-switch").checked = true
            }
        },
        { once: true },
    );
}

// HEART BEEPS

function playHeartBeepOnce(simAudioControlObjects) {
    let context = simAudioControlObjects.audioContext;
    if (audioIsRunning() == false) return;

    let beeperDuration = 150;

    // Create the first OscillatorNode
    let oscillatorNode = context.createOscillator();
    oscillatorNode.type = "triangle";

    // decide frequency
    // #todo refactor to avoid getting this info from the DOM…
    // #smell
    let spo2Element = document.querySelector("#readout-spo2");
    let spo2Value = parseInt(spo2Element.getAttribute("sim-value")) || 99;

    let frequency = 150 + 8 * parseInt(spo2Value);

    oscillatorNode.frequency.value = frequency;

    // Set gain to fade out
    let gainNode = new GainNode(context);

    // Connect both OscillatorNodes to the AudioContext destination (output)
    oscillatorNode
        .connect(gainNode)
        .connect(simAudioControlObjects.commonGainNode);

    // Start gained oscillator
    oscillatorNode.start();

    // Stop oscillator after the specified duration
    let stopTime = context.currentTime + beeperDuration / 1000;
    oscillatorNode.stop(stopTime);
    gainNode.gain.setValueAtTime(1, stopTime - (beeperDuration / 1000) * 0.01);
    gainNode.gain.linearRampToValueAtTime(0, stopTime);

    return true;
}

export function autoPlayHeartBeeps(simAudioControlObjects) {
    document.querySelector("#ecg").addEventListener("beep", (e) => {
        playHeartBeepOnce(simAudioControlObjects);
    });
}

// ALARM BONGS

export function playAlarmBongOnce(simAudioControlObjects) {
    let context = simAudioControlObjects.audioContext;

    if (audioIsRunning() == false) return;

    const now = context.currentTime;

    const osc1 = context.createOscillator(); // fundamental
    osc1.type = "sine";
    osc1.frequency.value = 440;

    const osc2 = context.createOscillator(); // octave
    osc2.type = "sine";
    osc2.frequency.value = 1320;

    const gain = context.createGain();
    gain.gain.value = 0;

    // Relative levels (kept clinical, not musical)
    const g1 = context.createGain();
    g1.gain.value = 0.5;
    const g2 = context.createGain();
    g2.gain.value = 0.2;
    const g3 = context.createGain();
    g3.gain.value = 0;

    osc1.connect(g1);
    osc2.connect(g2);

    g1.connect(gain);
    g2.connect(gain);
    g3.connect(gain);

    gain.connect(simAudioControlObjects.commonGainNode);

    // Envelope
    const attack = 0.05;
    const duration = 1.5;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1.0, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc1.start(now);
    osc2.start(now);

    osc1.stop(now + duration + 10);
    osc2.stop(now + duration + 10);
}

export function autoPlayAlarmBoops(simAudioControlObjects) {
    // check preconditions
    let animationsAreActive; // is false when window is in the background (beeps are timed by a CSS animation, boops are timed by a setTimeout(), which will each pause under different circumstances )
    try {
        animationsAreActive =
            document
                .querySelector("#ecg")
                .getAnimations({ subtree: true })
                .at(-1).playState == "running";
    } catch {
        animationsAreActive = false;
    }
    let anyParameterIsAlarming = document.querySelector(`[sim-alarm="on"]`);
    let alarmsAreCurrentlyAcknowledged = document.querySelector(
        `[sim-alarm-acknowledge-switch]`,
    )?.checked;

    if (
        anyParameterIsAlarming &&
        alarmsAreCurrentlyAcknowledged &&
        animationsAreActive
    ) {
        playAlarmBongOnce(simAudioControlObjects);
    }
    document.body.setAttribute("sim-alarm-bright", true);
    setTimeout(() => {
        document.body.setAttribute("sim-alarm-bright", false);
    }, 1500);
    setTimeout(() => {
        autoPlayAlarmBoops(simAudioControlObjects);
    }, 3000);
}

import { renderSecondsAsMMSS } from "./utils";
export function connectAlarmAcknowledgementTimerLogic() {
    // preconditions
    let alarmTimerSwitch = document.querySelector(
        `[sim-alarm-acknowledge-switch]`,
    );
    let alarmTimerText = document.querySelector(`[sim-alarm-acknowledge-text]`);
    if (!(alarmTimerSwitch && alarmTimerText)) {
        console.warn(
            "Alarms: failed to connect acknowledgement timer logic because [sim-alarm-acknowledge-text] and [sim-alarm-acknowledge-switch] were not found in the DOM",
        );
        return;
    }

    console.debug("Alarms: connected acknowledgement timer logic");
    let timeoutDuration = 90 * 1000;

    function clearAnimationTimeout() {
        // replace text with "alarm"
        alarmTimerText.innerText = "Alarms";

        // clear expiry time
        alarmTimerText.removeAttribute("data-timeout");

        // kill callback
        clearTimeout(alarmTimeAnimationTimeout);
        alarmTimeAnimationTimeout = null;
    }

    // establish timer
    let alarmTimeAnimationTimeout = null;
    function renderAlarmCountdown() {
        // preconditions: expiry time
        let timeout = alarmTimerText.dataset.timeout;
        if (!timeout) {
            return;
        }

        // calculate time remaining
        let delta = alarmTimerText.dataset.timeout - Date.now();

        // render (or reset)
        if (delta >= 1) {
            // render
            let timeRemaining = renderSecondsAsMMSS((delta / 1000).toFixed());
            alarmTimerText.innerText = timeRemaining;
        } else {
            // switch off
            alarmTimerSwitch.checked = true;
            clearAnimationTimeout();
        }

        // if there is time remaining, call setTimeout()
        alarmTimeAnimationTimeout = setTimeout(() => {
            renderAlarmCountdown();
        }, 1000);
    }
    renderAlarmCountdown();

    // listen for switch events
    alarmTimerSwitch.addEventListener("change", (e) => {
        if (e.target.checked) {
            clearAnimationTimeout();
        } else {
            // set expiry time
            alarmTimerText.setAttribute(
                "data-timeout",
                Date.now() + timeoutDuration,
            );

            // start rendering
            renderAlarmCountdown();
        }
    });
}

// UTILS
// TODO: remove reference to global state, yikes
export function audioIsRunning() {
    let audioContextEnabled =
        window.simAudioControlObjects.audioContext.state === "running";
    let soundSwitchEnabled =
        document.getElementById("sound-switch")?.checked == true;
    // a monitor in standby is silent
    let monitorIsOn = document.body.dataset.monitorPower !== "off";

    if (audioContextEnabled && soundSwitchEnabled && monitorIsOn) {
        return true;
    }

    return false;
}
