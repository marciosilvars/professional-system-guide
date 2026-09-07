import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().email("E-mail inválido"),
  senha: z.string().min(6, "A senha precisa ter ao menos 6 caracteres"),
  papel: z.enum(["admin", "supervisor"]),
});

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: ehAdmin, error: erroPapel } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (erroPapel) throw new Error("Não foi possível validar suas permissões.");
    if (!ehAdmin) throw new Error("Apenas administradores podem cadastrar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: criado, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error || !criado.user) {
      throw new Error(
        error?.message?.includes("already")
          ? "Este e-mail já está cadastrado."
          : (error?.message ?? "Não foi possível criar o usuário."),
      );
    }

    const novoId = criado.user.id;

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: novoId, nome: data.nome, email: data.email });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", novoId);
    const { error: erroRole } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: novoId, role: data.papel });
    if (erroRole) throw new Error("Usuário criado, mas a permissão não foi aplicada.");

    return { id: novoId, nome: data.nome, email: data.email, papel: data.papel };
  });
