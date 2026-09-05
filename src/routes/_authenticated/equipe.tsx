import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe — BETAXLOG" },
      {
        name: "description",
        content: "Gerenciamento de usuários e permissões: administradores e supervisores.",
      },
      { property: "og:title", content: "Equipe — BETAXLOG" },
      {
        property: "og:description",
        content: "Defina quem é administrador e quem é supervisor na operação BETAXLOG.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EquipePage,
});

interface Membro {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "supervisor" | null;
}

function EquipePage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ["equipe"],
    queryFn: async (): Promise<Membro[]> => {
      const [{ data: perfis, error: e1 }, { data: papeis, error: e2 }] = await Promise.all([
        supabase.from("profiles").select("id, nome, email").order("nome"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return (perfis ?? []).map((p) => ({
        id: p.id,
        nome: p.nome,
        email: p.email,
        papel: (papeis?.find((r) => r.user_id === p.id)?.role as Membro["papel"]) ?? null,
      }));
    },
  });

  const alterarPapel = async (membro: Membro, papel: "admin" | "supervisor") => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem alterar permissões.");
      return;
    }
    const { error: erroDel } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", membro.id);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: membro.id, role: papel });
    if (erroDel || error) {
      toast.error("Não foi possível alterar a permissão.");
      return;
    }
    await registrarAuditoria({
      acao: `alterou permissão para ${papel}`,
      entidade: "usuario",
      entidadeId: membro.id,
      detalhes: membro.email,
    });
    await queryClient.invalidateQueries({ queryKey: ["equipe"] });
    toast.success("Permissão atualizada.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-sm text-muted-foreground">
          Administradores gerenciam permissões e exclusões; supervisores operam as escalas.
        </p>
      </header>

      <section className="surface-panel p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando equipe...</p>
        ) : (
          <div className="space-y-3">
            {membros.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {m.nome.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.nome} {m.id === user?.id && <Badge variant="outline">você</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {isAdmin ? (
                    <Select
                      value={m.papel ?? "supervisor"}
                      onValueChange={(v) => void alterarPapel(m, v as "admin" | "supervisor")}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">
                          <span className="flex items-center gap-1.5">
                            <ShieldCheck className="h-3.5 w-3.5" /> Administrador
                          </span>
                        </SelectItem>
                        <SelectItem value="supervisor">
                          <span className="flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5" /> Supervisor
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">
                      {m.papel === "admin" ? "Administrador" : "Supervisor"}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
