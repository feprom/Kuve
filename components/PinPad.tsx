"use client";
import { useEffect, useId, useRef } from "react";

/**
 * Teclado de PIN de 6 digitos, pensado para el telefono.
 *
 * POR QUE un teclado propio y no un <input type="password">: en la PWA
 * instalada el teclado del sistema tapa media pantalla, cambia de alto entre
 * iOS y Android y hace zoom si la fuente baja de 16px. Con 12 teclas grandes
 * el gesto es el mismo que desbloquear el movil. Aun asi hay un <input> real,
 * visualmente oculto pero enfocable: asi funciona el teclado fisico en
 * escritorio y el autocompletado de codigos de un solo uso del navegador.
 *
 * El componente es controlado: `value` solo contiene digitos (maximo 6) y el
 * padre decide que hacer al completarse (`onComplete`), que se dispara UNA vez
 * por cada vez que se llega a 6 digitos.
 */
export const PIN_LEN = 6;

export type PinPadProps = {
  value: string;
  onChange: (pin: string) => void;
  /** Se llama una sola vez cuando `value` alcanza 6 digitos. */
  onComplete?: (pin: string) => void;
  /** Texto sobre los huecos ("Tu PIN", "Repite el PIN"...). */
  label?: string;
  disabled?: boolean;
  /** Enfoca el input oculto al montar (teclado fisico en escritorio). */
  autoFocus?: boolean;
};

const soloDigitos = (s: string) => s.replace(/\D/g, "").slice(0, PIN_LEN);

export default function PinPad({ value, onChange, onComplete, label, disabled, autoFocus }: PinPadProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Para no disparar onComplete dos veces con el mismo PIN (p.ej. al re-renderizar).
  const ultimoCompleto = useRef<string | null>(null);

  useEffect(() => {
    if (value.length === PIN_LEN) {
      if (ultimoCompleto.current !== value) {
        ultimoCompleto.current = value;
        onComplete?.(value);
      }
    } else {
      ultimoCompleto.current = null;
    }
  }, [value, onComplete]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const pulsar = (d: string) => {
    if (disabled) return;
    onChange(soloDigitos(value + d));
    inputRef.current?.focus({ preventScroll: true });
  };
  const borrar = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
    inputRef.current?.focus({ preventScroll: true });
  };

  const teclas: (string | "del" | "")[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div className={`pinpad${disabled ? " disabled" : ""}`}>
      {label && <label htmlFor={id} className="pin-label">{label}</label>}
      {/* Input real, oculto: teclado fisico y autocompletado. Los huecos de
          abajo son solo su reflejo visual. */}
      <input
        id={id}
        ref={inputRef}
        className="pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={PIN_LEN}
        value={value}
        disabled={disabled}
        aria-label={label ?? "PIN de 6 dígitos"}
        onChange={(e) => onChange(soloDigitos(e.target.value))}
      />
      <div className="pin-cells" aria-hidden="true" onClick={() => inputRef.current?.focus({ preventScroll: true })}>
        {Array.from({ length: PIN_LEN }, (_, i) => (
          <span key={i} className={`pin-cell${i < value.length ? " on" : ""}${i === value.length ? " cur" : ""}`}>
            {i < value.length ? "•" : ""}
          </span>
        ))}
      </div>
      <div className="pin-keys" role="group" aria-label="Teclado numérico">
        {teclas.map((t, i) =>
          t === "" ? (
            <span key={i} />
          ) : t === "del" ? (
            <button key={i} type="button" className="pin-key del" onClick={borrar}
              disabled={disabled || value.length === 0} aria-label="Borrar">⌫</button>
          ) : (
            <button key={i} type="button" className="pin-key" onClick={() => pulsar(t)}
              disabled={disabled || value.length >= PIN_LEN}>{t}</button>
          )
        )}
      </div>
    </div>
  );
}
