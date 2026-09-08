import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "operador";

interface AuthState {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  isAdmin: boolean;
  loading: boolean;
  nome: string;
  /** true enquanto o Supabase emitiu PASSWORD_RECOVERY e o usuário ainda não definiu nova senha */
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [nome, setNome] = useState("");
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        // Sessão temporária de recovery — ativa o modo de redefinição de senha
        setSession(nextSession);
        setRecoveryMode(true);
        setLoading(false);
        // Redireciona para a tela de nova senha independente de qual página estiver aberta.
        // Usa sessionStorage como sinalizador para não precisar preservar o hash
        // (reprocessar o hash duas vezes pode invalidar o token de recovery).
        if (typeof window !== "undefined" && window.location.pathname !== "/reset-password") {
          sessionStorage.setItem("btx_recovery_pending", "1");
          window.location.replace("/reset-password");
        }
        return;
      }

      if (event === "USER_UPDATED" && recoveryMode) {
        // Senha foi atualizada — sai do recovery mode, deixa roteamento normal.
        setRecoveryMode(false);
      }

      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        // Garante que o recoveryMode seja limpo se o usuário deslogar ou fizer um novo login.
        setRecoveryMode(false);
        sessionStorage.removeItem("btx_recovery_pending");
      }

      setSession(nextSession);
      setLoading(false);
      if (!nextSession) {
        setRoles([]);
        setNome("");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId || recoveryMode) return;
    let cancelled = false;

    void (async () => {
      const [rolesRes, perfilRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("nome").eq("id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      setRoles((rolesRes.data ?? []).map((r) => r.role as AppRole));
      setNome(perfilRes.data?.nome ?? "");
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, recoveryMode]);

  // Temporizador de Inatividade (30 minutos)
  useEffect(() => {
    if (!userId) return; // Só aplica se estiver logado

    const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
    let idleTimer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Desloga por inatividade
        void supabase.auth.signOut().then(() => {
          if (typeof window !== "undefined") {
            window.location.replace("/auth?motivo=inatividade");
          }
        });
      }, TIMEOUT_MS);
    };

    // Inicia o timer
    resetTimer();

    // Eventos que indicam atividade do usuário
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((evento) => window.addEventListener(evento, resetTimer));

    return () => {
      clearTimeout(idleTimer);
      eventos.forEach((evento) => window.removeEventListener(evento, resetTimer));
    };
  }, [userId]);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      roles,
      isAdmin: roles.includes("admin"),
      loading,
      nome,
      recoveryMode,
      clearRecoveryMode: () => setRecoveryMode(false),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, roles, loading, nome, recoveryMode],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
