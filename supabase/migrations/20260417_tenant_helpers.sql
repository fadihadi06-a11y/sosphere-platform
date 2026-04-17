-- D-C1: authoritative company_id resolver
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT company_id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;
