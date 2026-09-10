// CUSTOM ELEMENTS
import "./custom_elements/sim-mapgroup";
import "./custom_elements/sim-slider";
import "./custom_elements/sim-radiogroup";
import "./custom_elements/sim-ix-sender";

// SOCKETS
import { getSocket } from "./sockets";
let socket = getSocket();

// SYNC SETUP
import { registerControllerSyncEmitter } from "./sync";
registerControllerSyncEmitter(socket);

import { setSimValue, getSimValue } from "./sync";

// SYNC VALUES (within page)
document.addEventListener("input", (e) => {
    if (!e.target.matches("[sim-sync]")) return;
    if (e?.detail?.preventAutophagy == true) return;

    let parametersString = e.target.getAttribute("data-sim-input");
    let [_, attributeName] = parametersString.split(":");

    let interestedElements = document.querySelectorAll(
        `[data-sim-input="${parametersString}"]`,
    );

    for (let ie of interestedElements) {
        let value = getSimValue(e.target, attributeName);
        setSimValue(ie, attributeName, value);

        ie.dispatchEvent(
            new CustomEvent("input", {
                bubbles: true,
                detail: {
                    preventAutophagy: true,
                },
            }),
        );
    }
});

// NON-PERFUSING RHYTHM CHECKER
let normalEcg = document.querySelector('[data-sim-input^="ecg_morphology"]');
let arrestEcg = document.querySelector(
    '[data-sim-input^="arrest_ecg_morphology"]',
);
let arrestButton = document.querySelector(`input[value="arrested"]`);

let lastEcgValue = normalEcg.value; // keep track of last non-arrested rhythm choice

normalEcg.addEventListener("change", (e) => {
    if (e.target.options[e.target.selectedIndex].hasAttribute("sim-arrest")) {
        // confirm with user
        let a = confirm(`Initiate cardiac arrest?`);
        if (!a) {
            document
                .querySelector('[data-sim-input^="heart_rate"]')
                .setAttribute("sim-value", 220);
            return true;
        }

        // set arrest rhythm parameter (it's a separate <select> element)
        arrestEcg.value = e.target.value;

        // initiate cardiac arrest
        arrestButton.click();

        // restore last non-arrested rhythm choice
        e.target.value = lastEcgValue;
    } else {
        // keep track of last non-arrested rhythm choice
        lastEcgValue = e.target.value;
    }
});

// CPR
let cprButton = document.querySelector("#cpr-button");
let sendButton = document.querySelector("#send");
cprButton?.addEventListener("click", (e) => {
    sendButton.click();
});

// ARREST SPECIAL CASE
let normalCapno = document.querySelector(
    '[data-sim-input^="capno_morphology"]',
);
let arrestCapno = document.querySelector(
    '[data-sim-input^="arrest_capno_morphology"]',
);
let simModeSwitch = document.querySelector('[data-sim-input^="sim_mode"]');
simModeSwitch.addEventListener("input", (e) => {
    // set mode parameter on body
    // will be picked up by CSS to hide physiologically irrelevant parameters
    if (e.target.value == "arrested") {
        // carry over non-arrested capno morphology (IF it exists)
        // arrest capno doesn't have all the modes of non-arrest capno
        // will default to "disconnected" if a nonexistent mode is set
        arrestCapno.value = normalCapno.value;
        // trigger input event on arrest capno
        // this allows it to disable the etco2 slider according to its own sim-disconnect rules
        arrestCapno.dispatchEvent(new CustomEvent("input", { bubbles: true }));
    }
});

