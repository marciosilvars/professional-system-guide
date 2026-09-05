import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Auditoria } from "@/lib/betaxlog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria — BETAXLOG" },
      {
        name: "description",
        content: "Histórico de ações dos usuários: quem fez o quê e quando no sistema BETAXLOG.",
      },
      { property: "og:title", content: "Auditoria — BETAXLOG" },
      {
        property: "og:description",
        content: "Log auditável de cadastros, edições, exclusões e confirmações de escala.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuditoriaPage,
});

function AuditoriaPage() {
  const [busca, setBusca] = useState("");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["auditoria"],
    queryFn: async (): Promise<Auditoria[]> => {
      const { data, error } = await supabase
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const lista = logs.filter(
    (l) =>
      l.acao.toLowerCase().includes(busca.toLowerCase()) ||
      l.user_email.toLowerCase().includes(busca.toLowerCase()) ||
      l.detalhes.toLowerCase().includes(busca.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Quem fez o quê e quando — rastreabilidade completa da operação.
        </p>
      </header>

      <section className="surface-panel p-6">
        <div className="relative mb-5 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por ação, usuário ou detalhe..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando histórico...</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {lista.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString("pt-BR")}
                </span>
                <Badge variant="secondary">{l.entidade}</Badge>
                <span className="font-medium">{l.acao}</span>
                {l.detalhes && <span className="text-muted-foreground">{l.detalhes}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{l.user_email}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
