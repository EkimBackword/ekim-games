BEGIN;
ALTER TABLE "ChatMessage" ADD COLUMN "position" BIGINT, ADD COLUMN "clientMessageId" UUID;

WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS "position"
  FROM "ChatMessage"
)
UPDATE "ChatMessage" AS message
SET "position" = ordered."position"
FROM ordered
WHERE ordered."id" = message."id";

ALTER TABLE "ChatMessage" ALTER COLUMN "position" SET NOT NULL;
CREATE UNIQUE INDEX "ChatMessage_position_key" ON "ChatMessage"("position");
CREATE UNIQUE INDEX "ChatMessage_userId_clientMessageId_key" ON "ChatMessage"("userId", "clientMessageId");

CREATE TABLE "ChatPosition" (
  "id" INTEGER NOT NULL,
  "position" BIGINT NOT NULL,
  CONSTRAINT "ChatPosition_pkey" PRIMARY KEY ("id")
);
INSERT INTO "ChatPosition" ("id", "position")
SELECT 1, COALESCE(max("position"), 0) FROM "ChatMessage";
COMMIT;
