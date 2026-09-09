import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, Search, Star, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import { TIPOS_VEICULO, formatarTelefone, type Motorista } from "@/lib/betaxlog";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/motoristas")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de Rotas — BETAXLOG" },
      {
        name: "description",
        content:
          "Cadastro de motoristas da frota BETAXLOG: veículo, telefone, prioridade e situação.",
      },
      { property: "og:title", content: "Motoristas — BETAXLOG" },
      {
        property: "og:description",
        content: "Gerencie a base de motoristas usada no rodízio automático das escalas.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MotoristasPage,
});

const VAZIO = {
  nome: "",
  telefone: "",
  tipo_veiculo: "Utilitário",
  prioritario: false,
  ativo: true,
};

function MotoristasPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...VAZIO });
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Motorista | null>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const { data: motoristas = [], isLoading } = useQuery({
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

  const recarregar = () => queryClient.invalidateQueries({ queryKey: ["motoristas"] });

  const cadastrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("motoristas")
      .insert({ ...form, nome: form.nome.trim(), created_by: userData.user?.id ?? null })
      .select()
      .single();
    if (error) {
      toast.error("Não foi possível cadastrar o motorista.");
      return;
    }
    await registrarAuditoria({
      acao: "cadastrou motorista",
      entidade: "motorista",
      entidadeId: data.id,
      detalhes: data.nome,
    });
    setForm({ ...VAZIO });
    await recarregar();
    toast.success("Motorista cadastrado.");
  };

  const salvarEdicao = async () => {
    if (!editando) return;
    const original = motoristas.find((m) => m.id === editando.id);
    const nome = editando.nome.trim();
    if (!nome) {
      toast.error("Informe o nome do motorista.");
      return;
    }
    const chave = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
    if (motoristas.some((m) => m.id !== editando.id && chave(m.nome) === chave(nome))) {
      toast.error("Motorista já cadastrado.");
      return;
    }
    const { data: atualizado, error } = await supabase
      .from("motoristas")
      .update({
        nome,
        telefone: editando.telefone,
        tipo_veiculo: editando.tipo_veiculo,
        prioritario: editando.prioritario,
        ativo: editando.ativo,
      })
      .eq("id", editando.id)
      .select()
      .maybeSingle();
    if (error || !atualizado) {
      toast.error("Não foi possível salvar as alterações.");
      return;
    }
    const mudancas: string[] = [];
    const comparar = (campo: string, antes: string, depois: string) => {
      if (antes !== depois) mudancas.push(`${campo}: ${antes} → ${depois}`);
    };
    if (original) {
      comparar("Nome", original.nome, atualizado.nome);
      comparar("Telefone", original.telefone || "—", atualizado.telefone || "—");
      comparar("Veículo", original.tipo_veiculo, atualizado.tipo_veiculo);
      comparar(
        "Prioridade",
        original.prioritario ? "Prioritário" : "Não prioritário",
        atualizado.prioritario ? "Prioritário" : "Não prioritário",
      );
      comparar(
        "Situação",
        original.ativo ? "Ativo" : "Inativo",
        atualizado.ativo ? "Ativo" : "Inativo",
      );
    }
    await registrarAuditoria({
      acao: "editou motorista",
      entidade: "motorista",
      entidadeId: editando.id,
      detalhes: mudancas.length
        ? `${atualizado.nome} — ${mudancas.join("; ")}`
        : `${atualizado.nome} — sem alterações de campos`,
    });
    setEditando(null);
    await recarregar();
    toast.success("Motorista atualizado.");
  };

  const remover = async (m: Motorista) => {
    const { error } = await supabase.from("motoristas").delete().eq("id", m.id);
    if (error) {
      toast.error("Apenas administradores podem excluir motoristas.");
      return;
    }
    await registrarAuditoria({
      acao: "excluiu motorista",
      entidade: "motorista",
      entidadeId: m.id,
      detalhes: m.nome,
    });
    setSelecionados(selecionados.filter((id) => id !== m.id));
    await recarregar();
    toast.success("Motorista excluído.");
  };

  const excluirSelecionados = async () => {
    if (!selecionados.length) return;
    if (!confirm(`Deseja excluir ${selecionados.length} motoristas selecionados?`)) return;
    
    const { error } = await supabase.from("motoristas").delete().in("id", selecionados);
    if (error) {
      toast.error("Apenas administradores podem excluir motoristas.");
      return;
    }
    
    await registrarAuditoria({
      acao: "excluiu motoristas em lote",
      entidade: "motorista",
      detalhes: `${selecionados.length} motoristas`,
    });
    
    setSelecionados([]);
    await recarregar();
    toast.success(`${selecionados.length} motoristas excluídos.`);
  };

  const exportarBackup = async () => {
    const XLSX = await import("xlsx");
    const linhas = motoristas.map((m) => ({
      Nome: m.nome,
      Telefone: m.telefone,
      Veículo: m.tipo_veiculo,
      Prioritário: m.prioritario ? "Sim" : "Não",
      Ativo: m.ativo ? "Sim" : "Não",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Motoristas");
    XLSX.writeFile(wb, "motoristas-betaxlog.xlsx");
  };

  const importarBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const XLSX = await import("xlsx");
    const buffer = await arquivo.arrayBuffer();
    const wb = XLSX.read(buffer);
    const primeira = wb.SheetNames[0];
    if (!primeira) return;
    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[primeira]!);
    const registros = linhas
      .map((l) => ({
        nome: String(l["Nome"] ?? l["nome"] ?? "").trim(),
        telefone: String(l["Telefone"] ?? l["telefone"] ?? "").trim(), // Adicionado .trim()
        tipo_veiculo: String(l["Veículo"] ?? l["Veiculo"] ?? "Utilitário").trim(), // Adicionado .trim()
        prioritario: String(l["Prioritário"] ?? l["Prioritario"] ?? "Não").toLowerCase() === "sim",
        ativo: String(l["Ativo"] ?? "Sim").toLowerCase() !== "não",
      }))
      .filter((r) => r.nome.length > 0);

    if (registros.length === 0) {
      toast.warning("Nenhuma linha válida encontrada na planilha.");
      return;
    }
    const { error } = await supabase.from("motoristas").insert(registros);
    e.target.value = "";
    if (error) {
      toast.error("Falha ao importar a planilha.");
      return;
    }
    await registrarAuditoria({
      acao: "importou motoristas",
      entidade: "motorista",
      detalhes: `${registros.length} registros`,
    });
    await recarregar();
    toast.success(`${registros.length} motoristas importados.`);
  };

  const lista = motoristas.filter((m) =>
    m.nome.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Motoristas Cadastrados</h1>
        <p className="text-sm text-muted-foreground">
          Base usada pelo rodízio automático. Prioritários ficam fora do sorteio e entram por
          atribuição manual.
        </p>
      </header>

      <section className="surface-panel p-6">
        <h2 className="mb-4 text-lg font-semibold">Novo motorista</h2>
        <form onSubmit={cadastrar} className="max-h-80 overflow-y-auto pr-1 grid gap-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="nome">Nome completo</Label>
            <Input
              id="nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tel">Telefone</Label>
            <Input
              id="tel"
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: formatarTelefone(e.target.value) })}
              placeholder="(11) 99999-8888"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="veic">Veículo</Label>
            <Select
              value={form.tipo_veiculo}
              onValueChange={(v) => setForm({ ...form, tipo_veiculo: v })}
            >
              <SelectTrigger id="veic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_VEICULO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 md:col-span-3">
            <Switch
              id="prio"
              checked={form.prioritario}
              onCheckedChange={(v) => setForm({ ...form, prioritario: v })}
            />
            <Label htmlFor="prio" className="font-normal">
              Motorista prioritário (fora do rodízio automático)
            </Label>
          </div>
          <Button type="submit" className="md:justify-self-end">
            <Plus className="mr-2 h-4 w-4" /> Cadastrar
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
          <Button variant="outline" onClick={() => void exportarBackup()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar backup
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload className="mr-2 h-4 w-4" /> Importar planilha
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => void importarBackup(e)}
              />
            </label>
          </Button>
        </div>
      </section>

      <section className="surface-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              Lista de Motoristas <span className="text-muted-foreground">({motoristas.length})</span>
            </h2>
            {isAdmin && selecionados.length > 0 && (
              <Button variant="destructive" size="sm" onClick={excluirSelecionados}>
                <Trash2 className="mr-2 h-4 w-4" /> Excluir ({selecionados.length})
              </Button>
            )}
          </div>
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum motorista encontrado.</p>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {isAdmin && (
                    <th className="py-2 pl-3 pr-2 w-8">
                      <input
                        type="checkbox"
                        checked={selecionados.length === lista.length && lista.length > 0}
                        onChange={(e) =>
                          setSelecionados(e.target.checked ? lista.map((m) => m.id) : [])
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </th>
                  )}
                  <th className="py-2 px-3">Nome</th>
                  <th className="py-2 pr-3">Telefone</th>
                  <th className="py-2 pr-3">Veículo</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id} className="border-b border-border/60 hover:bg-muted/30">
                    {isAdmin && (
                      <td className="py-2.5 pl-3 pr-2">
                        <input
                          type="checkbox"
                          checked={selecionados.includes(m.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelecionados([...selecionados, m.id]);
                            else setSelecionados(selecionados.filter((id) => id !== m.id));
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="py-2.5 px-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        {m.prioritario && <Star className="h-3.5 w-3.5 text-warning" />}
                        {m.nome}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">{m.telefone || "—"}</td>
                    <td className="py-2.5 pr-3">{m.tipo_veiculo}</td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={m.ativo ? "secondary" : "outline"}>
                        {m.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setEditando(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => void remover(m)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={!!editando} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar motorista</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <div className="space-y-2">
                <Label htmlFor="e-nome">Nome</Label>
                <Input
                  id="e-nome"
                  value={editando.nome}
                  onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-tel">Telefone</Label>
                <Input
                  id="e-tel"
                  value={editando.telefone}
                  onChange={(e) =>
                    setEditando({ ...editando, telefone: formatarTelefone(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-veic">Veículo</Label>
                <Select
                  value={editando.tipo_veiculo}
                  onValueChange={(v) => setEditando({ ...editando, tipo_veiculo: v })}
                >
                  <SelectTrigger id="e-veic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_VEICULO.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="e-prio"
                  checked={editando.prioritario}
                  onCheckedChange={(v) => setEditando({ ...editando, prioritario: v })}
                />
                <Label htmlFor="e-prio" className="font-normal">
                  Prioritário
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="e-ativo"
                  checked={editando.ativo}
                  onCheckedChange={(v) => setEditando({ ...editando, ativo: v })}
                />
                <Label htmlFor="e-ativo" className="font-normal">
                  Ativo na operação
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarEdicao()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
