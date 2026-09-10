// CUSTOM ELEMENTS
import "./custom_elements/sim-readout.js";
import "./custom_elements/sim-post.js";
import "./custom_elements/sim-ix-bsl.js";
import "./custom_elements/sim-ix-radiograph.js";

// MONITOR POWER (starts in standby)
import "./monitor-power.js";

// SOCKETS
import { getSocket } from "./sockets.js";

let socket = getSocket();

// NIBP
import {
    registerNibpAutoCycleStateEmitter,
    registerNibpAutoCycleStateReceiver,
    attachMonitorNibpCycleSwitchHandler,
    registerRemoteNibpCycleReceiver,
    attachLocalNibpCycleButton,
    initialiseNibpTimer,
} from "./nibp.js";

registerNibpAutoCycleStateEmitter(socket);
registerNibpAutoCycleStateReceiver(socket);
registerRemoteNibpCycleReceiver(socket);
initialiseNibpTimer();
attachLocalNibpCycleButton();
attachMonitorNibpCycleSwitchHandler();

// SYNC
import { registerMonitorSyncReceiver } from "./sync.js";
registerMonitorSyncReceiver(socket);

// INVESTIGATIONS
import { registerInvestigationReceiver } from "./investigations.js";
registerInvestigationReceiver(socket);

// BEEPS AND BOOPS
import {
    createSimAudioContext,
    autoPlayHeartBeeps,
    enableAudioAutoPlayOnFirstUserInteraction,
    autoPlayAlarmBoops,
    connectAlarmAcknowledgementTimerLogic,
} from "./audio.js";

// audio shared infrastructure
window.simAudioControlObjects = createSimAudioContext();
enableAudioAutoPlayOnFirstUserInteraction(window.simAudioControlObjects);

// heart beeps
autoPlayHeartBeeps(window.simAudioControlObjects);

// alarm boops + silencing
autoPlayAlarmBoops(window.simAudioControlObjects);
connectAlarmAcknowledgementTimerLogic();

document.addEventListener(
    "pointerdown",
    () => {
        // enable sound switch (audiocontext autoplay enabled elsewhere) on first interaction
        document.getElementById("sound-switch").checked = true;
    },
    { once: true },
);

// WAVES
import "./wavemaker2.js";

// DEFIBRILLATOR MODE (monitor-local)
import "./defib.js";

// pacemakers need to be started manually
window.addEventListener("load", (e) => {
    setTimeout(() => {
        document.querySelector("#ecg").beat(0, true);
        document.querySelector("#capno").beat(0, true);
    }, 300);
});

window.addEventListener("resize", () => {
    let oldSvgs = document.querySelectorAll("sim-trace div.wave");
    for (let o of oldSvgs) {
        o.style.visibility = "hidden";
    }
    let waves = document.querySelectorAll("sim-trace");
    for (let w of waves) {
        w.forceNewline();
    }
});

// MODAL

let connectionDialog = document.querySelector("dialog#connect-modal");
let sp = new URLSearchParams(document.location.search);
let autoConnect = sp?.get("autoconnect")?.toLowerCase() == "true";
if (document.body.dataset.simDemoMode != "true" && !autoConnect) {
    connectionDialog.showModal();
}
