-- Fix the lookup function's search path without changing mappings or privileges.
set local lock_timeout = '3s';
set local statement_timeout = '25s';
alter function public.catalog_filter_option_id(text) set search_path = pg_catalog;
