import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatarDataBR, type EscalaItem } from "@/lib/betaxlog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — BETAXLOG" }, // Corrigido: "Relatórios â€” BETAXLOG"
      {
        name: "description",
        content: "Indicadores de escalas, rotas concluídas, cancelamentos e ranking de motoristas.",
      },
      { property: "og:title", content: "Relatórios — BETAXLOG" }, // Corrigido: "Relatórios â€” BETAXLOG"
      {
        property: "og:description",
        content: "Acompanhe produtividade da frota e exporte relatórios em Excel ou PDF.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RelatoriosPage,
});

type Linha = EscalaItem & { escalas: { data: string } | null };

const CORES = ["oklch(0.55 0.16 255)", "oklch(0.65 0.15 150)", "oklch(0.62 0.2 25)"];

function RelatoriosPage() {
  const hoje = new Date();
  const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const [inicio, setInicio] = useState(primeiro.toISOString().slice(0, 10));
  const [fim, setFim] = useState(hoje.toISOString().slice(0, 10));

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["relatorio", inicio, fim],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await supabase
        .from("escala_itens")
        .select("*, escalas!inner(data)")
        .gte("escalas.data", inicio)
        .lte("escalas.data", fim);
      if (error) throw error;
      return data as unknown as Linha[];
    },
  });

  const kpis = useMemo(() => {
    const total = linhas.length;
    const concluidas = linhas.filter((l) => l.status === "concluido").length;
    const canceladas = linhas.filter((l) => l.status === "cancelado").length;
    const dias = new Set(linhas.map((l) => l.escalas?.data)).size;
    return {
      total,
      concluidas,
      canceladas,
      dias,
      taxa: total ? Math.round((concluidas / total) * 100) : 0,
    };
  }, [linhas]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, number>();
    linhas.forEach((l) => {
      const dia = l.escalas?.data ?? "";
      mapa.set(dia, (mapa.get(dia) ?? 0) + 1);
    });
    return Array.from(mapa.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, qtd]) => ({ dia: formatarDataBR(dia).slice(0, 5), qtd }));
  }, [linhas]);

  const porStatus = useMemo(
    () => [
      { name: "Escaladas", value: linhas.filter((l) => l.status === "escalado").length },
      { name: "Concluídas", value: kpis.concluidas },
      { name: "Canceladas", value: kpis.canceladas },
    ],
    [linhas, kpis],
  );

  const ranking = useMemo(() => {
    const mapa = new Map<string, number>();
    linhas
      .filter((l) => l.motorista_id)
      .forEach((l) => mapa.set(l.motorista_nome, (mapa.get(l.motorista_nome) ?? 0) + 1));
    return Array.from(mapa.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([nome, escalas]) => ({ nome, escalas }));
  }, [linhas]);

  const exportarExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(ranking.map((r) => ({ Motorista: r.nome, Escalas: r.escalas }))),
      "Ranking",
    );
    XLSX.writeFile(wb, `relatorio-betaxlog-${inicio}_${fim}.xlsx`);
  };

  const exportarPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("BETAXLOG — Relatório de escalas", 14, 18);
    doc.setFontSize(10);
    doc.text(`Período: ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`, 14, 26);
    doc.text(
      `Vagas: ${kpis.total} · Concluídas: ${kpis.concluidas} · Canceladas: ${kpis.canceladas} · Dias: ${kpis.dias}`,
      14,
      32,
    );
    autoTable(doc, {
      startY: 40,
      head: [["Motorista", "Escalas"]],
      body: ranking.map((r) => [r.nome, String(r.escalas)]),
    });
    doc.save(`relatorio-betaxlog-${inicio}_${fim}.pdf`);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Indicadores da operação no período selecionado.
        </p>
      </header>

      <section className="surface-panel flex flex-wrap items-end gap-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="ini">Início</Label>
          <Input id="ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fim">Fim</Label>
          <Input id="fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div className="ml-auto flex gap-3">
          <Button variant="outline" onClick={() => void exportarExcel()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => void exportarPdf()}>
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Vagas no período", valor: kpis.total },
          { label: "Rotas concluídas", valor: kpis.concluidas },
          { label: "Cancelamentos", valor: kpis.canceladas },
          { label: "Taxa de conclusão", valor: `${kpis.taxa}%` },
        ].map((kpi) => (
          <div key={kpi.label} className="surface-panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className="mt-2 text-3xl font-bold text-primary">{kpi.valor}</p>
          </div>
        ))}
      </section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando indicadores...</p>
      ) : (
        <>
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="surface-panel p-6">
              <h2 className="mb-4 text-lg font-semibold">Vagas por dia</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porDia}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="dia" fontSize={12} />
                    <YAxis fontSize={12} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill={CORES[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="surface-panel p-6">
              <h2 className="mb-4 text-lg font-semibold">Situação das rotas</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={porStatus} dataKey="value" nameKey="name" outerRadius={90} label>
                      {porStatus.map((_, i) => (
                        <Cell key={i} fill={CORES[i % CORES.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="surface-panel p-6">
            <h2 className="mb-4 text-lg font-semibold">Ranking de motoristas</h2>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">#</th>
                    <th className="py-2">Motorista</th>
                    <th className="py-2 text-right">Escalas</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => (
                    <tr key={r.nome} className="border-b border-border/60">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 font-medium">{r.nome}</td>
                      <td className="py-2 text-right">{r.escalas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
