import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Zap,
  Save,
  Lock,
  Trash2,
  Image as ImageIcon,
  MessageSquareText,
  FileSpreadsheet,
  Search,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  DSP_PADRAO,
  STATUS_ITEM_LABEL,
  VAGA_LIVRE,
  formatarDataBR,
  gerarItensEscala,
  hojeISO,
  linkWhatsApp,
  mensagemCancelamentoRota,
  textoWhatsApp,
  type Escala,
  type EscalaItem,
  type Motorista,
  type NovoItem,
  type StatusItem,
} from "@/lib/betaxlog";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/escalas")({
  head: () => ({
    meta: [
      { title: "Escala do dia — BETAXLOG" },
      {
        name: "description",
        content:
          "Monte a escala diária de motoristas com rodízio automático, ondas de carregamento e compartilhamento rápido.",
      },
      { property: "og:title", content: "Escala do dia — BETAXLOG" },
      {
        property: "og:description",
        content: "Rodízio automático de motoristas por tipo de veículo e onda de carregamento.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EscalasPage,
});

function EscalasPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const capturaRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState(hojeISO());
  const [vagas, setVagas] = useState({ utilitario: 0, van: 0, passeio: 0 });
  const [itens, setItens] = useState<NovoItem[]>([]);
  const [indisponiveis, setIndisponiveis] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  const motoristasQuery = useQuery({
    queryKey: ["motoristas"],
    queryFn: async (): Promise<Motorista[]> => {
      const { data, error } = await supabase
        .from("motoristas")
        .select("*")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const escalaQuery = useQuery({
    queryKey: ["escala", data],
    queryFn: async (): Promise<{ escala: Escala | null; itens: EscalaItem[] }> => {
      const { data: escala, error } = await supabase
        .from("escalas")
        .select("*")
        .eq("data", data)
        .maybeSingle();
      if (error) throw error;
      if (!escala) return { escala: null, itens: [] };
      const { data: linhas, error: erroItens } = await supabase
        .from("escala_itens")
        .select("*")
        .eq("escala_id", escala.id)
        .order("ordem", { ascending: true });
      if (erroItens) throw erroItens;
      return { escala, itens: linhas };
    },
  });

  const escala = escalaQuery.data?.escala ?? null;
  const itensSalvos = useMemo(() => escalaQuery.data?.itens ?? [], [escalaQuery.data]);
  const motoristas = useMemo(() => motoristasQuery.data ?? [], [motoristasQuery.data]);
  const definitiva = escala?.status === "definitiva";

  useEffect(() => {
    if (!escalaQuery.data) return;
    if (escala) {
      setVagas({
        utilitario: escala.vagas_utilitario,
        van: escala.vagas_van,
        passeio: escala.vagas_passeio,
      });
      setIndisponiveis(new Set(escala.indisponiveis ?? []));
    } else {
      setVagas({ utilitario: 0, van: 0, passeio: 0 });
      setIndisponiveis(new Set());
    }
    setItens(
      itensSalvos.map((i) => ({
        motorista_id: i.motorista_id,
        motorista_nome: i.motorista_nome,
        telefone: i.telefone,
        dsp: i.dsp,
        veiculo: i.veiculo,
        onda: i.onda,
        ordem: i.ordem,
        status: i.status as StatusItem,
      })),
    );
  }, [escalaQuery.data, escala, itensSalvos]);

  const totalVagas = vagas.utilitario + vagas.van + vagas.passeio;

  const gerar = () => {
    if (totalVagas === 0) {
      toast.warning("Informe ao menos uma vaga para gerar a escala.");
      return;
    }
    const novos = gerarItensEscala({
      motoristas,
      indisponiveis,
      vagas,
      itensAtuais: itensSalvos,
    });
    setItens(novos);
    toast.success(`Prévia gerada com ${novos.length} vagas.`);
  };

  const persistir = async (status: "previa" | "definitiva", lista: NovoItem[] = itens) => {
    const itens = lista;
    if (itens.length === 0) {
      toast.warning("Gere a prévia da escala antes de salvar.");
      return;
    }
    setSalvando(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        data,
        vagas_utilitario: vagas.utilitario,
        vagas_van: vagas.van,
        vagas_passeio: vagas.passeio,
        status,
        indisponiveis: Array.from(indisponiveis),
        created_by: userData.user?.id ?? null,
      };

      const { data: escalaSalva, error } = await supabase
        .from("escalas")
        .upsert(payload, { onConflict: "data" })
        .select()
        .single();
      if (error) throw error;

      await supabase.from("escala_itens").delete().eq("escala_id", escalaSalva.id);
      const { error: erroItens } = await supabase.from("escala_itens").insert(
        itens.map((i, idx) => ({ ...i, ordem: idx, escala_id: escalaSalva.id })),
      );
      if (erroItens) throw erroItens;

      if (status === "definitiva") {
        // Rotas canceladas pela Amazon não contam rodízio: o motorista volta na próxima escala.
        const ids = itens
          .filter((i) => i.status !== "cancelado")
          .map((i) => i.motorista_id)
          .filter(Boolean) as string[];
        if (ids.length > 0) {
          await supabase.from("motoristas").update({ ultima_escala: data }).in("id", ids);
        }
      }

      await registrarAuditoria({
        acao: status === "definitiva" ? "confirmou escala definitiva" : "salvou prévia da escala",
        entidade: "escala",
        entidadeId: escalaSalva.id,
        detalhes: `${formatarDataBR(data)} · ${itens.length} vagas`,
      });

      await queryClient.invalidateQueries({ queryKey: ["escala", data] });
      await queryClient.invalidateQueries({ queryKey: ["motoristas"] });
      toast.success(status === "definitiva" ? "Escala confirmada!" : "Prévia salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a escala.");
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    if (!escala) {
      setItens([]);
      return;
    }
    const { error } = await supabase.from("escalas").delete().eq("id", escala.id);
    if (error) {
      toast.error("Apenas administradores podem excluir escalas.");
      return;
    }
    await registrarAuditoria({
      acao: "excluiu escala",
      entidade: "escala",
      entidadeId: escala.id,
      detalhes: formatarDataBR(data),
    });
    setItens([]);
    await queryClient.invalidateQueries({ queryKey: ["escala", data] });
    toast.success("Escala excluída.");
  };

  const atualizarItem = (idx: number, patch: Partial<NovoItem>) => {
    setItens((atual) => atual.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const trocarMotorista = (idx: number, motoristaId: string) => {
    if (motoristaId === "vago") {
      atualizarItem(idx, { motorista_id: null, motorista_nome: VAGA_LIVRE, telefone: "" });
      return;
    }
    const m = motoristas.find((x) => x.id === motoristaId);
    if (!m) return;
    atualizarItem(idx, {
      motorista_id: m.id,
      motorista_nome: m.nome,
      telefone: m.telefone,
      veiculo: m.tipo_veiculo,
    });
  };

  const cancelarRota = async (idx: number) => {
    const item = itens[idx];
    if (!item) return;
    const proximos = itens.map((it, i) =>
      i === idx ? { ...it, status: "cancelado" as StatusItem } : it,
    );
    setItens(proximos);

    const texto = mensagemCancelamentoRota(item.motorista_nome, data);
    window.open(linkWhatsApp(item.telefone, texto), "_blank", "noopener");

    await registrarAuditoria({
      acao: "cancelou rota",
      entidade: "escala_item",
      entidadeId: item.motorista_id,
      detalhes: `${item.motorista_nome} · ${formatarDataBR(data)}`,
    });

    if (escala) {
      await persistir(escala.status === "definitiva" ? "definitiva" : "previa", proximos);
    }
    toast.success("Rota cancelada e mensagem aberta no WhatsApp.");
  };

  const copiarWhatsApp = async () => {
    const texto = textoWhatsApp(data, itens);
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado para o WhatsApp.");
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    }
  };

  const gerarImagem = async () => {
    if (!capturaRef.current) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(capturaRef.current, { backgroundColor: "#ffffff", scale: 2 });
    const link = document.createElement("a");
    link.download = `escala-betaxlog-${data}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast.success("Imagem gerada.");
  };

  const exportarExcel = async () => {
    const XLSX = await import("xlsx");
    const linhas = itens.map((i, idx) => ({
      "#": idx + 1,
      DSP: i.dsp,
      Motorista: i.motorista_nome,
      Telefone: i.telefone,
      Veículo: i.veiculo,
      Onda: i.onda,
      Situação: STATUS_ITEM_LABEL[i.status],
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Escala");
    XLSX.writeFile(wb, `escala-betaxlog-${data}.xlsx`);
  };

  const alternarIndisponivel = (id: string) => {
    setIndisponiveis((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  };

  const listaFiltrada = motoristas.filter((m) =>
    m.nome.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Escala do dia</h1>
          <p className="text-sm text-muted-foreground">
            Configure as vagas, gere o rodízio e compartilhe com a operação.
          </p>
        </div>
        {escala && (
          <Badge variant={definitiva ? "default" : "secondary"}>
            {definitiva ? "DEFINITIVA" : "PRÉVIA SALVA"}
          </Badge>
        )}
      </header>

      <section className="surface-panel p-6">
        <h2 className="mb-4 text-lg font-semibold">1. Configuração</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="data">Data da escala</Label>
            <Input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v1">Vagas utilitário</Label>
            <Input
              id="v1"
              type="number"
              min={0}
              value={vagas.utilitario}
              onChange={(e) => setVagas({ ...vagas, utilitario: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v2">Vagas van</Label>
            <Input
              id="v2"
              type="number"
              min={0}
              value={vagas.van}
              onChange={(e) => setVagas({ ...vagas, van: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="v3">Vagas passeio</Label>
            <Input
              id="v3"
              type="number"
              min={0}
              value={vagas.passeio}
              onChange={(e) => setVagas({ ...vagas, passeio: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={gerar}>
            <Zap className="mr-2 h-4 w-4" /> Gerar prévia
          </Button>
          <Button variant="outline" onClick={() => void persistir("previa")} disabled={salvando}>
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar prévia
          </Button>
          <Button
            variant="secondary"
            onClick={() => void persistir("definitiva")}
            disabled={salvando}
          >
            <Lock className="mr-2 h-4 w-4" /> Confirmar definitiva
          </Button>
          {isAdmin && escala && (
            <Button variant="destructive" onClick={() => void excluir()}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir escala
            </Button>
          )}
        </div>
      </section>

      {itens.length > 0 && (
        <section className="surface-panel p-6">
          <h2 className="mb-4 text-lg font-semibold">2. Escala gerada</h2>

          <div ref={capturaRef} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-4 border-b border-border pb-3">
              <p className="text-lg font-bold text-primary">BETAXLOG</p>
              <p className="text-sm text-muted-foreground">Data: {formatarDataBR(data)}</p>
            </div>

            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{itens.length} vaga(s) gerada(s)</span>
              <span>{itens.filter((i) => i.status === "cancelado").length} rota(s) cancelada(s)</span>
            </div>
            <div className="max-h-80 overflow-y-auto pr-1">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3">DSP</th>
                      <th className="py-2 pr-3">Motorista</th>
                      <th className="py-2 pr-3">Veículo</th>
                      <th className="py-2 pr-3">Onda</th>
                      <th className="py-2 pr-3">Situação</th>
                      <th className="py-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item, idx) => (
                      <tr
                        key={idx}
                        className={
                          item.status === "cancelado"
                            ? "border-b border-border/60 text-muted-foreground line-through"
                            : "border-b border-border/60"
                        }
                      >
                        <td className="py-2 pr-3">
                          <Input
                            className="h-8 w-28"
                            value={item.dsp}
                            placeholder={DSP_PADRAO}
                            onChange={(e) => atualizarItem(idx, { dsp: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3 min-w-52">
                          <Select
                            value={item.motorista_id ?? "vago"}
                            onValueChange={(v) => trocarMotorista(idx, v)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="vago">{VAGA_LIVRE}</SelectItem>
                              {motoristas.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.prioritario ? "⭐ " : ""}
                                  {m.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{item.veiculo}</td>
                        <td className="py-2 pr-3">
                          <Input
                            className="h-8 w-24"
                            placeholder="07:00"
                            maxLength={5}
                            value={item.onda}
                            onChange={(e) => atualizarItem(idx, { onda: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <Select
                            value={item.status}
                            onValueChange={(v) => atualizarItem(idx, { status: v as StatusItem })}
                          >
                            <SelectTrigger className="h-8 w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(STATUS_ITEM_LABEL) as StatusItem[]).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {STATUS_ITEM_LABEL[s]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          {item.status === "cancelado" ? (
                            <Badge variant="destructive">Rota cancelada</Badge>
                          ) : item.motorista_id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void cancelarRota(idx)}
                            >
                              <XCircle className="mr-2 h-4 w-4" /> Cancelar rota
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void gerarImagem()}>
              <ImageIcon className="mr-2 h-4 w-4" /> Gerar imagem
            </Button>
            <Button variant="outline" onClick={() => void copiarWhatsApp()}>
              <MessageSquareText className="mr-2 h-4 w-4" /> Copiar p/ WhatsApp
            </Button>
            <Button variant="outline" onClick={() => void exportarExcel()}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Baixar Excel
            </Button>
          </div>
        </section>
      )}

      <section className="surface-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            3. Indisponíveis em {formatarDataBR(data)}
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-64 pl-9"
              placeholder="Buscar motorista..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        {motoristasQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando motoristas...</p>
        ) : listaFiltrada.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum motorista cadastrado. Comece pela aba Motoristas.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{listaFiltrada.length} motorista(s)</span>
              <span>{indisponiveis.size} marcado(s) como indisponível</span>
            </div>
            <div className="max-h-80 overflow-y-auto pr-1">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {listaFiltrada.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={indisponiveis.has(m.id)}
                      onCheckedChange={() => alternarIndisponivel(m.id)}
                    />
                    <span className="truncate">
                      {m.prioritario && "⭐ "}
                      {m.nome}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{m.tipo_veiculo}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

      </section>
    </div>
  );
}
