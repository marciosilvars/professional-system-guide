-- Permite que todos os usuários da equipe (staff) vejam a lista completa de perfis
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- Permite que todos os usuários da equipe (staff) vejam as permissões de todos
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
