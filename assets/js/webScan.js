import { createQrDecoder } from './qrScanner.js';
import { resolveWebQr } from './webQr.js';

const video = document.getElementById('scanVideo');
const start = document.getElementById('scanStartBtn');
const stop = document.getElementById('scanStopBtn');
const status = document.getElementById('scanStatus');
const placeholder = document.getElementById('scanPlaceholder');
const result = document.getElementById('scanResult');
let stream;
let timer;
let generation = 0;
function stopCamera() {
  generation++;
  clearTimeout(timer);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  video.hidden = true;
  stop.hidden = true;
  start.disabled = false;
  start.textContent = 'Start camera';
  placeholder.hidden = false;
}
function showResult(value) {
  const target = resolveWebQr(value);
  if (!target) {
    status.textContent = 'Use a Nearify event or personal QR. This code cannot be opened here.';
    return false;
  }
  stopCamera();
  document.getElementById('scanContinueLink').href = target;
  result.hidden = false;
  status.textContent = '';
  document.getElementById('scanResultHeading').focus();
  return true;
}
start.addEventListener('click', async () => {
  if (start.disabled || stream) return;
  const attempt = ++generation;
  start.disabled = true;
  result.hidden = true;
  status.textContent = 'Preparing your camera…';
  let phase = 'decoder';
  try {
    const decoder = await createQrDecoder();
    if (attempt !== generation) return;
    phase = 'camera';
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
    const camera = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if (attempt !== generation) { camera.getTracks().forEach(track => track.stop()); return; }
    stream = camera;
    video.srcObject = camera;
    video.hidden = false;
    stop.hidden = false;
    placeholder.hidden = true;
    await video.play();
    if (attempt !== generation) return;
    start.textContent = 'Scanning…';
    status.textContent = 'Point your camera at an event, guest, or personal Nearify QR.';
    const scan = async () => {
      if (attempt !== generation) return;
      try {
        const codes = await decoder.detect(video);
        if (attempt !== generation) return;
        if (codes[0]?.rawValue) {
          stopCamera();
          showResult(codes[0].rawValue);
          return;
        }
      } catch (_) {
        if (attempt !== generation) return;
        stopCamera();
        status.textContent = 'Could not read the camera image. Try again or paste their Nearify link below.';
        return;
      }
      timer = setTimeout(scan,250);
    };
    scan();
  } catch (error) {
    if (attempt !== generation) return;
    stopCamera();
    status.textContent = error?.name === 'NotAllowedError'
      ? 'Camera access was denied. Allow camera access in browser settings and try again, or paste their Nearify link below.'
      : phase === 'decoder' ? 'The scanner could not load. Try again or paste their Nearify link below.'
      : 'Camera unavailable. Try again or paste their Nearify link below.';
    document.getElementById('scanPasteDetails').open = true;
  }
});
stop.addEventListener('click', () => { stopCamera(); status.textContent = 'Camera stopped.'; });
document.getElementById('scanLinkBtn').addEventListener('click', () => {
  stopCamera();
  result.hidden = true;
  showResult(document.getElementById('scanLinkInput').value);
});
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden) { stopCamera(); status.textContent = 'Camera paused. Tap Start camera to resume.'; }
});
