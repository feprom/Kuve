import { beforeEach, describe, expect, it, vi } from "vitest";

// pin_attempts en memoria: el route solo la toca via el cliente service role.
type Fila = { email: string; fails: number; locked_until: string | null; last_at: string | null };
const tabla = new Map<string, Fila>();
const signIn = vi.fn();

vi.mock("@/lib/supabase/route", () => ({
  supabaseRoute: () => ({ auth: { signInWithPassword: signIn } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (nombre: string) => {
      if (nombre !== "pin_attempts") throw new Error("tabla inesperada " + nombre);
      return {
        select: () => ({ eq: (_c: string, email: string) => ({ maybeSingle: async () => ({ data: tabla.get(email) ?? null, error: null }) }) }),
        upsert: async (fila: Fila) => { tabla.set(fila.email, { ...(tabla.get(fila.email) ?? { fails: 0, locked_until: null, last_at: null }), ...fila }); return { error: null }; },
        delete: () => ({ eq: async (_c: string, email: string) => { tabla.delete(email); return { error: null }; } }),
      };
    },
  }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/pin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const MAL = { data: { session: null, user: null }, error: { message: "Invalid login credentials", status: 400 } };
const BIEN = { data: { session: { access_token: "x" }, user: { id: "u1" } }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  tabla.clear();
  process.env.KUVE_PIN_PEPPER = "cGVwcGVyLWRlLXBydWViYQ==";
  signIn.mockResolvedValue(MAL);
});

describe("POST /api/pin/login", () => {
  it("400 si faltan email o PIN con formato de seis digitos", async () => {
    expect((await post({ email: "", pin: "482913" })).status).toBe(400);
    expect((await post({ email: "ana@mail.com", pin: "4829" })).status).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("401 identico para usuario inexistente y para PIN incorrecto, y cuenta el fallo", async () => {
    signIn.mockResolvedValueOnce({ data: { session: null, user: null }, error: { message: "Invalid login credentials", status: 400 } });
    const a = await post({ email: "nadie@mail.com", pin: "482913" });
    signIn.mockResolvedValueOnce({ data: { session: null, user: null }, error: { message: "Invalid login credentials", status: 400 } });
    const b = await post({ email: "ana@mail.com", pin: "482914" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const ja = await a.json();
    expect(ja).toEqual(await b.json());
    expect(ja.error).toBe("Email o PIN incorrectos");
    expect(tabla.get("nadie@mail.com")?.fails).toBe(1);
    expect(tabla.get("ana@mail.com")?.fails).toBe(1);
  });

  it("normaliza el email y firma con la contrasena derivada, nunca con el PIN", async () => {
    signIn.mockResolvedValueOnce(BIEN);
    const res = await post({ email: "  Ana@Mail.com ", pin: "482913" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const arg = signIn.mock.calls[0][0];
    expect(arg.email).toBe("ana@mail.com");
    expect(arg.password).not.toContain("482913");
    expect(arg.password.length).toBeGreaterThan(30);
  });

  it("bloquea 15 minutos al quinto fallo y rechaza con 423 mientras dure, sin llamar a Auth", async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await post({ email: "ana@mail.com", pin: "482913" });
      expect(r.status, `fallo ${i}`).toBe(401);
      expect(tabla.get("ana@mail.com")?.fails).toBe(i);
    }
    const quinto = await post({ email: "ana@mail.com", pin: "482913" });
    expect(quinto.status).toBe(423);
    const cuerpo = await quinto.json();
    expect(cuerpo.segundos).toBeGreaterThan(14 * 60);
    expect(cuerpo.segundos).toBeLessThanOrEqual(15 * 60);
    const fila = tabla.get("ana@mail.com")!;
    expect(fila.fails).toBe(0);
    expect(Date.parse(fila.locked_until!)).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(signIn).toHaveBeenCalledTimes(5);

    // Con el PIN correcto y bloqueado: sigue 423 y no se consulta Auth.
    signIn.mockResolvedValueOnce(BIEN);
    const bloqueado = await post({ email: "ana@mail.com", pin: "482913" });
    expect(bloqueado.status).toBe(423);
    expect(signIn).toHaveBeenCalledTimes(5);
  });

  it("con el bloqueo vencido vuelve a dejar intentar y el exito borra el contador", async () => {
    tabla.set("ana@mail.com", { email: "ana@mail.com", fails: 0, locked_until: new Date(Date.now() - 1000).toISOString(), last_at: null });
    signIn.mockResolvedValueOnce(BIEN);
    const res = await post({ email: "ana@mail.com", pin: "482913" });
    expect(res.status).toBe(200);
    expect(tabla.has("ana@mail.com")).toBe(false);
  });
});
