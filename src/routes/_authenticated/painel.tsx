import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  Users,
  CheckCircle2,
  XCircle,
  Star,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatarDataBR, hojeISO, type Escala, type EscalaItem, type Motorista } from "@/lib/betaxlog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel do dia — BETAXLOG" }, // Corrigido: "â€”" para "—"
      {
        name: "description",
        content:
          "Visão geral da operação BETAXLOG: escala do dia, motoristas ativos e situação das rotas.", // Corrigido: "VisĂŁo geral da operaĂ§ĂŁo"
      },
      { property: "og:title", content: "Painel do dia — BETAXLOG" }, // Corrigido: "â€”" para "—"
      {
        property: "og:description",
        content: "Resumo diário da frota, das vagas preenchidas e das rotas concluídas.", // Corrigido: "Resumo diĂˇrio da frota, das vagas preenchidas e das rotas concluĂ­das."
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PainelPage,
});

function PainelPage() {
  const hoje = hojeISO();

  const { data, isLoading } = useQuery({
    queryKey: ["painel", hoje],
    queryFn: async (): Promise<{
      motoristas: Motorista[];
      escala: Escala | null;
      itens: EscalaItem[];
    }> => {
      const [mot, esc] = await Promise.all([
        supabase.from("motoristas").select("*").order("nome"),
        supabase.from("escalas").select("*").eq("data", hoje).maybeSingle(),
      ]);
      if (mot.error) throw mot.error;
      if (esc.error) throw esc.error;
      let itens: EscalaItem[] = [];
      if (esc.data) {
        const res = await supabase
          .from("escala_itens")
          .select("*")
          .eq("escala_id", esc.data.id)
          .order("ordem");
        if (res.error) throw res.error;
        itens = res.data;
      }
      return { motoristas: mot.data, escala: esc.data, itens };
    },
  });

  const motoristas = data?.motoristas ?? [];
  const itens = data?.itens ?? [];
  const ativos = motoristas.filter((m) => m.ativo);
  const concluidas = itens.filter((i) => i.status === "concluido").length;
  const canceladas = itens.filter((i) => i.status === "cancelado").length;
  const escala = data?.escala ?? null;

  const cards = [
    { label: "Motoristas ativos", valor: ativos.length, icone: Users },
    { label: "Vagas de hoje", valor: itens.length, icone: CalendarRange },
    { label: "Rotas concluídas", valor: concluidas, icone: CheckCircle2 },
    { label: "Rotas canceladas", valor: canceladas, icone: XCircle },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Painel do dia</h1>
          <p className="text-sm text-muted-foreground">
            Operação de {formatarDataBR(hoje)} em um relance. {/* Corrigido: "OperaĂ§ĂŁo" */}
          </p>
        </div>
        <Button asChild>
          <Link to="/escalas">
            Abrir escala do dia <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="surface-panel p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.icone className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {isLoading ? "—" : c.valor} {/* Corrigido: "â€”" para "—" */}
            </p>
          </div>
        ))}
      </section>

      <section className="surface-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Escala de hoje</h2>
          {escala ? (
            <Badge variant={escala.status === "definitiva" ? "default" : "secondary"}>
              {escala.status === "definitiva" ? "Definitiva" : "Prévia"} {/* Corrigido: "PrĂ©via" */}
            </Badge>
          ) : (
            <Badge variant="outline">Não montada</Badge> {/* Corrigido: "NĂŁo montada" */}
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma vaga montada para hoje. Comece pela tela de escalas.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {itens.slice(0, 8).map((i, idx) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="truncate">
                  <span className="mr-2 text-muted-foreground tabular-nums">{idx + 1}.</span>
                  {i.motorista_nome}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {i.veiculo}
                  {i.onda ? ` · Onda ${i.onda}` : ""} {/* Corrigido: "Â·" para "·" */}
                </span>
              </li>
            ))}
            {itens.length > 8 && (
              <li className="py-2.5 text-xs text-muted-foreground">
                +{itens.length - 8} vagas na escala completa
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="surface-panel p-6">
        <h2 className="mb-4 text-lg font-semibold">Motoristas prioritários</h2> {/* Corrigido: "prioritĂˇrios" */}
        {motoristas.filter((m) => m.prioritario && m.ativo).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum motorista prioritário cadastrado.</p> {/* Corrigido: "prioritĂˇrio" */}
        ) : (
          <div className="flex flex-wrap gap-2">
            {motoristas
              .filter((m) => m.prioritario && m.ativo)
              .map((m) => (
                <Badge key={m.id} variant="secondary" className="gap-1.5">
                  <Star className="h-3 w-3 text-warning" />
                  {m.nome}
                </Badge>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
