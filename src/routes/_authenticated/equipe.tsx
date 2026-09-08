import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Shield, UserPlus, Loader2, KeyRound, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditoria } from "@/lib/auditoria";
import { criarUsuario, alterarSenhaUsuario } from "@/lib/usuarios.functions";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe — BETAXLOG" },
      {
        name: "description",
        content: "Gerenciamento de usuários e permissões: administradores e operadores.",
      },
      { property: "og:title", content: "Equipe — BETAXLOG" },
      {
        property: "og:description",
        content: "Defina quem é administrador e quem é operador na operação BETAXLOG.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EquipePage,
});

interface Membro {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  papel: "admin" | "operador" | null;
}

function formatarTelefone(valor: string) {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length <= 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
}

function EquipePage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const criarUsuarioFn = useServerFn(criarUsuario);
  const alterarSenhaFn = useServerFn(alterarSenhaUsuario);

  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [novo, setNovo] = useState<{
    nome: string;
    email: string;
    senha: string;
    papel: "admin" | "operador";
    telefone: string;
  }>({ nome: "", email: "", senha: "", papel: "operador", telefone: "" });

  // Dialog de alteração de senha
  const [membroSenha, setMembroSenha] = useState<Membro | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [alterandoSenha, setAlterandoSenha] = useState(false);

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ["equipe"],
    queryFn: async (): Promise<Membro[]> => {
      const [{ data: perfis, error: e1 }, { data: papeis, error: e2 }] = await Promise.all([
        supabase.from("profiles").select("id, nome, email, telefone").order("nome"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return (perfis ?? []).map((p) => ({
        id: p.id,
        nome: p.nome,
        email: p.email,
        telefone: p.telefone ?? "",
        papel: (papeis?.find((r) => r.user_id === p.id)?.role as Membro["papel"]) ?? null,
      }));
    },
  });

  const alterarPapel = async (membro: Membro, papel: "admin" | "operador") => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem alterar permissões.");
      return;
    }
    const { error: erroDel } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", membro.id);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: membro.id, role: papel });
    if (erroDel || error) {
      toast.error("Não foi possível alterar a permissão.");
      return;
    }
    await registrarAuditoria({
      acao: `alterou permissão para ${papel}`,
      entidade: "usuario",
      entidadeId: membro.id,
      detalhes: membro.email,
    });
    await queryClient.invalidateQueries({ queryKey: ["equipe"] });
    toast.success("Permissão atualizada.");
  };

  const enviarNovoUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const criado = await criarUsuarioFn({ data: novo });
      await registrarAuditoria({
        acao: `cadastrou usuário como ${novo.papel}`,
        entidade: "usuario",
        entidadeId: criado.id,
        detalhes: criado.email,
      });
      await queryClient.invalidateQueries({ queryKey: ["equipe"] });
      toast.success("Usuário cadastrado com sucesso.");
      setNovo({ nome: "", email: "", senha: "", papel: "operador", telefone: "" });
      setDialogoAberto(false);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível criar o usuário.");
    } finally {
      setSalvando(false);
    }
  };

  const confirmarAlteracaoSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!membroSenha) return;
    setAlterandoSenha(true);
    try {
      await alterarSenhaFn({ data: { userId: membroSenha.id, novaSenha } });
      await registrarAuditoria({
        acao: "alterou senha",
        entidade: "usuario",
        entidadeId: membroSenha.id,
        detalhes: membroSenha.email,
      });
      toast.success("Senha alterada com sucesso.");
      setMembroSenha(null);
      setNovaSenha("");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível alterar a senha.");
    } finally {
      setAlterandoSenha(false);
    }
  };

  const enviarEmailRecuperacao = async (membro: Membro) => {
    const { error } = await supabase.auth.resetPasswordForEmail(membro.email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) {
      toast.error("Não foi possível enviar o e-mail de recuperação.");
      return;
    }
    toast.success(`E-mail de recuperação enviado para ${membro.email}.`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Equipe</h1>
          <p className="text-sm text-muted-foreground">
            Administradores gerenciam permissões e exclusões; operadores operam as escalas.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" /> Adicionar usuário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo usuário</DialogTitle>
                <DialogDescription>
                  Crie o acesso com e-mail e senha. O usuário já entra liberado na plataforma.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={enviarNovoUsuario} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="novo-nome">Nome</Label>
                  <Input
                    id="novo-nome"
                    required
                    value={novo.nome}
                    onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="novo-email">E-mail</Label>
                  <Input
                    id="novo-email"
                    type="email"
                    required
                    value={novo.email}
                    onChange={(e) => setNovo({ ...novo, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="novo-telefone">Telefone (DDD + número)</Label>
                  <Input
                    id="novo-telefone"
                    type="tel"
                    placeholder="51 98989-8989"
                    value={novo.telefone}
                    onChange={(e) =>
                      setNovo({ ...novo, telefone: formatarTelefone(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nova-senha">Senha provisória</Label>
                  <Input
                    id="nova-senha"
                    type="text"
                    required
                    minLength={6}
                    value={novo.senha}
                    onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Permissão</Label>
                  <Select
                    value={novo.papel}
                    onValueChange={(v) =>
                      setNovo({ ...novo, papel: v as "admin" | "operador" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="operador">Operador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={salvando}>
                    {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Cadastrar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </header>

      {/* Dialog de alteração de senha */}
      <Dialog open={!!membroSenha} onOpenChange={(v) => { if (!v) { setMembroSenha(null); setNovaSenha(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
            <DialogDescription>
              Definindo nova senha para <strong>{membroSenha?.nome}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={confirmarAlteracaoSenha} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nova-senha-modal">Nova senha</Label>
              <Input
                id="nova-senha-modal"
                type="password"
                required
                minLength={6}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row">
              {membroSenha && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => enviarEmailRecuperacao(membroSenha)}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Enviar link por e-mail
                </Button>
              )}
              <Button type="submit" disabled={alterandoSenha} className="w-full sm:w-auto">
                {alterandoSenha && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar nova senha
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="surface-panel p-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando equipe...</p>
        ) : (
          <div className="space-y-3">
            {membros.map((m) => {
              const podeAlterarSenha = isAdmin || m.id === user?.id;
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {m.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.nome} {m.id === user?.id && <Badge variant="outline">você</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    {m.telefone && (
                      <p className="truncate text-xs text-muted-foreground">{m.telefone}</p>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {podeAlterarSenha && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMembroSenha(m)}
                        title="Alterar senha"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    )}
                    {isAdmin ? (
                      <Select
                        value={m.papel ?? "operador"}
                        onValueChange={(v) => void alterarPapel(m, v as "admin" | "operador")}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">
                            <span className="flex items-center gap-1.5">
                              <ShieldCheck className="h-3.5 w-3.5" /> Administrador
                            </span>
                          </SelectItem>
                          <SelectItem value="operador">
                            <span className="flex items-center gap-1.5">
                              <Shield className="h-3.5 w-3.5" /> Operador
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">
                        {m.papel === "admin" ? "Administrador" : "Operador"}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
