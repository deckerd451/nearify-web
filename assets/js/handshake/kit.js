/** /handshake/kit/: draws the QR codes, fills the table cards, full screen and print. */
const URL_TO_SHARE = "https://nearify.org/handshake/";

function fillCards() {
  const face = document.getElementById("kitFace");
  for (const slot of document.querySelectorAll(".kit-tent-face")) slot.replaceChildren(face.content.cloneNode(true));
}

function drawQrs() {
  if (typeof window.QRCode !== "function") return;
  for (const box of document.querySelectorAll("[data-qr]")) {
    const size = Number(box.dataset.qr);
    box.replaceChildren();
    new window.QRCode(box, { text: URL_TO_SHARE, width: size, height: size, colorDark: "#1a1633", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
  }
}

fillCards();
drawQrs();

document.getElementById("kitPrint").addEventListener("click", () => window.print());
document.getElementById("kitFullscreen").addEventListener("click", () => {
  const slide = document.getElementById("kitSlide");
  (slide.requestFullscreen || slide.webkitRequestFullscreen)?.call(slide);
});
