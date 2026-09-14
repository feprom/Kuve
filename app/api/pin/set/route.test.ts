import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const marker = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/supabase/route", () => ({
  supabaseRoute: () => ({
    auth: { getUser },
    rpc: (fn: string) => (fn === "set_pin_marker" ? marker() : Promise.resolve({ data: null, error: { message: "rpc desconocida " + fn } })),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ auth: { admin: { updateUserById: updateUser } } }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/pin/set", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const USUARIO = { id: "22222222-2222-2222-2222-222222222222", email: "Ana@Mail.com" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KUVE_PIN_PEPPER = "cGVwcGVyLWRlLXBydWViYQ==";
  getUser.mockResolvedValue({ data: { user: USUARIO }, error: null });
  updateUser.mockResolvedValue({ data: { user: USUARIO }, error: null });
  marker.mockResolvedValue({ data: null, error: null });
});

describe("POST /api/pin/set", () => {
  it("401 sin sesion, sin tocar Auth", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "no session" } });
    const res = await post({ pin: "482913" });
    expect(res.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("400 si el PIN no es valido", async () => {
    const res = await post({ pin: "111111" });
    expect(res.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
    expect(marker).not.toHaveBeenCalled();
  });

  it("200: sustituye la contrasena por la derivada del PIN y marca pin_set_at", async () => {
    const res = await post({ pin: "482913" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledTimes(1);
    const [uid, cambios] = updateUser.mock.calls[0];
    expect(uid).toBe(USUARIO.id);
    expect(cambios.password).not.toContain("482913");
    expect(cambios.password.length).toBeGreaterThan(30);
    expect(marker).toHaveBeenCalledTimes(1);
  });

  it("500 si Auth no acepta el cambio, y no se pone la marca", async () => {
    updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "boom" } });
    const res = await post({ pin: "482913" });
    expect(res.status).toBe(500);
    expect(marker).not.toHaveBeenCalled();
  });
});
