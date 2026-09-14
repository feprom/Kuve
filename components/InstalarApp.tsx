"use client";
import { useEffect, useState } from "react";

/**
 * Ultimo paso de la invitacion: poner KUVE en la pantalla de inicio.
 *
 * Tres situaciones, detectadas en el navegador:
 *  - Ya instalada (display-mode: standalone): no hay nada que hacer; el padre
 *    puede saltarse el paso (`onEstado("instalada")`).
 *  - Android/Chrome: el navegador dispara `beforeinstallprompt`; lo guardamos y
 *    lo lanzamos con un boton "Instalar".
 *  - iOS Safari: no existe el prompt; solo cabe explicar los 3 toques
 *    (Compartir -> Anadir a pantalla de inicio -> Anadir).
 *
 * Ojo iOS: la app instalada NO comparte localStorage con Safari, asi que el
 * email recordado no viaja; la primera vez pedira email + PIN. Se avisa.
 */
type Estado = "instalada" | "prompt" | "ios" | "manual";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstalarApp({ onEstado }: { onEstado?: (e: Estado) => void }) {
  const [estado, setEstado] = useState<Estado>("manual");
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    let e: Estado = standalone ? "instalada" : ios ? "ios" : "manual";
    setEstado(e);
    onEstado?.(e);
    const onPrompt = (ev: Event) => {
      ev.preventDefault();
      setEvt(ev as BeforeInstallPromptEvent);
      e = "prompt"; setEstado(e); onEstado?.(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => { setHecho(true); };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function instalar() {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") setHecho(true);
    setEvt(null);
  }

  if (estado === "instalada") {
    return <p className="note">Ya tienes KUVE instalada en este dispositivo.</p>;
  }
  if (hecho) {
    return <p className="ok-msg">KUVE ya está en tu pantalla de inicio. Ábrela desde ahí a partir de ahora.</p>;
  }
  if (estado === "prompt") {
    return (
      <>
        <p className="note">Con la app en tu pantalla de inicio entras con un toque y tu PIN, sin buscar la dirección.</p>
        <button type="button" className="btn" onClick={instalar}>Instalar</button>
      </>
    );
  }
  if (estado === "ios") {
    return (
      <>
        <p className="note">En iPhone se instala desde Safari, en tres toques:</p>
        <ol className="pasos">
          <li><span className="n">1</span><span>Toca el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba, abajo en el centro).</span></li>
          <li><span className="n">2</span><span>Baja en la lista y elige <b>Añadir a pantalla de inicio</b>.</span></li>
          <li><span className="n">3</span><span>Confirma con <b>Añadir</b>. Verás el icono de KUVE junto a tus otras apps.</span></li>
        </ol>
        <p className="note">La primera vez que abras la app te pedirá tu email y tu PIN.</p>
      </>
    );
  }
  return (
    <>
      <p className="note">Desde el menú de tu navegador elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.
        Así entras con un toque y tu PIN, sin buscar la dirección.</p>
      <p className="note">La primera vez que abras la app te pedirá tu email y tu PIN.</p>
    </>
  );
}
