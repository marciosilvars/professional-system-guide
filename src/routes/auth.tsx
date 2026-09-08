import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Truck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — BETAXLOG" },
      {
        name: "description",
        content: "Acesse o painel BETAXLOG para gerenciar escalas, motoristas e relatórios.",
      },
      { property: "og:title", content: "Entrar — BETAXLOG" },
      {
        property: "og:description",
        content: "Acesso restrito ao painel de gestão de escalas da BETAXLOG.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading, recoveryMode } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mostraRecuperacao, setMostraRecuperacao] = useState(false);
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [enviandoRecuperacao, setEnviandoRecuperacao] = useState(false);

  useEffect(() => {
    // Não redireciona para o painel se o usuário está em recovery mode —
    // ele precisa primeiro definir a nova senha em /reset-password.
    if (!loading && user && !recoveryMode) void navigate({ to: "/escalas" });
    if (!loading && recoveryMode) void navigate({ to: "/reset-password" });
  }, [loading, user, recoveryMode, navigate]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setEnviando(false);
    if (error) {
      toast.error(
        error.message.includes("Invalid login")
          ? "E-mail ou senha incorretos."
          : error.message,
      );
      return;
    }
    toast.success("Bem-vindo de volta!");
    void navigate({ to: "/escalas" });
  };

  const recuperarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviandoRecuperacao(true);
    const { error } = await supabase.auth.resetPasswordForEmail(emailRecuperacao, {
      // Redireciona para a rota exclusiva de redefinição, que escuta PASSWORD_RECOVERY
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setEnviandoRecuperacao(false);
    if (error) {
      toast.error("Não foi possível enviar o e-mail. Verifique o endereço informado.");
      return;
    }
    toast.success("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
    setMostraRecuperacao(false);
    setEmailRecuperacao("");
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="bg-brand-gradient hidden flex-col justify-between p-12 text-primary-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Truck className="h-5 w-5" /> BETAXLOG
        </Link>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight">
            Escalas organizadas, operação sob controle.
          </h1>
          <p className="mt-4 max-w-md opacity-85">
            Rodízio automático, ondas de carregamento, indicadores e histórico auditável
            para toda a equipe de logística.
          </p>
        </div>
        <p className="text-sm opacity-70">Acesso restrito à equipe autorizada.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Truck className="h-5 w-5 text-primary" />
            <span className="font-semibold">BETAXLOG</span>
          </div>

          {mostraRecuperacao ? (
            <div>
              <h2 className="mb-1 text-xl font-semibold">Recuperar senha</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Informe seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
              <form onSubmit={recuperarSenha} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email-recuperacao">E-mail</Label>
                  <Input
                    id="email-recuperacao"
                    type="email"
                    required
                    autoComplete="email"
                    value={emailRecuperacao}
                    onChange={(e) => setEmailRecuperacao(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={enviandoRecuperacao}>
                  {enviandoRecuperacao && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enviar link de recuperação
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setMostraRecuperacao(false)}
                >
                  Voltar para o login
                </Button>
              </form>
            </div>
          ) : (
            <div>
              <h2 className="mb-6 text-xl font-semibold">Entrar no sistema</h2>
              <form onSubmit={entrar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senha">Senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={enviando}>
                  {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Entrar
                </Button>
                <button
                  type="button"
                  onClick={() => setMostraRecuperacao(true)}
                  className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  Esqueci minha senha
                </button>
              </form>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Acesso restrito à equipe autorizada. Novos acessos são criados pelo administrador.
          </p>
        </div>
      </section>
    </main>
  );
}
