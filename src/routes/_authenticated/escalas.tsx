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
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { toPng } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  DSP_PADRAO,
  STATUS_ITEM_LABEL,
  VAGA_LIVRE,
  formatarDataBR,
  gerarItensEscala,
  hojeISO,
  normalizarHorario,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/escalas")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de Rotas — BETAXLOG" },
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

// Número do grupo de WhatsApp para envio
const WHATSAPP_GRUPO = ""; // Preencha com o número do grupo se disponível

function EscalasPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const capturaRef = useRef<HTMLDivElement>(null);
  const imagemRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState(hojeISO());
  const [vagas, setVagas] = useState({ utilitario: 0, van: 0, passeio: 0 });
  const [itens, setItens] = useState<NovoItem[]>([]);
  const [indisponiveis, setIndisponiveis] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [dialogoWhatsApp, setDialogoWhatsApp] = useState(false);
  // Diálogo de cancelamento de rota
  const [rotaCancelando, setRotaCancelando] = useState<{ idx: number; item: NovoItem } | null>(null);

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
        horario: (i as any).horario ?? "",
        ordem: i.ordem,
        status: i.status as StatusItem,
        prioritario: !!(motoristasQuery.data?.find((m) => m.id === i.motorista_id)?.prioritario),
      })),
    );
  }, [escalaQuery.data, escala, itensSalvos, motoristasQuery.data]);

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

  const persistir = async (status: "previa" | "definitiva") => {
    if (itens.length === 0) {
      toast.warning("Gere a prévia da escala antes de salvar.");
      return;
    }

    // Validação: todos os horários devem estar preenchidos
    const itensSemHorario = itens.filter(
      (i) => i.status !== "cancelado" && (!i.horario || !i.horario.trim())
    );
    if (itensSemHorario.length > 0) {
      toast.warning(
        `Preencha o horário de todos os motoristas antes de salvar. ${itensSemHorario.length} vaga${itensSemHorario.length > 1 ? "s" : ""} sem horário.`
      );
      return;
    }

    setSalvando(true);
    try {
      const { data: userData } = await supabase.auth.getUser();

      // --- 1. Resolve a escala: busca existente ou cria nova ---
      let escalaSalva: { id: string } | null = null;

      // Tenta buscar escala existente para esta data
      const { data: escalaExistente, error: erroBusca } = await supabase
        .from("escalas")
        .select("id")
        .eq("data", data)
        .maybeSingle();
      if (erroBusca) throw erroBusca;

      if (escalaExistente) {
        // Atualiza escala existente
        const { data: atualizada, error: erroUpdate } = await supabase
          .from("escalas")
          .update({
            vagas_utilitario: vagas.utilitario,
            vagas_van: vagas.van,
            vagas_passeio: vagas.passeio,
            status,
            indisponiveis: Array.from(indisponiveis),
          })
          .eq("id", escalaExistente.id)
          .select("id")
          .single();
        if (erroUpdate) throw erroUpdate;
        escalaSalva = atualizada;
      } else {
        // Cria nova escala — sem created_by (coluna pode não existir no cache do schema)
        const { data: criada, error: erroInsert } = await supabase
          .from("escalas")
          .insert({
            data,
            vagas_utilitario: vagas.utilitario,
            vagas_van: vagas.van,
            vagas_passeio: vagas.passeio,
            status,
            indisponiveis: Array.from(indisponiveis),
          })
          .select("id")
          .single();
        if (erroInsert) throw erroInsert;
        escalaSalva = criada;
      }

      if (!escalaSalva) throw new Error("Não foi possível obter o ID da escala.");

      // --- 2. Apaga itens antigos e insere os novos ---
      await supabase.from("escala_itens").delete().eq("escala_id", escalaSalva.id);

      // Tenta primeiro com a coluna horario
      const payloadComHorario = itens.map((i, idx) => ({
        motorista_id: i.motorista_id,
        motorista_nome: i.motorista_nome,
        telefone: i.telefone ?? "",
        dsp: i.dsp || DSP_PADRAO,
        veiculo: i.veiculo,
        onda: i.onda ?? "",
        horario: i.horario ?? "",
        ordem: idx,
        status: i.status,
        escala_id: escalaSalva.id,
      }));

      let { error: erroItens } = await supabase
        .from("escala_itens")
        .insert(payloadComHorario as any);

      // Fallback: se banco ainda não tem coluna horario, envia sem ela
      if (erroItens && (erroItens.message?.includes("horario") || erroItens.message?.includes("column"))) {
        const payloadSemHorario = itens.map((i, idx) => ({
          motorista_id: i.motorista_id,
          motorista_nome: i.motorista_nome,
          telefone: i.telefone ?? "",
          dsp: i.dsp || DSP_PADRAO,
          veiculo: i.veiculo,
          onda: i.horario || i.onda || "",
          ordem: idx,
          status: i.status,
          escala_id: escalaSalva.id,
        }));
        const retry = await supabase.from("escala_itens").insert(payloadSemHorario);
        erroItens = retry.error;
      }
      if (erroItens) throw erroItens;

      // --- 3. Atualiza ultima_escala dos motoristas (apenas na definitiva) ---
      if (status === "definitiva") {
        const ids = itens.map((i) => i.motorista_id).filter(Boolean) as string[];
        if (ids.length > 0) {
          await supabase.from("motoristas").update({ ultima_escala: data }).in("id", ids);
        }
      }

      // --- 4. Registra auditoria ---
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
      // Mostra a mensagem real do erro para facilitar diagnóstico
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      toast.error(`Erro ao salvar: ${msg}`);
      console.error("[persistir] erro:", e);
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
      atualizarItem(idx, { motorista_id: null, motorista_nome: VAGA_LIVRE, telefone: "", prioritario: false });
      return;
    }
    const m = motoristas.find((x) => x.id === motoristaId);
    if (!m) return;
    atualizarItem(idx, {
      motorista_id: m.id,
      motorista_nome: m.nome,
      telefone: m.telefone,
      veiculo: m.tipo_veiculo,
      prioritario: !!m.prioritario,
    });
  };

  // Avança para o próximo campo de horário ao pressionar Enter e normaliza o valor
  const handleHorarioKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = (e.target as HTMLInputElement).value;
      const res = normalizarHorario(raw);
      if (res.valido && res.valor) {
        atualizarItem(idx, { horario: res.valor });
      }
      const next = document.getElementById(`horario-${idx + 1}`);
      if (next) {
        (next as HTMLInputElement).focus();
        (next as HTMLInputElement).select?.();
      }
    }
  };

  const handleHorarioBlur = (val: string, idx: number) => {
    if (!val.trim()) return;
    const res = normalizarHorario(val);
    if (res.valido && res.valor) {
      atualizarItem(idx, { horario: res.valor });
    }
  };

  const abrirWhatsApp = async () => {
    const confirmados = itens.filter(
      (i) => i.status === "confirmado" && i.motorista_id && i.motorista_nome !== VAGA_LIVRE,
    );
    if (confirmados.length === 0) {
      toast.warning("Aviso: Nenhum motorista com situação 'Confirmado' na escala.");
    }

    const texto = textoWhatsApp(data, itens);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        toast.success("Texto da escala copiado para a área de transferência!");
      }
    } catch {
      // Ignora erro de clipboard se bloqueado pelo navegador
    }

    // Abre a API do WhatsApp com o texto pré-carregado (permite escolher o grupo de destino)
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setDialogoWhatsApp(false);
  };

  const gerarImagem = async () => {
    const alvo = imagemRef.current;
    if (!alvo) return;
    try {
      toast.info("Gerando imagem da escala...");

      // Move temporariamente para posição visível controlada no topo para captura fiel
      alvo.style.left = "0px";
      alvo.style.top = "0px";
      alvo.style.opacity = "1";
      alvo.style.zIndex = "99999";

      // Aguarda um pequeno instante para o navegador atualizar o layout (reflow)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const dataUrl = await toPng(alvo, {
        backgroundColor: "#ffffff",
        pixelRatio: window.devicePixelRatio || 2, // Alta qualidade
      });

      // Restaura para oculto
      alvo.style.left = "-9999px";
      alvo.style.top = "0px";
      alvo.style.opacity = "0";
      alvo.style.zIndex = "-100";

      const link = document.createElement("a");
      link.download = `escala-betaxlog-${data}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Imagem gerada e baixada com sucesso!");
    } catch (erro) {
      console.error("Erro completo ao gerar imagem (html2canvas):", erro);
      if (alvo) {
        alvo.style.left = "-9999px";
        alvo.style.top = "0px";
        alvo.style.opacity = "0";
        alvo.style.zIndex = "-100";
      }
      toast.error(
        "Não foi possível gerar a imagem. Verifique o console do navegador para detalhes."
      );
    }
  };

  const exportarExcel = async () => {
    const XLSX = await import("xlsx");
    const linhas = itens.map((i, idx) => ({
      "#": idx + 1,
      DSP: i.dsp,
      Motorista: i.motorista_nome,
      Telefone: i.telefone,
      Veículo: i.veiculo,
      "Horário/ ONDA": i.horario,
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

  const listaFiltrada = motoristas.filter((m) => {
    if (!busca.trim()) return true; // sem busca, mostra todos
    const nomeNormalizado = (m.nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const buscaNormalizada = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return nomeNormalizado.includes(buscaNormalizada);
  });

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
          <h2 className="mb-4 text-lg font-semibold">2. Escala Gerada</h2>

          {/* Tabela para operadores — com marcação de prioritário */}
          <div ref={capturaRef} className="overflow-x-auto rounded-lg border border-border bg-card p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">DSP</th>
                  <th className="py-2 pr-3">Motorista</th>
                  <th className="py-2 pr-3">Veículo</th>
                  <th className="py-2 pr-3">Horário/ ONDA</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2 pr-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, idx) => (
                  <tr
                    key={idx}
                    className={
                      item.status === "cancelado" || item.status === "falta"
                        ? "border-b border-border/60 text-muted-foreground line-through opacity-60"
                        : "border-b border-border/60"
                    }
                  >
                    {/* DSP fixo — apenas leitura */}
                    <td className="py-2 pr-3">
                      <div className="flex h-8 w-28 items-center rounded-md border border-border bg-muted px-2 text-sm font-medium">
                        {DSP_PADRAO}
                      </div>
                    </td>

                    {/* Motorista — fixo, apenas leitura */}
                    <td className="py-2 pr-3 min-w-48">
                      <div className="flex items-center gap-1.5">
                        {item.prioritario && <Star className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                        <span className="font-medium">{item.motorista_nome}</span>
                      </div>
                    </td>

                    {/* Veículo — somente leitura */}
                    <td className="py-2 pr-3">
                      <div className="flex h-8 w-32 items-center rounded-md border border-border bg-muted px-2 text-sm">
                        {item.veiculo || "—"}
                      </div>
                    </td>

                    {/* Horário — editável */}
                    <td className="py-2 pr-3">
                      <Input
                        id={`horario-${idx}`}
                        className="h-8 w-24 font-mono text-center"
                        placeholder="hh:mm"
                        value={item.horario ?? ""}
                        onChange={(e) => {
                          let v = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
                          if (!v.includes(":") && v.length >= 3) {
                            v = v.slice(0, 2) + ":" + v.slice(2, 4);
                          }
                          atualizarItem(idx, { horario: v });
                        }}
                        onBlur={(e) => handleHorarioBlur(e.target.value, idx)}
                        onKeyDown={(e) => handleHorarioKeyDown(e, idx)}
                        disabled={definitiva}
                      />
                    </td>

                    {/* Situação — selectável */}
                    <td className="py-2 pr-3">
                      <Select
                        value={item.status}
                        onValueChange={(v) => atualizarItem(idx, { status: v as StatusItem })}
                        disabled={definitiva}
                      >
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="escalado">Escalado</SelectItem>
                          <SelectItem value="confirmado">Confirmado</SelectItem>
                          <SelectItem value="concluido">Concluído</SelectItem>
                          <SelectItem value="cancelado">Cancelado</SelectItem>
                          <SelectItem value="falta">Falta</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>

                    {/* Ações — botão cancelar rota */}
                    <td className="py-2 pr-1 text-center">
                      {!definitiva && item.status !== "cancelado" && (
                        <button
                          type="button"
                          title="Cancelar esta rota"
                          className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => setRotaCancelando({ idx, item })}
                        >
                          <span>&#10005;</span> Cancelar rota
                        </button>
                      )}
                      {!definitiva && item.status === "cancelado" && (
                        <button
                          type="button"
                          title="Reativar rota"
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => atualizarItem(idx, { status: "escalado" })}
                        >
                          ↺ Reativar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Versão limpa para captura de imagem — SEM marcações de prioritário (apenas operador vê) */}
          <div
            ref={imagemRef}
            style={{
              position: "fixed",
              left: "-9999px",
              top: 0,
              width: "920px",
              zIndex: -100,
              opacity: 0,
              backgroundColor: "#ffffff",
            }}
            className="p-8 text-slate-900 font-sans"
            aria-hidden="true"
          >
            <div className="mb-6 flex items-center justify-between border-b-2 border-blue-600 pb-4">
              <div>
                <h1 className="text-2xl font-black tracking-wider text-blue-700">BETAXLOG</h1>
                <p className="text-sm font-semibold uppercase text-slate-600">
                  Escala de Carregamento — {formatarDataBR(data)}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="font-semibold text-slate-700">DSP BETAXLOG</p>
                <p>Total de rotas: {itens.filter((i) => i.status !== "cancelado").length}</p>
              </div>
            </div>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 text-left text-xs font-bold uppercase tracking-wider text-slate-700">
                  <th className="py-2.5 px-3 text-center">#</th>
                  <th className="py-2.5 px-3">DSP</th>
                  <th className="py-2.5 px-3">Motorista</th>
                  <th className="py-2.5 px-3">Veículo</th>
                  <th className="py-2.5 px-3 text-center">Horário/ ONDA</th>
                  <th className="py-2.5 px-3 text-center">Situação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-200 ${
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/70"
                    } ${item.status === "cancelado" ? "text-slate-400 line-through" : ""}`}
                  >
                    <td className="py-2 px-3 text-center font-semibold text-slate-400">{idx + 1}</td>
                    <td className="py-2 px-3 font-bold text-slate-800">{DSP_PADRAO}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{item.motorista_nome}</td>
                    <td className="py-2 px-3 text-slate-700">{item.veiculo}</td>
                    <td className="py-2 px-3 text-center font-mono font-semibold text-slate-800">{item.horario || "—"}</td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`inline-block rounded px-2.5 py-0.5 text-xs font-semibold ${
                          item.status === "confirmado"
                            ? "bg-green-100 text-green-800"
                            : item.status === "concluido"
                            ? "bg-blue-100 text-blue-800"
                            : item.status === "falta"
                            ? "bg-red-100 text-red-800"
                            : item.status === "cancelado"
                            ? "bg-gray-100 text-gray-600"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {STATUS_ITEM_LABEL[item.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">
              BETAXLOG Transportes e Logística · Escala sujeita a alterações operacionais
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setDialogoWhatsApp(true)}>
              <MessageSquareText className="mr-2 h-4 w-4" /> Copiar para WhatsApp
            </Button>
            <Button variant="outline" onClick={() => void gerarImagem()}>
              <ImageIcon className="mr-2 h-4 w-4" /> Gerar imagem
            </Button>
            <Button variant="outline" onClick={() => void exportarExcel()}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar Excel
            </Button>
          </div>
        </section>
      )}

      {/* Dialog confirmação WhatsApp — envio da escala para o grupo */}
      <Dialog open={dialogoWhatsApp} onOpenChange={setDialogoWhatsApp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Escala para o WhatsApp</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p>
                Você deseja abrir o WhatsApp para enviar a escala para o grupo?
              </p>
              <p className="text-xs text-muted-foreground">
                Será enviada apenas a <strong>marcação (@telefone)</strong> de todos os motoristas escalados para facilitar a notificação no grupo (ex: @51989286869). O texto também será copiado para sua área de transferência.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setDialogoWhatsApp(false)}>
              Não
            </Button>
            <Button onClick={() => void abrirWhatsApp()}>
              Sim, abrir WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de cancelamento de rota com opção de notificar motorista */}
      <Dialog open={!!rotaCancelando} onOpenChange={(v) => { if (!v) setRotaCancelando(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Rota</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p>
                Você está cancelando a rota de <strong>{rotaCancelando?.item.motorista_nome}</strong>.
              </p>
              <p className="text-sm text-muted-foreground">
                Deseja enviar uma mensagem de aviso pelo WhatsApp para o motorista?
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                if (rotaCancelando) atualizarItem(rotaCancelando.idx, { status: "cancelado" });
                setRotaCancelando(null);
              }}
            >
              Cancelar sem avisar
            </Button>
            <Button
              onClick={() => {
                if (rotaCancelando) {
                  atualizarItem(rotaCancelando.idx, { status: "cancelado" });
                  const tel = (rotaCancelando.item.telefone || "").replace(/\D/g, "");
                  const numero = tel ? (tel.startsWith("55") ? tel : `55${tel}`) : "";
                  const msg = mensagemCancelamentoRota(rotaCancelando.item.motorista_nome, data);
                  if (numero) {
                    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
                  } else {
                    toast.warning("Motorista sem telefone cadastrado. Avise manualmente.");
                  }
                  setRotaCancelando(null);
                }
              }}
            >
              <MessageSquareText className="mr-2 h-4 w-4" />
              Cancelar e avisar pelo WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="surface-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              3. Motoristas indisponíveis
              {indisponiveis.size > 0 && (
                <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">
                  {indisponiveis.size} marcado{indisponiveis.size > 1 ? "s" : ""}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Marque os motoristas que não devem entrar no rodízio automático de hoje.
              Total: {motoristas.length} motoristas cadastrados.
            </p>
          </div>
          {indisponiveis.size > 0 && !definitiva && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => setIndisponiveis(new Set())}
            >
              Limpar seleção
            </button>
          )}
        </div>
        {motoristasQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando motoristas...</p>
        ) : motoristas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum motorista cadastrado.</p>
        ) : (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-full max-w-xs pl-9"
                placeholder={`Buscar entre ${motoristas.length} motoristas...`}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="max-h-[400px] overflow-y-auto rounded-md border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {listaFiltrada.map((m) => (
                  <div
                    key={m.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 ${
                      indisponiveis.has(m.id) ? "bg-destructive/10" : ""
                    }`}
                  >
                    <Checkbox
                      id={`indisponivel-${m.id}`}
                      checked={indisponiveis.has(m.id)}
                      onCheckedChange={() => alternarIndisponivel(m.id)}
                      disabled={definitiva}
                    />
                    <Label htmlFor={`indisponivel-${m.id}`} className="cursor-pointer font-normal leading-tight">
                      {m.nome}
                      {!m.ativo && <span className="ml-1 text-xs text-muted-foreground">(inativo)</span>}
                      {m.prioritario && <span className="ml-1 text-amber-400">⭐</span>}
                    </Label>
                  </div>
                ))}
              </div>
              {listaFiltrada.length === 0 && busca && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhum motorista encontrado para "{busca}".
                </p>
              )}
            </div>
            {listaFiltrada.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Exibindo {listaFiltrada.length} de {motoristas.length} motoristas.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
