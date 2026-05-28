import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaturedTracking1779931497700 implements MigrationInterface {
    name = 'AddMaturedTracking1779931497700'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "rsiEverPassed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "rsiPassedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "fundingEverPassed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "fundingPassedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "divergenceEverPassed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "divergencePassedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "redCandlesEverPassed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "redCandlesPassedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "maturedVerdict" text`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "maturedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "maturedAlertedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "currentPrice" double precision`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" ADD "activeMs" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX "IDX_tracked_tokens_active_ms" ON "tracked_tokens" ("status", "activeMs") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_tracked_tokens_active_ms"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "activeMs"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "currentPrice"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "maturedAlertedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "maturedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "maturedVerdict"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "redCandlesPassedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "redCandlesEverPassed"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "divergencePassedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "divergenceEverPassed"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "fundingPassedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "fundingEverPassed"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "rsiPassedAt"`);
        await queryRunner.query(`ALTER TABLE "tracked_tokens" DROP COLUMN "rsiEverPassed"`);
    }

}
