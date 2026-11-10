ALTER TABLE "app"."skill_version" ALTER COLUMN "content" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "app"."skill_version" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;

COMMENT ON COLUMN "app"."skill_version"."content" IS 'SKILL.md 指令正文（UTF-8 文本）';
COMMENT ON COLUMN "app"."skill_version"."files" IS '技能资源文件快照（JSONB 数组：path、content、encoding、sizeBytes）';
