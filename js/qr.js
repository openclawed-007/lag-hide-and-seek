/* QR render + camera scan */
(function (global) {
  function draw(el, text) {
    if (!el) return;
    el.innerHTML = "";
    try {
      if (typeof qrcode === "function") {
        const qr = qrcode(0, "M");
        qr.addData(text);
        qr.make();
        el.innerHTML = qr.createSvgTag(6, 2);
        const svg = el.querySelector("svg");
        if (svg) {
          svg.setAttribute("width", "100%");
          svg.setAttribute("height", "100%");
          svg.removeAttribute("style");
        }
        return;
      }
    } catch (err) {
      console.warn(err);
    }
    const img = document.createElement("img");
    img.alt = "Join QR code";
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=" + encodeURIComponent(text);
    el.appendChild(img);
  }

  async function scan(video) {
    if (!("BarcodeDetector" in window)) {
      throw new Error("This browser cannot scan QR codes. Type the 6-character code instead.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    return new Promise((resolve, reject) => {
      let dead = false;
      const stop = () => {
        dead = true;
        stream.getTracks().forEach((t) => t.stop());
      };
      const tick = async () => {
        if (dead) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes[0] && codes[0].rawValue) {
            stop();
            resolve(codes[0].rawValue);
            return;
          }
        } catch { /* keep scanning */ }
        requestAnimationFrame(tick);
      };
      tick();
      scan._stop = () => {
        stop();
        reject(new Error("Scan cancelled"));
      };
    });
  }

  function stopScan() {
    if (scan._stop) scan._stop();
    scan._stop = null;
  }

  function codeFromText(text) {
    if (!text) return "";
    try {
      const url = new URL(text);
      return (url.searchParams.get("join") || "").toUpperCase();
    } catch {
      const m = String(text).toUpperCase().match(/[A-Z0-9]{6}/);
      return m ? m[0] : "";
    }
  }

  global.JLQR = { draw, scan, stopScan, codeFromText };
})(window);
