import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1779575504085 implements MigrationInterface {
    name = 'InitSchema1779575504085'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."tracked_tokens_status_enum" AS ENUM('ACTIVE', 'DORMANT', 'SHORTED', 'CLOSED', 'ARCHIVED')`);
        await queryRunner.query(`CREATE TABLE "tracked_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "symbol" character varying NOT NULL, "base" character varying NOT NULL, "status" "public"."tracked_tokens_status_enum" NOT NULL DEFAULT 'ACTIVE', "firstDetectedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastSeenPumpingAt" TIMESTAMP WITH TIME ZONE NOT NULL, "archivedAt" TIMESTAMP WITH TIME ZONE, "firstDetectionSnapshot" jsonb NOT NULL, "peakScore" integer NOT NULL, "peakRsi" double precision NOT NULL, "peakChange24h" double precision NOT NULL, "peakPrice" double precision NOT NULL, "peakAt" TIMESTAMP WITH TIME ZONE NOT NULL, "daysActive" integer NOT NULL DEFAULT '1', "scansActive" integer NOT NULL DEFAULT '1', "reappearances" integer NOT NULL DEFAULT '0', "currentScore" integer, "currentVerdict" text, "currentGrades" jsonb, "tradeId" uuid, CONSTRAINT "UQ_713a2fd3b81319ac6b00617cb18" UNIQUE ("tradeId"), CONSTRAINT "uq_user_symbol_first_detected" UNIQUE ("userId", "symbol", "firstDetectedAt"), CONSTRAINT "PK_669988ae7f59bfe500b0bbb07a5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0b67770e739fb8ed724cde3bdc" ON "tracked_tokens"  ("status", "lastSeenPumpingAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_90dd4eb644941ee94abc2703d9" ON "tracked_tokens"  ("userId", "symbol") `);
        await queryRunner.query(`CREATE INDEX "IDX_43f9d19561573e46b54f1c95a3" ON "tracked_tokens"  ("userId", "status") `);
        await queryRunner.query(`CREATE TYPE "public"."trades_result_enum" AS ENUM('WIN', 'LOSS', 'BREAKEVEN')`);
        await queryRunner.query(`CREATE TABLE "trades" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "symbol" character varying NOT NULL, "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "closedAt" TIMESTAMP WITH TIME ZONE, "result" "public"."trades_result_enum", "entrySnapshot" jsonb NOT NULL, "daysActiveAtEntry" integer, "scansActiveAtEntry" integer, "peakScoreAtEntry" integer, "notes" text, "trackedTokenId" uuid, CONSTRAINT "PK_c6d7c36a837411ba5194dc58595" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c759b0f6370d8f16f87c957a71" ON "trades"  ("userId", "closedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_b7735e7cc3ab8dc0e4feb0d657" ON "trades"  ("userId", "openedAt") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL, "email" character varying NOT NULL, "mode" character varying(16) NOT NULL DEFAULT 'STRICT', "thresholds" jsonb NOT NULL DEFAULT '{"pumpPct":80,"topN":30,"minVolUsd":1000000}', "weights" jsonb NOT NULL DEFAULT '{"pump":15,"funding":20,"rsi":10,"divergence":20,"redCandles":25,"btcOk":5,"liquidity":5}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "telegram_configs" ("userId" uuid NOT NULL, "token" bytea NOT NULL, "chatId" character varying NOT NULL, "nearAlertsEnabled" boolean NOT NULL DEFAULT false, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1e3297fdb479fa3e597e5421a22" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`ALTER TABLE "telegram_configs" ADD CONSTRAINT "FK_1e3297fdb479fa3e597e5421a22" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "telegram_configs" DROP CONSTRAINT "FK_1e3297fdb479fa3e597e5421a22"`);
        await queryRunner.query(`DROP TABLE "telegram_configs"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7735e7cc3ab8dc0e4feb0d657"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c759b0f6370d8f16f87c957a71"`);
        await queryRunner.query(`DROP TABLE "trades"`);
        await queryRunner.query(`DROP TYPE "public"."trades_result_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_43f9d19561573e46b54f1c95a3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_90dd4eb644941ee94abc2703d9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0b67770e739fb8ed724cde3bdc"`);
        await queryRunner.query(`DROP TABLE "tracked_tokens"`);
        await queryRunner.query(`DROP TYPE "public"."tracked_tokens_status_enum"`);
    }

}
