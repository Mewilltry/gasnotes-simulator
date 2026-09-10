// MONITOR POWER (standby by default)
//
// The monitor boots "off": the left-hand parameter tabs stay, but the
// numbers, waveforms and on-screen controls are hidden. State the
// controller pushes still applies to the DOM in the background, so
// pressing power reveals an up-to-date picture. Investigations pushed
// while off are handled in investigations.js (queued, then shown on
// power-on).

const body = document.body;
const btn = document.getElementById("monitor-power");

// default OFF
if (!body.dataset.monitorPower) {
    body.dataset.monitorPower = "off";
}

// the homepage preview renders this template in demo mode — keep that
// little monitor alive
if (body.dataset.simDemoMode === "true") {
    body.dataset.monitorPower = "on";
}

function setPower(on) {
    body.dataset.monitorPower = on ? "on" : "off";
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
    window.dispatchEvent(
        new CustomEvent(on ? "monitor-power-on" : "monitor-power-off"),
    );
}

if (btn) {
    btn.setAttribute(
        "aria-pressed",
        body.dataset.monitorPower === "on" ? "true" : "false",
    );
    btn.addEventListener("click", () => {
        setPower(body.dataset.monitorPower !== "on");
    });
}
