import type { Tables } from "@/integrations/supabase/types";

export type Motorista = Tables<"motoristas">;
export type Escala = Tables<"escalas">;
export type EscalaItem = Tables<"escala_itens">;
export type Auditoria = Tables<"auditoria">;

export const TIPOS_VEICULO = ["Utilitário", "Van", "Carro de Passeio"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export const DSP_PADRAO = "BETAXLOG";
export const VAGA_LIVRE = "VAGA DISPONÍVEL / SOBRESSALENTE";

export type StatusItem = "escalado" | "confirmado" | "concluido" | "cancelado" | "falta";

export const STATUS_ITEM_LABEL: Record<StatusItem, string> = {
  escalado: "Escalado",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
  falta: "Falta",
};

export interface NovoItem {
  motorista_id: string | null;
  motorista_nome: string;
  telefone: string;
  dsp: string;
  veiculo: string;
  onda: string;
  horario: string;
  ordem: number;
  status: StatusItem;
  prioritario?: boolean;
}

export interface GerarEscalaParams {
  motoristas: Motorista[];
  indisponiveis: Set<string>;
  vagas: { utilitario: number; van: number; passeio: number };
  itensAtuais: EscalaItem[];
}

/**
 * Normaliza e valida horários digitados (ex: 7 → 07:00, 730 → 07:30, 1830 → 18:30).
 * Intervalo válido: 00:00 até 23:59.
 */
export function normalizarHorario(entrada: string): { valido: boolean; valor: string } {
  if (!entrada || !entrada.trim()) return { valido: true, valor: "" };
  const limpo = entrada.trim();

  let horas = -1;
  let minutos = -1;

  if (limpo.includes(":")) {
    const partes = limpo.split(":");
    if (partes.length === 2) {
      horas = parseInt(partes[0], 10);
      minutos = parseInt(partes[1], 10);
    }
  } else {
    const digitos = limpo.replace(/\D/g, "");
    if (digitos.length === 1 || digitos.length === 2) {
      horas = parseInt(digitos, 10);
      minutos = 0;
    } else if (digitos.length === 3) {
      horas = parseInt(digitos.slice(0, 1), 10);
      minutos = parseInt(digitos.slice(1, 3), 10);
    } else if (digitos.length === 4) {
      horas = parseInt(digitos.slice(0, 2), 10);
      minutos = parseInt(digitos.slice(2, 4), 10);
    }
  }

  if (
    isNaN(horas) ||
    isNaN(minutos) ||
    horas < 0 ||
    horas > 23 ||
    minutos < 0 ||
    minutos > 59
  ) {
    return { valido: false, valor: entrada };
  }

  const hh = String(horas).padStart(2, "0");
  const mm = String(minutos).padStart(2, "0");
  return { valido: true, valor: `${hh}:${mm}` };
}

/**
 * Rodízio justo:
 * 1. Motoristas prioritários NÃO entram no rodízio de datas (não competem na fila de última escala).
 *    Quando disponíveis (não marcados como indisponíveis), são alocados prioritariamente nas vagas
 *    do seu veículo.
 * 2. As vagas restantes são preenchidas pelo rodízio dos motoristas normais (ordenados pela
 *    data da última escala - quem está há mais tempo sem escalar vem primeiro).
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

  // Fila de rodízio: APENAS motoristas não prioritários
  const disponiveisRodizio = motoristas.filter(
    (m) => m.ativo && !m.prioritario && !indisponiveis.has(m.id),
  );

  const filaRodizio = (tipo: TipoVeiculo) =>
    disponiveisRodizio
      .filter((m) => m.tipo_veiculo === tipo)
      .sort((a, b) => {
        const da = a.ultima_escala ?? "";
        const db = b.ultima_escala ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.nome.localeCompare(b.nome, "pt-BR");
      });

  const filas: Record<TipoVeiculo, Motorista[]> = {
    Utilitário: filaRodizio("Utilitário"),
    Van: filaRodizio("Van"),
    "Carro de Passeio": filaRodizio("Carro de Passeio"),
  };

  // Prioritários disponíveis por tipo de veículo (não entram na fila de rodízio)
  const prioritariosDisponiveis = (tipo: TipoVeiculo) =>
    motoristas.filter(
      (m) => m.ativo && m.prioritario && !indisponiveis.has(m.id) && m.tipo_veiculo === tipo,
    );

  const usados = new Set<string>();
  const itens: NovoItem[] = [];

  const processar = (tipo: TipoVeiculo, quantidade: number) => {
    let cursorRodizio = 0;
    const listaPrioritarios = prioritariosDisponiveis(tipo);
    let cursorPrioritario = 0;

    for (let i = 0; i < quantidade; i++) {
      const ordem = itens.length;
      const anterior = porOrdem[ordem];

      // 1. Preserva atribuição anterior caso já seja um prioritário disponível
      if (anterior?.motorista_id) {
        const prioritario = prioritariosPorId.get(anterior.motorista_id);
        if (prioritario && !indisponiveis.has(prioritario.id) && prioritario.ativo && !usados.has(prioritario.id)) {
          usados.add(prioritario.id);
          itens.push({
            motorista_id: prioritario.id,
            motorista_nome: prioritario.nome,
            telefone: prioritario.telefone,
            dsp: anterior.dsp || DSP_PADRAO,
            veiculo: prioritario.tipo_veiculo,
            onda: anterior.onda,
            horario: (anterior as any).horario ?? "",
            ordem,
            status: (anterior.status as StatusItem) ?? "escalado",
            prioritario: true,
          });
          continue;
        }
      }

      // 2. Se houver motoristas prioritários disponíveis do tipo que ainda não foram usados, aloca-os primeiro
      let escolhido: Motorista | undefined;
      let ehPrioritario = false;

      while (cursorPrioritario < listaPrioritarios.length && !escolhido) {
        const cand = listaPrioritarios[cursorPrioritario++];
        if (cand && !usados.has(cand.id)) {
          escolhido = cand;
          ehPrioritario = true;
        }
      }

      // 3. Se não houver mais prioritários, pega da fila de rodízio normal
      if (!escolhido) {
        while (cursorRodizio < filas[tipo].length && !escolhido) {
          const cand = filas[tipo][cursorRodizio++];
          if (cand && !usados.has(cand.id)) {
            escolhido = cand;
            ehPrioritario = false;
          }
        }
      }

      if (escolhido) {
        usados.add(escolhido.id);
        const historico = porOrdem.find((it) => it.motorista_id === escolhido!.id);
        itens.push({
          motorista_id: escolhido.id,
          motorista_nome: escolhido.nome,
          telefone: escolhido.telefone,
          dsp: historico?.dsp || DSP_PADRAO,
          veiculo: escolhido.tipo_veiculo,
          onda: historico?.onda ?? anterior?.onda ?? "",
          horario: (historico as any)?.horario ?? (anterior as any)?.horario ?? "",
          ordem,
          status: (historico?.status as StatusItem) ?? "escalado",
          prioritario: ehPrioritario,
        });
      } else {
        // Vaga sobressalente / livre
        itens.push({
          motorista_id: null,
          motorista_nome: VAGA_LIVRE,
          telefone: "",
          dsp: DSP_PADRAO,
          veiculo: tipo,
          onda: anterior?.onda ?? "",
          horario: (anterior as any)?.horario ?? "",
          ordem,
          status: "escalado",
          prioritario: false,
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
  horario?: string;
  status: string;
}

export function textoWhatsApp(data: string, itens: (NovoItem | LinhaCompartilhavel)[]): string {
  // Pega todos os motoristas escalados que não estão cancelados, não são vaga livre e possuem telefone
  const ativos = itens.filter(
    (i) => i.status !== "cancelado" && i.motorista_nome !== VAGA_LIVRE && !!i.telefone
  );

  // Extrai apenas os números e formata a menção
  const mencoes = ativos
    .map((i) => (i.telefone ?? "").replace(/\D/g, ""))
    .filter((tel) => tel.length >= 10)
    .map((tel) => {
      // Se vier com DDI 55, remove para manter padrão @DDDnumero
      const numLimpo = tel.length >= 12 && tel.startsWith("55") ? tel.slice(2) : tel;
      return `@${numLimpo}`;
    });

  return [
    `🚛 *ESCALA DE CARREGAMENTO — BETAXLOG*`,
    `📅 Data: ${formatarDataBR(data)}`,
    ...mencoes
  ].join("\n");
}
