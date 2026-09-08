import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de Rotas — BETAXLOG" },
      { name: "description", content: "Defina sua nova senha para acessar o sistema BETAXLOG." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { recoveryMode } = useAuth();
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    // Se o AuthProvider já detectou PASSWORD_RECOVERY antes desta página carregar,
    // exibimos o formulário imediatamente sem esperar o evento disparar de novo.
    if (recoveryMode) {
      setPronto(true);
      return;
    }

    // Garante que a sessão do hash seja processada pelo SDK
    void supabase.auth.getSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPronto(true);
      }
    });

    // Timeout de segurança: se nenhum sinal chegar em 4s, o link é inválido/expirado
    const timeout = setTimeout(() => {
      setPronto((atual) => {
        if (!atual) {
          toast.error(
            "Link de redefinição inválido ou expirado. Solicite um novo e-mail de recuperação.",
          );
          void navigate({ to: "/auth" });
        }
        return atual;
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, recoveryMode]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();

    if (novaSenha.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      toast.error("As senhas não conferem.");
      return;
    }

    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setSalvando(false);

    if (error) {
      const msg = error.message.toLowerCase();
      let erroTraduzido = "Não foi possível atualizar a senha. Tente novamente.";
      
      if (msg.includes("same") || msg.includes("different") || msg.includes("previously") || msg.includes("used") || msg.includes("recent")) {
        erroTraduzido = "Esta senha já foi utilizada anteriormente. Por favor, escolha uma senha nova.";
      } else if (msg.includes("weak") || msg.includes("character") || msg.includes("at least") || msg.includes("lowercase") || msg.includes("uppercase")) {
        erroTraduzido = "A senha digitada é muito fácil. Escolha uma senha mais forte (letras, números e símbolos).";
      }

      toast.error(erroTraduzido);
      return;
    }

    toast.success("Senha atualizada com sucesso! Faça login com a nova senha.");

    // Encerra a sessão de recovery e redireciona para o login
    await supabase.auth.signOut();
    void navigate({ to: "/auth" });
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Painel lateral decorativo */}
      <section className="bg-brand-gradient hidden flex-col justify-between p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-5 w-5" /> BETAXLOG
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight">
            Redefinição de senha segura.
          </h1>
          <p className="mt-4 max-w-md opacity-85">
            Escolha uma senha forte para manter o acesso à plataforma protegido.
          </p>
        </div>
        <p className="text-sm opacity-70">Acesso restrito à equipe autorizada.</p>
      </section>

      {/* Formulário */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <KeyRound className="h-5 w-5 text-primary" />
            <span className="font-semibold">BETAXLOG</span>
          </div>

          {!pronto ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Verificando link de recuperação…
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-6 flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-primary" />
                <div>
                  <h2 className="text-xl font-semibold">Nova senha</h2>
                  <p className="text-sm text-muted-foreground">
                    Escolha uma senha forte com no mínimo 6 caracteres.
                  </p>
                </div>
              </div>

              <form onSubmit={salvar} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nova-senha">Nova senha</Label>
                  <Input
                    id="nova-senha"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Mínimo 6 caracteres"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmar-senha">Confirmar nova senha</Label>
                  <Input
                    id="confirmar-senha"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    placeholder="Repita a senha"
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                  />
                </div>

                {novaSenha && confirmar && novaSenha !== confirmar && (
                  <p className="text-xs font-medium text-destructive">
                    As senhas não conferem.
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={salvando || !novaSenha || !confirmar}
                >
                  {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar nova senha
                </Button>
              </form>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
