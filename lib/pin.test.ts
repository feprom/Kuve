import { afterEach, describe, expect, it } from "vitest";

import { PIN_BLOQUEO_MIN, PIN_MAX_FALLOS, emailInterno, passwordDePin, pinValido } from "./pin";

const PEPPER = "c2VtaWxsYS1kZS1wcnVlYmEtMzItYnl0ZXMtZXhhY3Rvcw==";

describe("pinValido", () => {
  it("acepta seis digitos no triviales", () => {
    expect(pinValido("482913")).toBe(true);
    expect(pinValido("100200")).toBe(true);
  });

  it("rechaza longitud distinta de seis o caracteres no numericos", () => {
    expect(pinValido("48291")).toBe(false);
    expect(pinValido("4829131")).toBe(false);
    expect(pinValido("48a913")).toBe(false);
    expect(pinValido("")).toBe(false);
    expect(pinValido(" 482913")).toBe(false);
  });

  it("rechaza los PIN de manual: repetidos y secuencias", () => {
    for (const p of ["000000", "111111", "999999", "123456", "654321"]) {
      expect(pinValido(p), p).toBe(false);
    }
  });
});

describe("passwordDePin", () => {
  it("es determinista y no contiene el PIN", () => {
    const a = passwordDePin("Ana@Mail.com", "482913", PEPPER);
    const b = passwordDePin("ana@mail.com", "482913", PEPPER);
    expect(a).toBe(b); // el email se normaliza a minusculas
    expect(a).not.toContain("482913");
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, apto como contrasena
  });

  it("cambia con el email, con el PIN y con el pepper", () => {
    const base = passwordDePin("ana@mail.com", "482913", PEPPER);
    expect(passwordDePin("bea@mail.com", "482913", PEPPER)).not.toBe(base);
    expect(passwordDePin("ana@mail.com", "482914", PEPPER)).not.toBe(base);
    expect(passwordDePin("ana@mail.com", "482913", PEPPER + "x")).not.toBe(base);
  });

  it("lanza si no hay pepper (ni en argumento ni en entorno)", () => {
    const antes = process.env.KUVE_PIN_PEPPER;
    delete process.env.KUVE_PIN_PEPPER;
    try {
      expect(() => passwordDePin("ana@mail.com", "482913")).toThrow(/KUVE_PIN_PEPPER/);
    } finally {
      if (antes !== undefined) process.env.KUVE_PIN_PEPPER = antes;
    }
  });

  it("lee el pepper del entorno cuando no se pasa", () => {
    const antes = process.env.KUVE_PIN_PEPPER;
    process.env.KUVE_PIN_PEPPER = PEPPER;
    try {
      expect(passwordDePin("ana@mail.com", "482913")).toBe(passwordDePin("ana@mail.com", "482913", PEPPER));
    } finally {
      if (antes === undefined) delete process.env.KUVE_PIN_PEPPER;
      else process.env.KUVE_PIN_PEPPER = antes;
    }
  });
});

describe("emailInterno y constantes", () => {
  it("construye el email interno con el id del cliente", () => {
    expect(emailInterno("f56c70ea")).toBe("f56c70ea@clientes.kuve.invalid");
  });
  it("expone los limites del bloqueo", () => {
    expect(PIN_MAX_FALLOS).toBe(5);
    expect(PIN_BLOQUEO_MIN).toBe(15);
  });
});

afterEach(() => {
  // nada que limpiar: cada test restaura el entorno que toca
});
