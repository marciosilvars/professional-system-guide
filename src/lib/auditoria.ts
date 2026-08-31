import { supabase } from "@/integrations/supabase/client";

export async function registrarAuditoria(params: {
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  detalhes?: string;
}) {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;
  await supabase.from("auditoria").insert({
    user_id: user.id,
    user_email: user.email ?? "",
    acao: params.acao,
    entidade: params.entidade,
    entidade_id: params.entidadeId ?? null,
    detalhes: params.detalhes ?? "",
  });
}
