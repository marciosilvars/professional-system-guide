-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- TIMESTAMP HELPER
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NEW USER HANDLER (first user becomes admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_count INT;
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO existing_count FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN existing_count = 0 THEN 'admin'::public.app_role ELSE 'supervisor'::public.app_role END)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- MOTORISTAS
CREATE TABLE public.motoristas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  tipo_veiculo TEXT NOT NULL DEFAULT 'Utilitário',
  prioritario BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultima_escala DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motoristas TO authenticated;
GRANT ALL ON public.motoristas TO service_role;
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "motoristas_select" ON public.motoristas FOR SELECT TO authenticated USING (true);
CREATE POLICY "motoristas_insert" ON public.motoristas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "motoristas_update" ON public.motoristas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "motoristas_delete_admin" ON public.motoristas FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER motoristas_updated_at BEFORE UPDATE ON public.motoristas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ESCALAS
CREATE TABLE public.escalas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL UNIQUE,
  vagas_utilitario INT NOT NULL DEFAULT 0,
  vagas_van INT NOT NULL DEFAULT 0,
  vagas_passeio INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'previa',
  observacoes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalas TO authenticated;
GRANT ALL ON public.escalas TO service_role;
ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escalas_select" ON public.escalas FOR SELECT TO authenticated USING (true);
CREATE POLICY "escalas_insert" ON public.escalas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "escalas_update" ON public.escalas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "escalas_delete_admin" ON public.escalas FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER escalas_updated_at BEFORE UPDATE ON public.escalas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ITENS DA ESCALA
CREATE TABLE public.escala_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id UUID NOT NULL REFERENCES public.escalas(id) ON DELETE CASCADE,
  motorista_id UUID REFERENCES public.motoristas(id) ON DELETE SET NULL,
  motorista_nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  dsp TEXT NOT NULL DEFAULT '',
  veiculo TEXT NOT NULL DEFAULT '',
  onda TEXT NOT NULL DEFAULT '',
  ordem INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'escalado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX escala_itens_escala_idx ON public.escala_itens(escala_id);
CREATE INDEX escala_itens_motorista_idx ON public.escala_itens(motorista_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escala_itens TO authenticated;
GRANT ALL ON public.escala_itens TO service_role;
ALTER TABLE public.escala_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escala_itens_select" ON public.escala_itens FOR SELECT TO authenticated USING (true);
CREATE POLICY "escala_itens_insert" ON public.escala_itens FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "escala_itens_update" ON public.escala_itens FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "escala_itens_delete" ON public.escala_itens FOR DELETE TO authenticated USING (true);
CREATE TRIGGER escala_itens_updated_at BEFORE UPDATE ON public.escala_itens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- AUDITORIA
CREATE TABLE public.auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL DEFAULT '',
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  detalhes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_created_idx ON public.auditoria(created_at DESC);
GRANT SELECT, INSERT ON public.auditoria TO authenticated;
GRANT ALL ON public.auditoria TO service_role;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auditoria_select" ON public.auditoria FOR SELECT TO authenticated USING (true);
CREATE POLICY "auditoria_insert" ON public.auditoria FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());