// One shared tooltip element, positioned next to the pointer.
const el = document.createElement("div");
el.className = "tooltip";
el.setAttribute("role", "status");
document.body.appendChild(el);

export const tooltip = {
  show(event, html) {
    el.innerHTML = html;
    el.style.opacity = 1;
    const pad = 14;
    const { innerWidth: w } = window;
    const box = el.getBoundingClientRect();
    const x = event.clientX + pad + box.width > w ? event.clientX - box.width - pad : event.clientX + pad;
    el.style.transform = `translate(${x}px, ${event.clientY + pad}px)`;
  },
  hide() {
    el.style.opacity = 0;
  },
};
