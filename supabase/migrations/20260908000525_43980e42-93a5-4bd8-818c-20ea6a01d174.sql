CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id);
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;

-- motoristas
DROP POLICY IF EXISTS motoristas_select ON public.motoristas;
DROP POLICY IF EXISTS motoristas_insert ON public.motoristas;
DROP POLICY IF EXISTS motoristas_update ON public.motoristas;
CREATE POLICY motoristas_select ON public.motoristas FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY motoristas_insert ON public.motoristas FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY motoristas_update ON public.motoristas FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- escalas
DROP POLICY IF EXISTS escalas_select ON public.escalas;
DROP POLICY IF EXISTS escalas_insert ON public.escalas;
DROP POLICY IF EXISTS escalas_update ON public.escalas;
CREATE POLICY escalas_select ON public.escalas FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY escalas_insert ON public.escalas FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY escalas_update ON public.escalas FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- escala_itens
DROP POLICY IF EXISTS escala_itens_select ON public.escala_itens;
DROP POLICY IF EXISTS escala_itens_insert ON public.escala_itens;
DROP POLICY IF EXISTS escala_itens_update ON public.escala_itens;
DROP POLICY IF EXISTS escala_itens_delete ON public.escala_itens;
CREATE POLICY escala_itens_select ON public.escala_itens FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY escala_itens_insert ON public.escala_itens FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY escala_itens_update ON public.escala_itens FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY escala_itens_delete ON public.escala_itens FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

-- auditoria
DROP POLICY IF EXISTS auditoria_select ON public.auditoria;
CREATE POLICY auditoria_select ON public.auditoria FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR user_id = auth.uid());

-- profiles
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- user_roles
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));