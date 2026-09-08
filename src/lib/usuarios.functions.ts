import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const formatarEmailOuUsuario = (valor: string) => {
  const limpo = valor.trim().toLowerCase();
  if (!limpo.includes("@")) return `${limpo}@betaxlog.local`;
  return limpo;
};

const schema = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().min(3, "Informe o usuário ou e-mail"),
  senha: z.string().min(6, "A senha precisa ter ao menos 6 caracteres"),
  papel: z.enum(["admin", "operador"]),
  telefone: z.string().trim().optional(),
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
    const emailAjustado = formatarEmailOuUsuario(data.email);

    const { data: criado, error } = await supabaseAdmin.auth.admin.createUser({
      email: emailAjustado,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error || !criado.user) {
      const msg = error?.message?.toLowerCase() ?? "";
      let erroTraduzido = "Não foi possível criar o usuário.";

      if (msg.includes("already")) {
        erroTraduzido = "Este e-mail já está cadastrado.";
      } else if (msg.includes("weak") || msg.includes("character") || msg.includes("at least") || msg.includes("lowercase") || msg.includes("uppercase")) {
        erroTraduzido = "A senha definida é muito fácil. Escolha uma senha mais forte (letras, números e símbolos).";
      }

      throw new Error(erroTraduzido);
    }

    const novoId = criado.user.id;

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: novoId, nome: data.nome, email: data.email, ...(data.telefone ? { telefone: data.telefone } : {}) });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", novoId);
    const { error: erroRole } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: novoId, role: data.papel });
    if (erroRole) throw new Error("Usuário criado, mas a permissão não foi aplicada.");

    return { id: novoId, nome: data.nome, email: data.email, papel: data.papel };
  });

const alterarSenhaSchema = z.object({
  userId: z.string().uuid(),
  novaSenha: z.string().min(6, "A senha precisa ter ao menos 6 caracteres"),
});

export const alterarSenhaUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => alterarSenhaSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Permite: admin alterando qualquer operador, ou o próprio usuário alterando sua senha
    const isSelf = context.userId === data.userId;
    if (!isSelf) {
      const { data: ehAdmin, error: erroPapel } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (erroPapel) throw new Error("Não foi possível validar suas permissões.");
      if (!ehAdmin) throw new Error("Apenas administradores podem alterar a senha de outros usuários.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.novaSenha,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      let erroTraduzido = "Não foi possível alterar a senha.";

      if (msg.includes("same") || msg.includes("different") || msg.includes("previously") || msg.includes("used") || msg.includes("recent")) {
        erroTraduzido = "Esta senha já foi utilizada anteriormente. Escolha uma senha nova.";
      } else if (msg.includes("weak") || msg.includes("character") || msg.includes("at least") || msg.includes("lowercase") || msg.includes("uppercase")) {
        erroTraduzido = "A nova senha digitada é muito fácil. Escolha uma senha mais forte (letras, números e símbolos).";
      }

      throw new Error(erroTraduzido);
    }
    return { ok: true };
  });

const editarSchema = z.object({
  userId: z.string().uuid(),
  nome: z.string().trim().min(2, "Informe o nome"),
  email: z.string().trim().min(3, "Informe o usuário ou e-mail"),
  papel: z.enum(["admin", "operador"]),
  telefone: z.string().trim().optional(),
});

export const editarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => editarSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: ehAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!ehAdmin) throw new Error("Apenas administradores podem editar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const emailAjustado = formatarEmailOuUsuario(data.email);

    const { error: erroAuth } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email: emailAjustado,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (erroAuth) {
      if (erroAuth.message.includes("already")) throw new Error("Este usuário/e-mail já está em uso.");
      throw new Error("Não foi possível atualizar as credenciais do usuário.");
    }

    await supabaseAdmin
      .from("profiles")
      .update({ nome: data.nome, email: data.email, telefone: data.telefone || null })
      .eq("id", data.userId);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error: erroRole } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, role: data.papel });
    if (erroRole) throw new Error("Não foi possível atualizar a permissão do usuário.");

    return { ok: true };
  });

const excluirSchema = z.object({
  userId: z.string().uuid(),
});

export const excluirUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => excluirSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: ehAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!ehAdmin) throw new Error("Apenas administradores podem excluir usuários.");

    if (data.userId === context.userId) throw new Error("Você não pode excluir sua própria conta.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error("Não foi possível excluir o usuário.");

    // Limpeza forçada caso a chave estrangeira falhe (apenas para garantir)
    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);

    return { ok: true };
  });
