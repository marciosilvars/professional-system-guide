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
      
      const payloadComHorario = itens.map((i, idx) => ({
        motorista_id: i.motorista_id,
        motorista_nome: i.motorista_nome,
        telefone: i.telefone,
        dsp: i.dsp || DSP_PADRAO,
        veiculo: i.veiculo,
        onda: i.onda,
        horario: i.horario,
        ordem: idx,
        status: i.status,
        escala_id: escalaSalva.id,
      }));

      let { error: erroItens } = await supabase.from("escala_itens").insert(payloadComHorario as any);
      
      // Fallback gracioso: caso a coluna horario ainda não tenha sido sincronizada no banco remoto
      if (erroItens && (erroItens.message?.includes("horario") || erroItens.message?.includes("column"))) {
        const payloadSemHorario = itens.map((i, idx) => ({
          motorista_id: i.motorista_id,
          motorista_nome: i.motorista_nome,
          telefone: i.telefone,
          dsp: i.dsp || DSP_PADRAO,
          veiculo: i.veiculo,
          onda: i.onda || i.horario || "",
          ordem: idx,
          status: i.status,
          escala_id: escalaSalva.id,
        }));
        const retry = await supabase.from("escala_itens").insert(payloadSemHorario);
        erroItens = retry.error;
      }
      if (erroItens) throw erroItens;

      if (status === "definitiva") {
        const ids = itens.map((i) => i.motorista_id).filter(Boolean) as string[];
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
      const html2canvas = (await import("html2canvas")).default;

      // Move temporariamente para posição visível controlada no topo para captura fiel
      alvo.style.left = "0px";
      alvo.style.top = "0px";
      alvo.style.opacity = "1";
      alvo.style.zIndex = "99999";

      const canvas = await html2canvas(alvo, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      // Restaura para oculto
      alvo.style.left = "-9999px";
      alvo.style.top = "0px";
      alvo.style.opacity = "0";
      alvo.style.zIndex = "-100";

      const link = document.createElement("a");
      link.download = `escala-betaxlog-${data}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Imagem gerada e baixada com sucesso!");
    } catch {
      if (alvo) {
        alvo.style.left = "-9999px";
        alvo.style.top = "0px";
        alvo.style.opacity = "0";
        alvo.style.zIndex = "-100";
      }
      toast.error("Não foi possível gerar a imagem da escala.");
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
      Onda: i.onda,
      Horário: i.horario,
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
          <h2 className="mb-4 text-lg font-semibold">2. Escala Gerada</h2>

          {/* Tabela para operadores — com marcação de prioritário */}
          <div ref={capturaRef} className="overflow-x-auto rounded-lg border border-border bg-card p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">DSP</th>
                  <th className="py-2 pr-3">Motorista</th>
                  <th className="py-2 pr-3">Veículo</th>
                  <th className="py-2 pr-3">Onda</th>
                  <th className="py-2 pr-3">Horário</th>
                  <th className="py-2 pr-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, idx) => (
                  <tr
                    key={idx}
                    className={
                      item.status === "cancelado" || item.status === "falta"
                        ? "border-b border-border/60 text-muted-foreground line-through"
                        : "border-b border-border/60"
                    }
                  >
                    {/* DSP fixo — apenas leitura */}
                    <td className="py-2 pr-3">
                      <div className="flex h-8 w-28 items-center rounded-md border border-border bg-muted px-2 text-sm font-medium">
                        {DSP_PADRAO}
                      </div>
                    </td>
                    <td className="py-2 pr-3 min-w-52">
                      <div className="flex items-center gap-1">
                        {item.prioritario && (
                          <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" title="Prioritário" />
                        )}
                        <Select
                          value={item.motorista_id ?? "vago"}
                          onValueChange={(v) => trocarMotorista(idx, v)}
                          disabled={definitiva}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Selecionar motorista" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vago">Vaga livre</SelectItem>
                            {motoristas.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.nome}{m.prioritario ? " ⭐" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
                    {/* Veículo — somente leitura */}
                    <td className="py-2 pr-3">
                      <div className="flex h-8 w-32 items-center rounded-md border border-border bg-muted px-2 text-sm">
                        {item.veiculo || "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        className="h-8 w-20"
                        type="number"
                        min={0}
                        value={item.onda}
                        onChange={(e) => atualizarItem(idx, { onda: e.target.value })}
                        disabled={definitiva}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        id={`horario-${idx}`}
                        className="h-8 w-24 font-mono text-center"
                        placeholder="hh:mm"
                        value={item.horario ?? ""}
                        onChange={(e) => {
                          // Permite digitação contínua e aplica formatação automática hh:mm
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
                  <th className="py-2.5 px-3 text-center">Onda</th>
                  <th className="py-2.5 px-3 text-center">Horário</th>
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
                    <td className="py-2 px-3 text-center text-slate-700">{item.onda || "—"}</td>
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

      {/* Dialog confirmação WhatsApp */}
      <Dialog open={dialogoWhatsApp} onOpenChange={setDialogoWhatsApp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Escala para o WhatsApp</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <p>
                Você deseja abrir o WhatsApp para enviar a escala para o grupo?
              </p>
              <p className="text-xs text-muted-foreground">
                Será enviada a listagem das rotas e a <strong>marcação (@telefone)</strong> apenas dos motoristas com situação <strong>Confirmado</strong> (ex: @51989286869). O texto também será copiado para sua área de transferência.
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

      <section className="surface-panel p-6">
        <h2 className="mb-4 text-lg font-semibold">3. Motoristas indisponíveis</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Marque os motoristas que não devem ser incluídos no rodízio automático de hoje.
        </p>
        {motoristasQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando motoristas...</p>
        ) : motoristas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum motorista cadastrado.</p>
        ) : (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-64 pl-9"
                placeholder="Buscar motorista..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {listaFiltrada.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`indisponivel-${m.id}`}
                      checked={indisponiveis.has(m.id)}
                      onCheckedChange={() => alternarIndisponivel(m.id)}
                      disabled={definitiva}
                    />
                    <Label htmlFor={`indisponivel-${m.id}`} className="font-normal">
                      {m.nome}
                      {m.prioritario && <span className="ml-1 text-amber-400">⭐</span>}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