// ABG
let sendableAbg = document.querySelector("#sendable-abg");
// let abgButton = document.querySelector("#abg-send");
// abgButton.addEventListener("click", (e) => {
//     let message = {
//         sim_room_id: document.body.dataset.simRoomId,
//         type: "ABG",
//         abg_data: sendableAbg.abg_proxy,
//     };
//     socket.emit("sim-post", JSON.stringify(message));
//     document.querySelector("#abg-picker")?.close();
// });
let presetPicker = document.querySelector("#abg-presets");
let presets = {
    "Acute Respiratory Acidosis": {
        ph: 7.27,
        pco2: 77,
    },
    "Chronic Respiratory Acidosis": {
        ph: 7.31,
        pco2: 61,
    },
    HAGMA: {
        ph: 7.11,
        pco2: 42,
    },
    NAGMA: {
        ph: 7.11,
        pco2: 48,
        cl: 115,
    },
    DKA: {
        ph: 7.05,
        pco2: 31,
        bsl: 37,
        lactate: 1.9,
        na: 128,
        k: 3.1,
        cl: 96,
        ca: 1.21,
    },
    HHS: {
        ph: 7.36,
        pco2: 35,
        bsl: 43,
        lactate: 0.8,
        na: 124,
        k: 3.7,
        cl: 114,
        cr: 119,
    },
};
document.addEventListener("DOMContentLoaded", (e) => {
    for (let p in presets) {
        let option = document.createElement("option");
        option.innerText = p;
        option.value = p;
        option.parameters = presets[p];
        presetPicker.insertAdjacentElement("beforeend", option);
    }
});
presetPicker.addEventListener("change", (e) => {
    let option = e.target.options[e.target.selectedIndex];
    let parameters = option.parameters;
    for (let p in parameters) {
        sendableAbg.abg_proxy[p] = parameters[p];
    }
});
sendableAbg.addEventListener("input", (e) => {
    presetPicker.selectedIndex = 0;
});

// NIBP
import {
    registerNibpAutoCycleStateEmitter,
    registerNibpAutoCycleStateReceiver,
    registerRemoteNibpCycleEmitter,
} from "./nibp";
// remote cycle
registerRemoteNibpCycleEmitter(socket);
// on/off switch sync
registerNibpAutoCycleStateEmitter(socket);
registerNibpAutoCycleStateReceiver(socket);

// INVESTIGATIONS
import "./custom_elements/sim-picker-radiology";
// import "./custom_elements/sim-picker-abg";
import "./custom_elements/sim-ix-bsl";

import { sendCloseInvestigation } from "./investigations";
function attachCloseImageButton() {
    let btn = document.querySelector("#close-image-button");
    if (!btn) {
        console.error(
            "Investigations: unable to locate '#close-image-button'",
        );
        return;
    }
    btn.addEventListener("click", () => sendCloseInvestigation());
}
window.addEventListener("load", attachCloseImageButton);

// RESET
import {
    _applyStateToDomFragment,
    _serialiseStateFromDomFragment,
} from "./sync";
function attachResetButton() {
    let selector = "#reset-button";
    let resetButton = document.querySelector(selector);

    if (!resetButton) {
        console.error(
            `Controller: unable to locate reset button with selector "${selector}"`,
        );
        return;
    }

    resetButton.addEventListener("click", (e) => {
        if (!confirm("Are you sure you want to reset?")) return;
        let newStates = {};
        let staleStates = _serialiseStateFromDomFragment(
            "#controller",
            "data-sim-input",
        );
        for (let key in window.default_states) {
            if (key.startsWith("enabler-for")) {
                newStates[key] = staleStates[key];
            } else {
                newStates[key] = window.default_states[key];
            }
        }

        _applyStateToDomFragment("#controller", "data-sim-input", newStates);
    });
}
window.addEventListener("load", attachResetButton);

// LIMITS
function attachAlarmLimitInputListeners() {
    let inputLimitSection = document.querySelector("section#limits");
    if (!inputLimitSection) {
        console.error("Limits: unable to find 'section#limits', aborting");
        return;
    }

    inputLimitSection.addEventListener("focusin", (e) => {
        if (!e.target.matches("input.limit")) return;
        e.target.select();
    });
}
window.addEventListener("load", attachAlarmLimitInputListeners);
