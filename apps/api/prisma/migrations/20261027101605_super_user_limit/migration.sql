-- At most 3 Super Users (ADR 0004). The application checks this first, for a
-- clear message; this trigger is the backstop that no code path can skip.
CREATE FUNCTION users_super_user_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" = 'SUPER_USER' THEN
    -- One check at a time, so two parallel inserts cannot both see room.
    PERFORM pg_advisory_xact_lock(hashtext('users_super_user_limit'));
    IF (SELECT count(*) FROM "users"
        WHERE "role" = 'SUPER_USER' AND "id" <> NEW."id") >= 3 THEN
      RAISE EXCEPTION 'at most 3 Super Users are allowed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_super_user_limit
  BEFORE INSERT OR UPDATE OF "role" ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_super_user_limit();
