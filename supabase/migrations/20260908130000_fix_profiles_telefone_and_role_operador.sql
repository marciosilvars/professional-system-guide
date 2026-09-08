-- 1. Adiciona coluna telefone em profiles (caso não exista)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telefone TEXT NOT NULL DEFAULT '';

-- 2. Adiciona o valor 'operador' ao ENUM app_role (mantendo compatibilidade com 'supervisor')
-- O Supabase não permite DROP de valor de ENUM, então adicionamos 'operador'
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operador';

-- 3. Migra quaisquer registros 'supervisor' existentes para 'operador'
-- (roles antigas do trigger handle_new_user que usava 'supervisor')
UPDATE public.user_roles SET role = 'operador' WHERE role = 'supervisor';

-- 4. Atualiza o trigger handle_new_user para usar 'operador' em vez de 'supervisor'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_count INT;
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO existing_count FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE WHEN existing_count = 0 THEN 'admin'::public.app_role ELSE 'operador'::public.app_role END
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END; $$;

-- 5. Garante que a RLS de profiles permite que admins vejam todos os perfis
-- (já existe, mas recria para garantir que usa o tipo correto)
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 6. Permite INSERT em profiles para usuários autenticados
-- (necessário para que criarUsuario possa fazer upsert via service_role, mas
--  também para o trigger handle_new_user que é SECURITY DEFINER)
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 7. has_role precisa reconhecer 'operador' também (já funciona, mas documentamos)
-- A função has_role já compara com o tipo enum diretamente, sem hardcode de valores.
