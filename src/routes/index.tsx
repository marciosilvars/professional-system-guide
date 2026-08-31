import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CalendarRange, BarChart3, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BETAXLOG — Gestão profissional de escalas de motoristas" },
      {
        name: "description",
        content:
          "Monte escalas diárias com rodízio automático, controle motoristas, acompanhe indicadores e mantenha o histórico auditável da operação BETAXLOG.",
      },
      { property: "og:title", content: "BETAXLOG — Gestão profissional de escalas" },
      {
        property: "og:description",
        content:
          "Escalas com rodízio automático, painel de métricas e histórico auditável para a operação logística.",
      },
    ],
  }),
  component: Landing,
});

const RECURSOS = [
  {
    icon: CalendarRange,
    titulo: "Escala em minutos",
    texto:
      "Defina as vagas por tipo de veículo e o rodízio distribui os motoristas de forma justa, respeitando prioritários e indisponíveis.",
  },
  {
    icon: BarChart3,
    titulo: "Métricas da operação",
    texto:
      "KPIs de rotas, taxa de conclusão, evolução no período e ranking de frequência por motorista.",
  },
  {
    icon: ShieldCheck,
    titulo: "Acesso controlado",
    texto:
      "Administradores e supervisores com permissões distintas e histórico auditável de todas as ações.",
  },
];

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/escalas" });
  }, [loading, user, navigate]);

  return (
    <main className="min-h-screen bg-background">
      <header className="bg-brand-gradient text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <Truck className="h-5 w-5" />
            BETAXLOG
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link to="/auth">Entrar</Link>
          </Button>
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-20 pt-10 md:pb-28 md:pt-16">
          <p className="text-sm font-medium uppercase tracking-[0.2em] opacity-80">
            Gestão de escalas
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight md:text-5xl">
            A escala diária da sua frota, organizada e auditável.
          </h1>
          <p className="mt-5 max-w-2xl text-base opacity-90 md:text-lg">
            Cadastro de motoristas, rodízio automático por tipo de veículo, ondas de
            carregamento, compartilhamento em imagem ou WhatsApp e relatórios completos —
            tudo em um único painel na nuvem.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link to="/auth">Acessar o painel</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto -mt-12 max-w-6xl px-6 pb-20">
        <div className="grid gap-5 md:grid-cols-3">
          {RECURSOS.map((r) => (
            <article key={r.titulo} className="surface-panel p-6">
              <r.icon className="h-6 w-6 text-accent" />
              <h2 className="mt-4 text-lg font-semibold">{r.titulo}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{r.texto}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        BETAXLOG · Sistema interno de gestão de escalas
      </footer>
    </main>
  );
}
