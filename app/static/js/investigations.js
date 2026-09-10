import { getSocket } from "./sockets";
export function sendInvestigation(type, data, name, icon) {
    let socket = getSocket();
    let message = {
        sim_room_id: document.body.dataset.simRoomId,
        type: type,
        data: data,
        name: name,
        icon: icon,
    };
    socket.emit("sim-ix", JSON.stringify(message));
    console.log(`Investigations: send data to server:`, message);
}

// tell the monitor to dismiss whatever investigation it is showing and
// go back to the vitals
export function sendCloseInvestigation() {
    let socket = getSocket();
    let message = {
        sim_room_id: document.body.dataset.simRoomId,
        action: "close",
    };
    socket.emit("sim-ix", JSON.stringify(message));
    console.log(`Investigations: sent close request`);
}

export function registerInvestigationReceiver(socket) {
    socket.on("sim-ix", (msg) => {
        let message = JSON.parse(msg);
        console.log(`Investigations: received data from server:`, message);
        receiveInvestigation(message);
    });
}

function receiveInvestigation(message) {
    if (message.action === "close") {
        console.log("Investigations: received close request");
        closeInvestigations();
        return;
    }

    let type = message.type;
    let data = message.data;
    let icon = message.icon;
    let name = message.name;

    console.log(
        `Investigations: received an investigation of type "${type}"`,
        data,
    );

    insertInvestigation(type, data, name, icon);
}

function closeInvestigations() {
    try {
        if (resourcesModal && resourcesModal.open) resourcesModal.close();
    } catch (e) {
        console.error("Investigations: failed to close resources modal", e);
    }
}

let resourcesModal = document.querySelector("#resources");
let postListElement = document.querySelector("#resource-list");
function insertInvestigation(type, data, name, icon) {
    // create sim-post
    let post = document.createElement("sim-post");
    post.setAttribute("sim-post-target", "#resource-marquee");
    post.innerHTML = `
    <label class="tile">
        <span class="icon">${icon}</span>
        <span class="label" data-name="${name}">${name} #${countOfType(name) + 1}</span>
        <figure sim-post-content>
            <figcaption>${data.credit || ""}</figcaption>
        </figure>
        <input type="radio" name="ix" hidden>
    </label>`;

    // insert investigation
    let element = document.createElement(type);
    element.setAttribute("readonly", "");
    element.deserialise(data);
    post.querySelector("figure").insertAdjacentElement("afterbegin", element);

    // add sim-post to list
    postListElement.insertAdjacentElement("afterbegin", post);

    // show
    resourcesModal.showModal();
    postListElement.querySelector("label").click();
}

function countOfType(t) {
    let elements = resourcesModal.querySelectorAll(`[data-name="${t}"]`) || [];
    return elements.length;
}
