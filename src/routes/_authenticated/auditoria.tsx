import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Auditoria } from "@/lib/betaxlog";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de Rotas — BETAXLOG" },
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
  const { isAdmin, user } = useAuth();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [limpando, setLimpando] = useState(false);

  const { data: logs = [], isLoading, isError, error } = useQuery({
    queryKey: ["auditoria"],
    queryFn: async (): Promise<Auditoria[]> => {
      const { data, error } = await supabase
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500); // aumentado para 500 registros
      if (error) throw error;
      return data ?? [];
    },
    retry: 1,
  });

  const limparHistorico = async () => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem limpar o histórico.");
      return;
    }
    setLimpando(true);
    try {
      // Exclui todos os registros (usando not null como condição de contorno para o Supabase)
      const { error } = await supabase.from("auditoria").delete().not("id", "is", null);
      if (error) throw error;
      
      // Registra a própria ação de limpeza
      await supabase.from("auditoria").insert({
        acao: "limpou histórico de auditoria",
        entidade: "auditoria",
        detalhes: "Todos os registros anteriores foram apagados",
        user_id: user?.id,
        user_email: user?.email,
      });

      await queryClient.invalidateQueries({ queryKey: ["auditoria"] });
      toast.success("Histórico limpo com sucesso.");
      setDialogoAberto(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao limpar o histórico.");
    } finally {
      setLimpando(false);
    }
  };

  const lista = logs.filter(
    (l) =>
      l.acao.toLowerCase().includes(busca.toLowerCase()) ||
      (l.user_email && l.user_email.toLowerCase().includes(busca.toLowerCase())) ||
      (l.detalhes && l.detalhes.toLowerCase().includes(busca.toLowerCase())),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Auditoria</h1>
          <p className="text-sm text-muted-foreground">
            Quem fez o quê e quando — rastreabilidade completa da operação.
          </p>
        </div>
        {isAdmin && logs.length > 0 && (
          <Button variant="destructive" onClick={() => setDialogoAberto(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Limpar histórico
          </Button>
        )}
      </header>

      <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar Histórico de Auditoria</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja apagar permanentemente todos os registros de auditoria? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogoAberto(false)} disabled={limpando}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void limparHistorico()} disabled={limpando}>
              {limpando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sim, apagar tudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando histórico...
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">Erro ao carregar histórico de auditoria</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Verifique as políticas de acesso (RLS) da tabela <code>auditoria</code> no Supabase.
            </p>
          </div>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            <p className="mb-3 text-xs text-muted-foreground">{lista.length} registro{lista.length !== 1 ? "s" : ""} encontrado{lista.length !== 1 ? "s" : ""}.</p>
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
