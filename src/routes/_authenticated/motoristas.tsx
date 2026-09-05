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
      { title: "Motoristas — BETAXLOG" },
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

  const chave = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
  const nomeExiste = (n: string, ignorarId?: string) =>
    motoristas.some((m) => chave(m.nome) === chave(n) && m.id !== ignorarId);

  const cadastrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    if (nomeExiste(form.nome)) {
      toast.error("Motorista já cadastrado.");
      return;
    }

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
    if (!editando.nome.trim()) return;
    if (nomeExiste(editando.nome, editando.id)) {
      toast.error("Motorista já cadastrado.");
      return;
    }

    const { error } = await supabase
      .from("motoristas")
      .update({
        nome: editando.nome.trim(),
        telefone: editando.telefone,
        tipo_veiculo: editando.tipo_veiculo,
        prioritario: editando.prioritario,
        ativo: editando.ativo,
      })
      .eq("id", editando.id);
    if (error) {
      toast.error("Não foi possível salvar as alterações.");
      return;
    }
    await registrarAuditoria({
      acao: "editou motorista",
      entidade: "motorista",
      entidadeId: editando.id,
      detalhes: editando.nome,
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
    await recarregar();
    toast.success("Motorista excluído.");
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
        telefone: String(l["Telefone"] ?? l["telefone"] ?? ""),
        tipo_veiculo: String(l["Veículo"] ?? l["Veiculo"] ?? "Utilitário"),
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
        <h1 className="text-2xl font-bold">Motoristas</h1>
        <p className="text-sm text-muted-foreground">
          Base usada pelo rodízio automático. Prioritários ficam fora do sorteio e entram por
          atribuição manual.
        </p>
      </header>

      <section className="surface-panel p-6">
        <h2 className="mb-4 text-lg font-semibold">Novo motorista</h2>
        <form onSubmit={cadastrar} className="grid gap-4 md:grid-cols-4">
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
          <h2 className="text-lg font-semibold">
            Cadastrados <span className="text-muted-foreground">({motoristas.length})</span>
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum motorista encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Telefone</th>
                  <th className="py-2 pr-3">Veículo</th>
                  <th className="py-2 pr-3">Situação</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 font-medium">
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
            <div className="space-y-4">
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
