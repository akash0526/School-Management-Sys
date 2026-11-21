-- =====================================================================
-- File 98: Attach set_updated_at() to every table that has updated_at
-- =====================================================================
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
        WHERE c.table_schema = 'public'
          AND c.column_name  = 'updated_at'
          AND tb.table_type  = 'BASE TABLE'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t.table_name);
    END LOOP;
END;
$$;
