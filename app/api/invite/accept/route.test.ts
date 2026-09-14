import { beforeEach, describe, expect, it, vi } from "vitest";

// Dobles de los dos clientes Supabase: el de sesion (anon + cookies) y el de
// service role. Cada test ajusta lo que devuelven.
const peek = vi.fn();
const signIn = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const acceptRpc = vi.fn();
const inviteRow = vi.fn();
const clientRow = vi.fn();
const getUserById = vi.fn();
const updateUserById = vi.fn();

vi.mock("@/lib/supabase/route", () => ({
  supabaseRoute: () => ({
    rpc: (fn: string, args: unknown) => (fn === "invite_peek" ? peek(args) : Promise.resolve({ data: null, error: { message: "rpc desconocida " + fn } })),
    auth: { signInWithPassword: signIn },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: (_col: string, valor: string) => ({
          maybeSingle: () => (tabla === "clients" ? clientRow(valor) : inviteRow(tabla, valor)),
        }),
      }),
    }),
    rpc: (fn: string, args: unknown) => (fn === "accept_invite" ? acceptRpc(args) : Promise.resolve({ data: null, error: { message: "rpc desconocida " + fn } })),
    auth: { admin: { createUser, deleteUser, getUserById, updateUserById } },
  }),
}));

import { POST } from "./route";

const TOKEN = "ABCDEFGHJKMNPQRSTUVWXYZ2";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/invite/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KUVE_PIN_PEPPER = "cGVwcGVyLWRlLXBydWViYQ==";
  peek.mockResolvedValue({ data: [{ name: "Monica Lopez", email_masked: "m***@gmail.com", estado: "valida" }], error: null });
  inviteRow.mockResolvedValue({ data: { client_id: "f56c70ea", email: "monica@gmail.com", name: "Monica Lopez" }, error: null });
  createUser.mockResolvedValue({ data: { user: { id: "11111111-1111-1111-1111-111111111111" } }, error: null });
  acceptRpc.mockResolvedValue({ data: "f56c70ea", error: null });
  signIn.mockResolvedValue({ data: { session: {} }, error: null });
  deleteUser.mockResolvedValue({ data: null, error: null });
  clientRow.mockResolvedValue({ data: { auth_uid: null, email: null }, error: null }); // Monica: fila sin usuario de auth
  getUserById.mockResolvedValue({ data: { user: null }, error: null });
  updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
});

describe("POST /api/invite/accept", () => {
  it("400 si falta el token o el PIN no es valido (y no toca Auth)", async () => {
    let res = await post({ token: TOKEN, pin: "123456" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PIN/);
    res = await post({ pin: "482913" });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("410 con el estado si la invitacion no esta viva", async () => {
    for (const estado of ["usada", "caducada", "inexistente"]) {
      peek.mockResolvedValueOnce({ data: [{ name: null, email_masked: null, estado }], error: null });
      const res = await post({ token: TOKEN, pin: "482913" });
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: expect.any(String), estado });
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it("409 si es invitacion nueva (sin client_id) y el email ya tiene cuenta en Auth", async () => {
    inviteRow.mockResolvedValueOnce({ data: { client_id: null, email: "monica@gmail.com", name: "Monica Lopez" }, error: null });
    createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" } });
    const res = await post({ token: TOKEN, pin: "482913" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ya tiene cuenta/);
    expect(acceptRpc).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("re-invitacion a un cliente que YA tiene usuario: sustituye su contrasena en vez de crear otro usuario", async () => {
    const UID = "33333333-3333-3333-3333-333333333333";
    clientRow.mockResolvedValueOnce({ data: { auth_uid: UID, email: "monica@gmail.com" }, error: null });
    getUserById.mockResolvedValueOnce({ data: { user: { id: UID, email: "Monica@Gmail.com" } }, error: null });
    const res = await post({ token: TOKEN, pin: "482913" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "monica@gmail.com" });

    expect(createUser).not.toHaveBeenCalled();
    expect(clientRow).toHaveBeenCalledWith("f56c70ea");
    expect(getUserById).toHaveBeenCalledWith(UID);
    const [uid, cambios] = updateUserById.mock.calls[0];
    expect(uid).toBe(UID);
    expect(cambios.password).not.toContain("482913");
    expect(acceptRpc).toHaveBeenCalledWith({ p_token: TOKEN, p_auth_uid: UID, p_email: "monica@gmail.com" });
    expect(signIn).toHaveBeenCalledWith({ email: "monica@gmail.com", password: cambios.password });
  });

  it("re-invitacion: si accept_invite falla NO se borra el usuario preexistente", async () => {
    const UID = "33333333-3333-3333-3333-333333333333";
    clientRow.mockResolvedValueOnce({ data: { auth_uid: UID, email: "monica@gmail.com" }, error: null });
    acceptRpc.mockResolvedValueOnce({ data: null, error: { message: "invitacion_invalida" } });
    const res = await post({ token: TOKEN, pin: "482913" });
    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("200: crea el usuario con la contrasena derivada, acepta la invitacion e inicia sesion", async () => {
    const res = await post({ token: TOKEN.toLowerCase(), pin: "482913" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "monica@gmail.com" });

    expect(peek).toHaveBeenCalledWith({ p_token: TOKEN }); // se normaliza a mayusculas
    const alta = createUser.mock.calls[0][0];
    expect(alta.email).toBe("monica@gmail.com");
    expect(alta.email_confirm).toBe(true);
    expect(alta.user_metadata).toEqual({ name: "Monica Lopez" });
    expect(alta.password).not.toContain("482913");
    expect(alta.password.length).toBeGreaterThan(30);

    expect(acceptRpc).toHaveBeenCalledWith({ p_token: TOKEN, p_auth_uid: "11111111-1111-1111-1111-111111111111", p_email: "monica@gmail.com" });
    expect(signIn).toHaveBeenCalledWith({ email: "monica@gmail.com", password: alta.password });
  });

  it("sin email en la invitacion usa el email interno del cliente (o del token si es cliente nuevo)", async () => {
    inviteRow.mockResolvedValueOnce({ data: { client_id: "f56c70ea", email: null, name: "Monica" }, error: null });
    let res = await post({ token: TOKEN, pin: "482913" });
    expect((await res.json()).email).toBe("f56c70ea@clientes.kuve.invalid");

    inviteRow.mockResolvedValueOnce({ data: { client_id: null, email: null, name: "Nuevo" }, error: null });
    res = await post({ token: TOKEN, pin: "482913" });
    expect((await res.json()).email).toBe(TOKEN.toLowerCase() + "@clientes.kuve.invalid");
  });

  it("si accept_invite falla, borra el usuario recien creado y responde 500 (la invitacion sigue viva)", async () => {
    acceptRpc.mockResolvedValueOnce({ data: null, error: { message: "invitacion_invalida" } });
    const res = await post({ token: TOKEN, pin: "482913" });
    expect(res.status).toBe(500);
    expect(deleteUser).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(signIn).not.toHaveBeenCalled();
  });
});
