import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAlertsTable1779742474538 implements MigrationInterface {
    name = 'AddAlertsTable1779742474538'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "alerts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "symbol" character varying NOT NULL, "base" character varying NOT NULL, "verdict" character varying(16) NOT NULL, "mode" character varying(16) NOT NULL, "score" integer NOT NULL, "change" double precision NOT NULL, "rsi" double precision, "price" double precision NOT NULL, "vol" double precision NOT NULL, "fundingRate" double precision, "redCount" integer NOT NULL, "btcChange" double precision NOT NULL, "passed" jsonb NOT NULL, "ts" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_60f895662df096bfcdfab7f4b96" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_alerts_user_ts" ON "alerts"  ("userId", "ts") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_alerts_user_ts"`);
        await queryRunner.query(`DROP TABLE "alerts"`);
    }

}
