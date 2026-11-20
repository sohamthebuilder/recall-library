-- Explainer versions are immutable (ADR 0001): every change creates a new version instead.
CREATE FUNCTION "refuse_explainer_version_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Explainer versions are immutable; create a new version instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "explainer_versions_immutable" BEFORE UPDATE ON "explainer_versions"
  FOR EACH ROW EXECUTE FUNCTION "refuse_explainer_version_update"();
