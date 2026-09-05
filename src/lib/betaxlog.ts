import type { Tables } from "@/integrations/supabase/types";

export type Motorista = Tables<"motoristas">;
export type Escala = Tables<"escalas">;
export type EscalaItem = Tables<"escala_itens">;
export type Auditoria = Tables<"auditoria">;

export const TIPOS_VEICULO = ["Utilitário", "Van", "Carro de Passeio"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export const DSP_PADRAO = "BETAXLOG";
export const VAGA_LIVRE = "VAGA DISPONÍVEL / SOBRESSALENTE";

export type StatusItem = "escalado" | "concluido" | "cancelado";

export const STATUS_ITEM_LABEL: Record<StatusItem, string> = {
  escalado: "Escalado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export interface NovoItem {
  motorista_id: string | null;
  motorista_nome: string;
  telefone: string;
  dsp: string;
  veiculo: string;
  onda: string;
  ordem: number;
  status: StatusItem;
}

export interface GerarEscalaParams {
  motoristas: Motorista[];
  indisponiveis: Set<string>;
  vagas: { utilitario: number; van: number; passeio: number };
  itensAtuais: EscalaItem[];
}

/**
 * Rodízio justo: dentro de cada tipo de veículo, os motoristas disponíveis são
 * ordenados pela data da última escala (quem está há mais tempo sem escalar vem
 * primeiro) e, como desempate, pelo nome. Motoristas prioritários ficam fora do
 * rodízio automático e só entram por atribuição manual, que é preservada.
 */
export function gerarItensEscala({
  motoristas,
  indisponiveis,
  vagas,
  itensAtuais,
}: GerarEscalaParams): NovoItem[] {
  const porOrdem = [...itensAtuais].sort((a, b) => a.ordem - b.ordem);
  const prioritariosPorId = new Map(
    motoristas.filter((m) => m.prioritario).map((m) => [m.id, m]),
  );

  const disponiveis = motoristas.filter(
    (m) => m.ativo && !m.prioritario && !indisponiveis.has(m.id),
  );

  const fila = (tipo: TipoVeiculo) =>
    disponiveis
      .filter((m) => m.tipo_veiculo === tipo)
      .sort((a, b) => {
        const da = a.ultima_escala ?? "";
        const db = b.ultima_escala ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.nome.localeCompare(b.nome, "pt-BR");
      });

  const filas: Record<TipoVeiculo, Motorista[]> = {
    Utilitário: fila("Utilitário"),
    Van: fila("Van"),
    "Carro de Passeio": fila("Carro de Passeio"),
  };

  const usados = new Set<string>();
  const itens: NovoItem[] = [];

  const processar = (tipo: TipoVeiculo, quantidade: number) => {
    let cursor = 0;
    for (let i = 0; i < quantidade; i++) {
      const ordem = itens.length;
      const anterior = porOrdem[ordem];

      // Preserva atribuição manual de motorista prioritário ainda disponível.
      if (anterior?.motorista_id) {
        const prioritario = prioritariosPorId.get(anterior.motorista_id);
        if (prioritario && !indisponiveis.has(prioritario.id) && prioritario.ativo) {
          usados.add(prioritario.id);
          itens.push({
            motorista_id: prioritario.id,
            motorista_nome: prioritario.nome,
            telefone: prioritario.telefone,
            dsp: anterior.dsp || DSP_PADRAO,
            veiculo: prioritario.tipo_veiculo,
            onda: anterior.onda,
            ordem,
            status: (anterior.status as StatusItem) ?? "escalado",
          });
          continue;
        }
      }

      let escolhido: Motorista | undefined;
      while (cursor < filas[tipo].length && !escolhido) {
        const candidato = filas[tipo][cursor++];
        if (candidato && !usados.has(candidato.id)) escolhido = candidato;
      }

      if (escolhido) {
        usados.add(escolhido.id);
        const historico = porOrdem.find((it) => it.motorista_id === escolhido.id);
        itens.push({
          motorista_id: escolhido.id,
          motorista_nome: escolhido.nome,
          telefone: escolhido.telefone,
          dsp: historico?.dsp || DSP_PADRAO,
          veiculo: escolhido.tipo_veiculo,
          onda: historico?.onda ?? "",
          ordem,
          status: (historico?.status as StatusItem) ?? "escalado",
        });
      } else {
        itens.push({
          motorista_id: null,
          motorista_nome: VAGA_LIVRE,
          telefone: "",
          dsp: DSP_PADRAO,
          veiculo: tipo,
          onda: anterior?.onda ?? "",
          ordem,
          status: "escalado",
        });
      }
    }
  };

  processar("Utilitário", vagas.utilitario);
  processar("Van", vagas.van);
  processar("Carro de Passeio", vagas.passeio);

  return itens;
}

export function formatarDataBR(iso: string | null | undefined): string {
  if (!iso) return "--/--/----";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

export function hojeISO(): string {
  const agora = new Date();
  const offset = agora.getTimezoneOffset() * 60000;
  return new Date(agora.getTime() - offset).toISOString().slice(0, 10);
}

export function formatarTelefone(valor: string): string {
  const num = valor.replace(/\D/g, "").slice(0, 11);
  if (num.length <= 10) {
    return num.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, a, b, c) =>
      [a && `(${a})`, b, c && `-${c}`].filter(Boolean).join(" ").trim(),
    );
  }
  return num.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

/** Mensagem enviada ao motorista quando a rota é cancelada pela Amazon. */
export function mensagemCancelamentoRota(nome: string, data: string): string {
  const primeiroNome = nome.trim().split(/\s+/)[0] ?? "";
  return [
    `Olá, ${primeiroNome}! Aqui é da BETAXLOG.`,
    "",
    `Informamos que sua rota do dia ${formatarDataBR(data)} foi cancelada pela Amazon.`,
    "Esse cancelamento não é por falta sua e não afeta sua posição no rodízio.",
    "Em caso de falta de outro motorista ou rota extra, acionaremos você.",
    "",
    "Obrigado pela compreensão!",
  ].join("\n");
}

/** Monta o link do WhatsApp para o telefone informado (DDI 55 quando ausente). */
export function linkWhatsApp(telefone: string, texto: string): string {
  const digitos = telefone.replace(/\D/g, "");
  const numero = digitos ? (digitos.startsWith("55") ? digitos : `55${digitos}`) : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

export interface LinhaCompartilhavel {
  dsp: string;
  motorista_nome: string;
  telefone?: string;
  veiculo: string;
  onda: string;
  status: string;
}

export function textoWhatsApp(data: string, itens: LinhaCompartilhavel[]): string {
  const ativos = itens.filter((i) => i.status !== "cancelado");
  const linhas = ativos.map(
    (i, idx) =>
      `${idx + 1}. ${i.motorista_nome} — ${i.veiculo}${i.onda ? ` — Onda ${i.onda}` : ""}`,
  );
  const mencoes = ativos
    .map((i) => (i.telefone ?? "").replace(/\D/g, ""))
    .filter((tel) => tel.length >= 10)
    .map((tel) => (tel.startsWith("55") ? `@${tel}` : `@55${tel}`));
  return [
    `🚛 *ESCALA DE CARREGAMENTO - BETAXLOG*`,
    `📅 Data: ${formatarDataBR(data)}`,
    "",
    ...linhas,
    "",
    ...(mencoes.length > 0 ? [...mencoes, ""] : []),
    `Total de rotas: ${linhas.length}`,
  ].join("\n");
}
